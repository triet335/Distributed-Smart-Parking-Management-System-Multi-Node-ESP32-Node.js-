/** Express + Socket.IO dashboard; ESP32 connects to /ws?id=ESP-01. */
const express = require('express');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { Server } = require('socket.io');
const { WebSocketServer, WebSocket } = require('ws');
const multer = require('multer');

function createParkingServer(options = {}) {
    const app = express();
    const server = http.createServer(app);
    const io = new Server(server);
    const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
    const nodes = new Map();
    const pending = new Map();
    const otaBusy = new Set();
    const dataFile = options.dataFile === undefined ? path.join(__dirname, 'data', 'parking.json') : options.dataFile;
    const commandTimeout = options.commandTimeout || 5000;
    let events = [];
    let saveTimer;

    function makeNode(id, config = {}) {
        return {
            id, name: config.name || `Hàng ${id === 'ESP-01' ? 'A' : id === 'ESP-02' ? 'B' : id}`,
            zone: config.zone || (id === 'ESP-02' ? 'Zone_B' : 'Zone_A'),
            slots: config.slots || 3, ip: config.ip || '', online: false,
            bitmask: 0, lastSeen: 0, hasData: false, fireAlarm: false,
            extinguish: false, fault: false, buzzer: null, irCount: config.irCount || 0,
            wsClient: null
        };
    }
    function publicNode(node) { const { wsClient, ...safe } = node; return safe; }
    function persist() {
        if (!dataFile) return;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(saveNow, 150);
    }
    function saveNow() {
        if (!dataFile) return;
        try {
            fs.mkdirSync(path.dirname(dataFile), { recursive: true });
            const configs = [...nodes.values()].map(({ id, name, zone, slots, ip, irCount }) => ({ id, name, zone, slots, ip, irCount }));
            fs.writeFileSync(`${dataFile}.tmp`, JSON.stringify({ nodes: configs, events }, null, 2));
            fs.renameSync(`${dataFile}.tmp`, dataFile);
        } catch (error) { console.error('Không lưu được dữ liệu:', error.message); }
    }
    function log(type, message, nodeId = '') {
        const event = { id: crypto.randomUUID(), time: Date.now(), type, message, nodeId };
        events.unshift(event);
        events = events.slice(0, 200);
        io.emit('activity', event);
        persist();
    }
    nodes.set('ESP-01', makeNode('ESP-01'));
    nodes.set('ESP-02', makeNode('ESP-02'));
    if (dataFile && fs.existsSync(dataFile)) {
        try {
            const saved = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
            for (const config of saved.nodes || []) nodes.set(config.id, makeNode(config.id, config));
            events = (saved.events || []).slice(0, 200);
        } catch (error) { console.error('Không đọc được cấu hình:', error.message); }
    }
    app.use(express.json({ limit: '16kb' }));
    app.use(express.static(path.join(__dirname, 'public')));
    app.get('/api/nodes', (_req, res) => res.json([...nodes.values()].map(publicNode)));
    app.get('/api/events', (_req, res) => res.json(events));
    app.get('/api/health', (_req, res) => res.json({ ok: true, uptime: Math.floor(process.uptime()) }));
    io.on('connection', socket => {
        socket.emit('init_nodes', [...nodes.values()].map(publicNode));
        socket.emit('init_events', events);
        socket.on('join_zone', zone => { if (['Zone_A', 'Zone_B', 'Zone_C'].includes(zone)) socket.join(zone); });
        socket.on('leave_zone', zone => { if (typeof zone === 'string') socket.leave(zone); });
    });
    server.on('upgrade', (request, socket, head) => {
        const url = new URL(request.url, 'http://localhost');
        if (url.pathname !== '/ws') return;
        const id = url.searchParams.get('id');
        if (!id || !/^[a-zA-Z0-9_-]{1,32}$/.test(id)) {
            socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return;
        }
        wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, request));
    });
    function settle(requestId, success, error = '') {
        const command = pending.get(requestId);
        if (!command) return;
        pending.delete(requestId);
        clearTimeout(command.timer);
        const node = nodes.get(command.id);
        const result = { success, requestId, id: command.id, action: command.action, state: command.state, error, node: publicNode(node) };
        io.emit('node_control_applied', result);
        log(success ? 'control' : 'warning', success
            ? `${node.name}: ${command.action === 'buzzer' ? 'còi báo động' : 'relay chữa cháy'} đã ${command.state ? 'bật' : 'tắt'}.`
            : `${node.name}: ${error}`, node.id);
        command.resolve(result);
    }
    function disconnectNode(node, ws, reason) {
        if (node.wsClient !== ws) return;
        node.online = false;
        node.wsClient = null;
        for (const [key, command] of pending) if (command.id === node.id) settle(key, false, 'Thiết bị đã mất kết nối.');
        io.emit('node_status_change', publicNode(node));
        log('warning', `${node.name}: ${reason}`, node.id);
    }
    wss.on('connection', (ws, req) => {
        const id = new URL(req.url, 'http://localhost').searchParams.get('id');
        let node = nodes.get(id);
        if (!node) { node = makeNode(id); nodes.set(id, node); }
        const old = node.wsClient;
        if (old) for (const [key, command] of pending) if (command.id === id) settle(key, false, 'Thiết bị đang kết nối lại.');
        node.wsClient = ws;
        if (old) old.terminate();
        node.ip = req.socket.remoteAddress.replace('::ffff:', '');
        node.online = true;
        node.hasData = false;
        node.buzzer = null;
        node.lastSeen = Date.now();
        io.emit('node_configured', publicNode(node));
        log('connection', `${node.name} (${id}) đã kết nối.`, id);
        ws.on('pong', () => { if (node.wsClient === ws) node.lastSeen = Date.now(); });
        ws.on('message', (message, isBinary) => {
            if (node.wsClient !== ws) return;
            node.lastSeen = Date.now();
            if (isBinary) {
                if (message.length !== 1) return;
                const byte = message[0];
                const previous = node.bitmask;
                const first = !node.hasData;
                node.bitmask = byte;
                node.hasData = true;
                node.fireAlarm = Boolean(byte & 0x10);
                node.extinguish = Boolean(byte & 0x20);
                node.fault = Boolean(byte & 0x40);
                if ((byte & 0x08) && (first || !(previous & 0x08))) {
                    node.irCount++;
                    log('vehicle', `${node.name}: một lượt xe đi qua cảm biến IR.`, id);
                }
                if (!first) for (let i = 0; i < node.slots; i++) {
                    if ((byte ^ previous) & (1 << i)) log('vehicle', `${node.name} · ô ${i + 1}: ${byte & (1 << i) ? 'xe vào đỗ' : 'xe rời đi'}.`, id);
                }
                if (node.fireAlarm && (first || !(previous & 0x10))) {
                    log('fire', `BÁO CHÁY tại ${node.name}. Kiểm tra ngay khu vực!`, id);
                    io.emit('emergency_fire', { sourceNode: id, zone: node.zone });
                } else if (!first && !node.fireAlarm && (previous & 0x10)) log('connection', `${node.name}: cảm biến báo cháy trở về bình thường.`, id);
                if (node.fault && (first || !(previous & 0x40))) log('warning', `${node.name}: thiết bị báo lỗi cảm biến.`, id);
                io.emit('node_update_binary', { ...publicNode(node), byte });
                // Legacy relay firmware confirms state through bit 5.
                for (const [key, command] of pending) {
                    if (command.id === id && command.action === 'extinguish' && node.extinguish === command.state) settle(key, true);
                }
                return;
            }
            const text = message.toString();
            if (text === 'ping') { ws.send('pong'); return; }
            if (text === 'pong') return;
            try {
                const data = JSON.parse(text);
                if (data.type === 'state' && typeof data.buzzer === 'boolean') {
                    node.buzzer = data.buzzer;
                    io.emit('node_status_change', publicNode(node));
                }
                if (data.type === 'ack') {
                    const command = pending.get(data.requestId);
                    if (!command || command.id !== id || command.action !== data.cmd) return;
                    if (data.success !== true || data.value !== command.state) {
                        settle(data.requestId, false, 'ESP32 từ chối lệnh điều khiển.'); return;
                    }
                    if (command.action === 'buzzer') node.buzzer = typeof data.buzzer === 'boolean' ? data.buzzer : data.value;
                    settle(data.requestId, true);
                }
            } catch { /* Text frames never change the occupancy bitmask. */ }
        });
        ws.on('close', () => disconnectNode(node, ws, 'đã ngắt kết nối.'));
        ws.on('error', error => console.error(`[${id}] ${error.message}`));
    });
    const heartbeat = setInterval(() => {
        for (const node of nodes.values()) {
            if (!node.wsClient) continue;
            if (Date.now() - node.lastSeen > 15000) {
                const ws = node.wsClient;
                disconnectNode(node, ws, 'không phản hồi quá 15 giây.');
                ws.terminate();
            } else if (node.wsClient.readyState === WebSocket.OPEN) node.wsClient.ping();
        }
    }, 5000);
    heartbeat.unref();
    app.post('/api/nodes/:id/setup', (req, res) => {
        const { id } = req.params;
        const { name, zone, slots } = req.body;
        if (!/^[a-zA-Z0-9_-]{1,32}$/.test(id) || typeof name !== 'string' || !name.trim() || name.length > 80 || !['Zone_A', 'Zone_B', 'Zone_C'].includes(zone) || !Number.isInteger(slots) || slots < 1 || slots > 3) {
            return res.status(400).json({ error: 'Tên, mã thiết bị, khu vực hoặc số ô (1–3) không hợp lệ.' });
        }
        let node = nodes.get(id);
        if (req.body.mode === 'create' && node) return res.status(409).json({ error: 'ESP32 này đã quản lý một hàng xe. Hãy mở Cấu hình hàng để chỉnh sửa.' });
        if (req.body.mode === 'update' && !node) return res.status(404).json({ error: 'Không tìm thấy hàng xe của ESP32 này.' });
        if (!node) { node = makeNode(id); nodes.set(id, node); }
        Object.assign(node, { name: name.trim(), zone, slots });
        io.emit('node_configured', publicNode(node));
        log('config', `Đã lưu cấu hình ${node.name} (${id}), ${slots} ô đỗ.`, id);
        res.json({ success: true, node: publicNode(node) });
    });
    app.post('/api/nodes/:id/control', async (req, res) => {
        const node = nodes.get(req.params.id);
        const { action, state } = req.body;
        if (!node) return res.status(404).json({ error: 'Thiết bị không tồn tại.' });
        if (!['buzzer', 'extinguish', 'reset_ir'].includes(action) || (action !== 'reset_ir' && typeof state !== 'boolean')) {
            return res.status(400).json({ error: 'Lệnh không hợp lệ. Trạng thái phải là true hoặc false.' });
        }
        if (action === 'reset_ir') {
            node.irCount = 0;
            io.emit('node_status_change', publicNode(node));
            log('control', `${node.name}: đã đặt lại bộ đếm IR.`, node.id);
            return res.json({ success: true, node: publicNode(node) });
        }
        if (!node.online || !node.hasData || node.wsClient?.readyState !== WebSocket.OPEN) return res.status(409).json({ error: 'Thiết bị chưa sẵn sàng hoặc đang mất kết nối.' });
        if (action === 'buzzer' && !state && node.fireAlarm) return res.status(409).json({ error: 'Cảm biến đang báo cháy. Còi tự động sẽ tiếp tục hoạt động.' });
        if ([...pending.values()].some(command => command.id === node.id && command.action === action)) return res.status(409).json({ error: 'Đang chờ thiết bị xác nhận lệnh trước.' });
        const requestId = crypto.randomUUID();
        const result = await new Promise(resolve => {
            const timer = setTimeout(() => settle(requestId, false, 'Không nhận được xác nhận từ ESP32. Kiểm tra firmware và kết nối.'), commandTimeout);
            pending.set(requestId, { id: node.id, action, state, timer, resolve });
            io.emit('node_control_pending', { id: node.id, action, state, requestId });
            node.wsClient.send(JSON.stringify({ cmd: action, value: state, requestId }), error => {
                if (error) settle(requestId, false, 'Không gửi được lệnh tới thiết bị.');
            });
        });
        res.status(result.success ? 200 : 504).json(result);
    });
    // ESP32 WebServer /update expects a multipart file.
    const upload = multer({
        dest: path.join(__dirname, 'uploads'), limits: { fileSize: 4 * 1024 * 1024, files: 1 },
        fileFilter: (_req, file, callback) => callback(null, /\.bin$/i.test(file.originalname))
    });
    app.post('/api/nodes/:id/ota', upload.single('firmware'), async (req, res) => {
        const node = nodes.get(req.params.id);
        const file = req.file;
        const removeFile = () => { if (file) fs.rm(file.path, { force: true }, () => {}); };
        if (!file || file.size === 0) { removeFile(); return res.status(400).json({ error: 'Chọn firmware .bin hợp lệ, tối đa 4 MB.' }); }
        if (!node?.online || !node.ip || node.wsClient?.readyState !== WebSocket.OPEN) { removeFile(); return res.status(409).json({ error: 'ESP32 phải trực tuyến để nạp firmware.' }); }
        if (otaBusy.has(node.id)) { removeFile(); return res.status(409).json({ error: 'Thiết bị đang được nạp firmware.' }); }
        otaBusy.add(node.id);
        const boundary = `parking-${crypto.randomUUID()}`;
        const prefix = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="firmware"; filename="firmware.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`);
        const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
        const progress = (percent, status) => io.emit('ota_progress', { id: node.id, percent, status });
        let request;
        try {
            progress(0, 'Đang kết nối đến ESP32…');
            let sent = 0;
            const meter = new Transform({ transform(chunk, _encoding, callback) {
                sent += chunk.length;
                progress(Math.min(99, Math.floor(sent / file.size * 100)), 'Đang gửi firmware…');
                callback(null, chunk);
            } });
            const response = new Promise((resolve, reject) => {
                request = http.request({ host: node.ip, port: options.otaPort || 80, path: '/update', method: 'POST',
                    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': prefix.length + file.size + suffix.length }
                }, incoming => {
                    let body = '';
                    incoming.on('data', chunk => { body += chunk.toString(); if (body.length > 4096) incoming.destroy(new Error('Phản hồi OTA quá lớn.')); });
                    incoming.on('end', () => incoming.statusCode === 200 && body.trim() === 'OK' ? resolve() : reject(new Error('ESP32 từ chối firmware.')));
                    incoming.on('error', reject);
                });
                request.setTimeout(30000, () => request.destroy(new Error('ESP32 không phản hồi OTA.')));
                request.on('error', reject);
            });
            response.catch(() => {});
            request.write(prefix);
            await pipeline(fs.createReadStream(file.path, { highWaterMark: 4096 }), meter, request, { end: false });
            request.end(suffix);
            await response;
            progress(100, 'Nạp thành công. ESP32 đang khởi động lại.');
            log('config', `${node.name}: ESP32 xác nhận cập nhật firmware thành công.`, node.id);
            res.json({ success: true });
        } catch (error) {
            request?.destroy();
            progress(0, `Lỗi: ${error.message}`);
            log('warning', `${node.name}: nạp firmware thất bại.`, node.id);
            res.status(502).json({ error: error.message });
        } finally { otaBusy.delete(node.id); removeFile(); }
    });
    app.use((error, _req, res, _next) => {
        res.status(error instanceof multer.MulterError || error.type === 'entity.parse.failed' ? 400 : 500)
            .json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Firmware vượt quá 4 MB.' : 'Yêu cầu không hợp lệ hoặc máy chủ gặp lỗi.' });
    });
    async function close() {
        clearInterval(heartbeat);
        clearTimeout(saveTimer);
        for (const [key] of pending) settle(key, false, 'Máy chủ đang dừng.');
        clearTimeout(saveTimer);
        saveNow();
        for (const ws of wss.clients) ws.terminate();
        await new Promise(resolve => io.close(resolve));
        wss.close();
    }
    return { app, server, io, nodes, close };
}
if (require.main === module) {
    const parking = createParkingServer();
    const port = Number(process.env.PORT || 3000);
    parking.server.listen(port, '0.0.0.0', () => {
        console.log(`Smart Parking: http://localhost:${port}`);
        console.log(`ESP32 endpoint: ws://<IP-may-tinh>:${port}/ws?id=ESP-01`);
    });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => parking.close().then(() => process.exit(0)));
}
module.exports = { createParkingServer };
