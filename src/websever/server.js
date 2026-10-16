/**
 * ============================================================================
 * ĐỒ ÁN LẬP TRÌNH MẠNG (KC321) - ĐẠI HỌC CẦN THƠ
 * GIẢNG VIÊN HƯỚNG DẪN: TS. GVC. NGUYỄN VĂN KHANH (PLC & IIoT LAB)
 * 
 * SERVER ĐIỀU PHỐI VÀ QUẢN TRỊ BÃI ĐỖ XE PHÂN TÁN (MULTI-NODE ESP32)
 * Bốn trụ cột kiến thức áp dụng:
 * 1. Express Server & Dynamic Route (:id) - Slide 41-44 Chương 3
 * 2. Cấu trúc dữ liệu Map() quản lý danh sách Client - Slide 16-18 Chương 3
 * 3. Socket.IO & Rooms (Phân nhóm kênh: room_gate, room_zone_A, room_zone_B) - Slide 10-23 C3
 * 4. WebSocket Nhị phân (1-Byte Bitmask Payload) & JSON dự phòng
 * 5. Stream & Pipe cho Web OTA Firmware (ota_service.js) - Chương 2 & Báo cáo B1
 * ============================================================================
 */

const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const { Server: SocketIOServer } = require('socket.io');
const { WebSocketServer, WebSocket } = require('ws');
const multer = require('multer');
const { streamOtaFirmware } = require('./ota_service');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Thư mục lưu file nạp firmware tạm thời
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir });

// ----------------------------------------------------------------------------
// 1. QUẢN LÝ THIẾT BỊ BẰNG MAP() TRONG JAVASCRIPT (Slide 16-18 Chương 3)
// ----------------------------------------------------------------------------
const devices = new Map();
const events = [];
const EVENT_LIMIT = 100;

// Danh sách thẻ NFC hợp lệ (Whitelist)
const WHITELIST = new Set(['1A2B3C4D', 'F5E4D3C2', '047A8B12', 'C3D2E1F0', 'B2308335', 'A1B2C3D4']);
// Quản lý xe đang đỗ trong bãi: Key = UID, Value = { inTime, slotId }
const vehiclesInside = new Map();

function initDevices() {
    // 1. Node Cổng
    devices.set('ESP_GATE', {
        id: 'ESP_GATE',
        name: 'Node Cổng (Ra/Vào)',
        type: 'gate',
        online: false,
        ip: '',
        barieState: 'closed', // 'closed', 'opened', 'emergency_open'
        ldrDark: false,       // false: trời sáng, true: trời tối
        lastUid: '',
        lastAction: '',       // 'IN', 'OUT', 'REJECT'
        lastSeen: 0,
        socketId: null,
        wsClient: null
    });

    // 2. Node Khu A (Slot 1-3)
    devices.set('ESP_ZONE_A', {
        id: 'ESP_ZONE_A',
        name: 'Khu A (Dãy 1)',
        type: 'zone',
        zone: 'Zone_A',
        slots: [0, 0, 0], // 0: trống, 1: có xe
        light: false,     // Đèn chiếu sáng
        fire: false,      // Báo cháy
        pump: false,      // Phun nước
        buzzer: false,    // Còi hú
        online: false,
        ip: '',
        lastSeen: 0,
        socketId: null,
        wsClient: null
    });

    // 3. Node Khu B (Slot 4-6)
    devices.set('ESP_ZONE_B', {
        id: 'ESP_ZONE_B',
        name: 'Khu B (Dãy 2)',
        type: 'zone',
        zone: 'Zone_B',
        slots: [0, 0, 0],
        light: false,
        fire: false,
        pump: false,
        buzzer: false,
        online: false,
        ip: '',
        lastSeen: 0,
        socketId: null,
        wsClient: null
    });

    // 4. Node ảo mô phỏng mở rộng (Khu C & Khu D)
    devices.set('ESP_ZONE_C', {
        id: 'ESP_ZONE_C',
        name: 'Khu C (Mô phỏng)',
        type: 'zone',
        zone: 'Zone_C',
        slots: [0, 0, 0],
        light: false,
        fire: false,
        pump: false,
        buzzer: false,
        online: false,
        isSim: true
    });

    devices.set('ESP_ZONE_D', {
        id: 'ESP_ZONE_D',
        name: 'Khu D (Mô phỏng)',
        type: 'zone',
        zone: 'Zone_D',
        slots: [0, 0, 0],
        light: false,
        fire: false,
        pump: false,
        buzzer: false,
        online: false,
        isSim: true
    });
}
initDevices();

function logEvent(type, message, details = {}) {
    const item = {
        id: Date.now() + '-' + Math.floor(Math.random() * 1000),
        time: Date.now(),
        type,       // 'IN', 'OUT', 'REJECT', 'FIRE', 'LIGHT', 'BARIE', 'SYSTEM'
        message,
        details
    };
    events.unshift(item);
    if (events.length > EVENT_LIMIT) events.pop();
    if (io) io.to('room_dashboard').emit('new_event', item);
    console.log(`[EVENT] [${type}] ${message}`);
}

function getSystemSnapshot() {
    const list = Array.from(devices.values()).map(({ wsClient, socketId, ...safe }) => safe);
    const zoneA = devices.get('ESP_ZONE_A');
    const zoneB = devices.get('ESP_ZONE_B');
    const gate = devices.get('ESP_GATE');

    const totalRealSlots = 6;
    let occupiedRealSlots = 0;
    if (zoneA && zoneA.slots) occupiedRealSlots += zoneA.slots.filter(s => s === 1).length;
    if (zoneB && zoneB.slots) occupiedRealSlots += zoneB.slots.filter(s => s === 1).length;
    const freeRealSlots = Math.max(0, totalRealSlots - occupiedRealSlots);

    const isAnyFire = Array.from(devices.values()).some(d => d.fire === true);

    return {
        devices: list,
        summary: {
            totalSlots: totalRealSlots,
            occupied: occupiedRealSlots,
            free: freeRealSlots,
            vehiclesCount: vehiclesInside.size,
            isAnyFire,
            gate: {
                barieState: gate ? gate.barieState : 'closed',
                ldrDark: gate ? gate.ldrDark : false,
                lastUid: gate ? gate.lastUid : '',
                lastAction: gate ? gate.lastAction : ''
            }
        },
        events: events.slice(0, 50)
    };
}

function broadcastSnapshot() {
    if (io) {
        const snap = getSystemSnapshot();
        io.to('room_dashboard').emit('snapshot', snap);
    }
}

// ----------------------------------------------------------------------------
// 2. KHỞI TẠO SOCKET.IO & QUẢN LÝ ROOMS (Slide 10-23 Chương 3)
// ----------------------------------------------------------------------------
const io = new SocketIOServer(server, { cors: { origin: '*' }, allowEIO3: true });

io.on('connection', (socket) => {
    // 2.1. Đăng ký Web Client vào room_dashboard
    socket.on('register_web', () => {
        socket.join('room_dashboard');
        socket.emit('snapshot', getSystemSnapshot());
        console.log(`[Socket.IO] Web Dashboard kết nối: ${socket.id}`);
    });

    // 2.2. Đăng ký ESP32 Client vào từng Room riêng biệt
    socket.on('register_device', (deviceId, ip = '') => {
        if (!devices.has(deviceId)) {
            console.warn(`[Socket.IO] DeviceId không hợp lệ: ${deviceId}`);
            return;
        }
        const dev = devices.get(deviceId);
        dev.online = true;
        dev.socketId = socket.id;
        dev.ip = ip || socket.handshake.address.replace('::ffff:', '');
        dev.lastSeen = Date.now();
        socket.deviceId = deviceId;

        // Phân nhóm Room
        if (deviceId === 'ESP_GATE') {
            socket.join('room_gate');
        } else if (deviceId === 'ESP_ZONE_A') {
            socket.join('room_zone_A');
        } else if (deviceId === 'ESP_ZONE_B') {
            socket.join('room_zone_B');
        } else if (dev.zone) {
            socket.join(`room_${dev.zone.toLowerCase()}`);
        }

        console.log(`[Socket.IO] Thiết bị ${deviceId} đã gia nhập Room và online (${dev.ip})`);
        logEvent('SYSTEM', `Thiết bị ${dev.name} đã kết nối trực tuyến.`, { deviceId });
        broadcastSnapshot();
    });

    // 2.3. Xử lý sự kiện từ Node Cổng (NFC & LDR Cổng)
    socket.on('gate_event', (data) => {
        handleGateEvent(data, socket);
    });

    // 2.4. Xử lý trạng thái từ Node Khu A & Khu B (JSON payload)
    socket.on('zone_status', (data) => {
        handleZoneStatus(socket.deviceId, data);
    });

    // 2.5. Xử lý ngắt kết nối
    socket.on('disconnect', () => {
        if (socket.deviceId && devices.has(socket.deviceId)) {
            const dev = devices.get(socket.deviceId);
            dev.online = false;
            dev.socketId = null;
            console.log(`[Socket.IO] Thiết bị ${socket.deviceId} đã ngắt kết nối`);
            logEvent('SYSTEM', `Thiết bị ${dev.name} bị mất kết nối!`, { deviceId: socket.deviceId });
            broadcastSnapshot();
        }
    });
});

// ----------------------------------------------------------------------------
// 3. LOGIC NGHIỆP VỤ CỔNG RA VÀO (QUẸT THẺ, BUZZER, BARIE, LDR CỔNG)
// ----------------------------------------------------------------------------
function handleGateEvent(data, socket) {
    const gate = devices.get('ESP_GATE');
    if (!gate) return;
    gate.lastSeen = Date.now();

    // 3.1. Cập nhật mức sáng LDR Cổng -> Tự động bật đèn Khu A & B
    if (typeof data.ldrDark === 'boolean') {
        const changed = gate.ldrDark !== data.ldrDark;
        gate.ldrDark = data.ldrDark;
        if (changed) {
            const actionText = data.ldrDark ? 'Trời tối -> Bật đèn chiếu sáng toàn bãi' : 'Trời sáng -> Tắt đèn chiếu sáng';
            logEvent('LIGHT', `LDR Cổng báo ${actionText}`);
            // Broadcast lệnh bật/tắt đèn tới room_zone_A và room_zone_B
            setZoneLights(data.ldrDark);
        }
    }

    // 3.2. Cập nhật trạng thái Barie
    if (data.barieState) {
        gate.barieState = data.barieState;
    }

    // 3.3. Xử lý quẹt thẻ NFC
    if (data.uid) {
        const uid = data.uid.toUpperCase().trim();
        gate.lastUid = uid;

        // A. Kiểm tra thẻ hợp lệ trong Whitelist
        if (!WHITELIST.has(uid)) {
            gate.lastAction = 'REJECT';
            logEvent('REJECT', `Thẻ lạ [${uid}] bị từ chối truy cập!`, { uid });
            io.to('room_gate').emit('gate_command', {
                action: 'reject',
                beeps: 3,
                message: 'Thẻ không hợp lệ'
            });
            broadcastSnapshot();
            return;
        }

        // B. Phân loại Vào / Ra luân phiên
        const isInside = vehiclesInside.has(uid);

        if (!isInside) {
            // === XE VÀO BÃI ===
            // Kiểm tra bãi đầy (6/6 ô thực)
            const zoneA = devices.get('ESP_ZONE_A');
            const zoneB = devices.get('ESP_ZONE_B');
            let occupied = 0;
            if (zoneA) occupied += zoneA.slots.filter(s => s === 1).length;
            if (zoneB) occupied += zoneB.slots.filter(s => s === 1).length;

            if (occupied >= 6) {
                gate.lastAction = 'FULL_REJECT';
                logEvent('REJECT', `Bãi xe đã đầy (6/6)! Từ chối xe [${uid}] vào.`, { uid });
                io.to('room_gate').emit('gate_command', {
                    action: 'full_reject',
                    beeps: 3,
                    message: 'Bãi xe đã đầy!'
                });
            } else {
                gate.lastAction = 'IN';
                vehiclesInside.set(uid, Date.now());
                gate.barieState = 'opened';
                logEvent('IN', `Xe [${uid}] đã VÀO bãi đỗ xe thành công.`, { uid });
                io.to('room_gate').emit('gate_command', {
                    action: 'open_barie',
                    beeps: 1,
                    duration: 3500,
                    message: 'Mời xe vào bãi'
                });
                setTimeout(() => {
                    if (gate.barieState === 'opened') {
                        gate.barieState = 'closed';
                        broadcastSnapshot();
                    }
                }, 3800);
            }
        } else {
            // === XE RA BÃI ===
            gate.lastAction = 'OUT';
            vehiclesInside.delete(uid);
            gate.barieState = 'opened';
            logEvent('OUT', `Xe [${uid}] đã RA khỏi bãi đỗ xe.`, { uid });
            io.to('room_gate').emit('gate_command', {
                action: 'open_barie',
                beeps: 1,
                duration: 3500,
                message: 'Hẹn gặp lại quý khách'
            });
            setTimeout(() => {
                if (gate.barieState === 'opened') {
                    gate.barieState = 'closed';
                    broadcastSnapshot();
                }
            }, 3800);
        }
    }

    broadcastSnapshot();
}

function setZoneLights(enable) {
    const zoneA = devices.get('ESP_ZONE_A');
    const zoneB = devices.get('ESP_ZONE_B');
    if (zoneA) zoneA.light = enable;
    if (zoneB) zoneB.light = enable;

    // Gửi lệnh xuống từng Room
    io.to('room_zone_a').emit('zone_command', { action: 'set_light', value: enable });
    io.to('room_zone_b').emit('zone_command', { action: 'set_light', value: enable });
}

// ----------------------------------------------------------------------------
// 4. LOGIC KHẨN CẤP PCCC LIÊN VÙNG (CROSS-NODE EVENT)
// ----------------------------------------------------------------------------
function handleZoneStatus(deviceId, data) {
    if (!devices.has(deviceId)) return;
    const dev = devices.get(deviceId);
    dev.lastSeen = Date.now();

    if (Array.isArray(data.slots)) {
        dev.slots = data.slots.slice(0, 3);
    }
    if (typeof data.light === 'boolean') dev.light = data.light;
    if (typeof data.pump === 'boolean') dev.pump = data.pump;

    // Kịch bản báo cháy
    if (typeof data.fire === 'boolean') {
        const wasFire = dev.fire;
        dev.fire = data.fire;

        if (data.fire && !wasFire) {
            // CÓ CHÁY MỚI PHÁT HIỆN TẠI KHU VỰC NÀY
            logEvent('FIRE', `PHÁT HIỆN CHÁY TẠI ${dev.name}! Kích hoạt báo động toàn bãi.`, { deviceId });

            // 1. Bật còi & chớp đèn báo cháy ĐỎ ở CẢ 2 KHU (A và B)
            io.to('room_zone_a').emit('zone_command', { action: 'fire_alert', value: true });
            io.to('room_zone_b').emit('zone_command', { action: 'fire_alert', value: true });
            const devA = devices.get('ESP_ZONE_A'); if (devA) devA.buzzer = true;
            const devB = devices.get('ESP_ZONE_B'); if (devB) devB.buzzer = true;

            // 2. CHỈ xả nước (đèn phun nước xanh) tại đúng khu vực có cháy!
            dev.pump = true;
            if (deviceId === 'ESP_ZONE_A') {
                io.to('room_zone_a').emit('zone_command', { action: 'set_pump', value: true });
            } else if (deviceId === 'ESP_ZONE_B') {
                io.to('room_zone_b').emit('zone_command', { action: 'set_pump', value: true });
            }
        }
    }

    broadcastSnapshot();
}

// ----------------------------------------------------------------------------
// 5. WEBSOCKET NHỊ PHÂN CHO 1-BYTE BITMASK (Tối ưu băng thông tầng vận chuyển)
// ----------------------------------------------------------------------------
const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });

server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname === '/ws') {
        const id = url.searchParams.get('id');
        if (!id || !devices.has(id)) {
            socket.destroy();
            return;
        }
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request, id);
        });
    }
});

wss.on('connection', (ws, req, id) => {
    const dev = devices.get(id);
    dev.online = true;
    dev.wsClient = ws;
    dev.ip = req.socket.remoteAddress.replace('::ffff:', '');
    dev.lastSeen = Date.now();
    console.log(`[WebSocket Binary] ${id} kết nối thành công từ ${dev.ip}`);
    logEvent('SYSTEM', `${dev.name} kết nối qua WebSocket nhị phân.`, { id });
    broadcastSnapshot();

    ws.on('message', (message, isBinary) => {
        dev.lastSeen = Date.now();

        if (isBinary || Buffer.isBuffer(message)) {
            // GIẢI MÃ 1-BYTE BITMASK (Slide chuẩn kỹ thuật đề xuất)
            const byteVal = message[0];
            const s1 = (byteVal & (1 << 0)) ? 1 : 0;
            const s2 = (byteVal & (1 << 1)) ? 1 : 0;
            const s3 = (byteVal & (1 << 2)) ? 1 : 0;
            const light = !!(byteVal & (1 << 3));
            const fire = !!(byteVal & (1 << 4));
            const pump = !!(byteVal & (1 << 5));

            handleZoneStatus(id, {
                slots: [s1, s2, s3],
                light,
                fire,
                pump
            });
        } else {
            try {
                const json = JSON.parse(message.toString());
                if (id === 'ESP_GATE') {
                    handleGateEvent(json, null);
                } else {
                    handleZoneStatus(id, json);
                }
            } catch (e) {
                console.error(`[WebSocket] Lỗi parse JSON từ ${id}:`, e.message);
            }
        }
    });

    ws.on('close', () => {
        dev.online = false;
        dev.wsClient = null;
        console.log(`[WebSocket] ${id} ngắt kết nối`);
        logEvent('SYSTEM', `${dev.name} ngắt kết nối WebSocket.`, { id });
        broadcastSnapshot();
    });
});

// ----------------------------------------------------------------------------
// 6. REST API ĐIỀU KHIỂN & ROUTE NÂNG CAO (Slide 41-44 Chương 3)
// ----------------------------------------------------------------------------

// 6.1. Trang màn hình phụ tại cổng (/gate-display)
app.get('/gate-display', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'gate.html'));
});

// 6.2. Lấy danh sách Node và trạng thái tổng quan
app.get('/api/nodes', (req, res) => {
    res.json(getSystemSnapshot());
});

app.get('/api/events', (req, res) => {
    res.json(events);
});

app.get('/api/health', (req, res) => {
    res.json({ ok: true, uptime: Math.floor(process.uptime()), memory: process.memoryUsage() });
});

// 6.3. API Điều khiển từ xa (Dynamic Route :id)
app.post('/api/nodes/:id/control', (req, res) => {
    const { id } = req.params;
    const { action, value } = req.body;

    if (!devices.has(id)) {
        return res.status(404).json({ success: false, error: 'Không tìm thấy Node' });
    }

    const dev = devices.get(id);

    if (id === 'ESP_GATE') {
        if (action === 'emergency_open') {
            dev.barieState = 'emergency_open';
            io.to('room_gate').emit('gate_command', { action: 'emergency_open' });
            logEvent('BARIE', 'Quản trị viên MỞ TOANG BARIE KHẨN CẤP để thoát hiểm!');
        } else if (action === 'close_barie') {
            dev.barieState = 'closed';
            io.to('room_gate').emit('gate_command', { action: 'close_barie' });
            logEvent('BARIE', 'Quản trị viên đã ĐÓNG Barie.');
        } else if (action === 'open_barie') {
            dev.barieState = 'opened';
            io.to('room_gate').emit('gate_command', { action: 'open_barie', beeps: 1, duration: 3500 });
            logEvent('BARIE', 'Quản trị viên Mở Barie (Tự đóng sau 3.5s).');
            setTimeout(() => {
                if (dev.barieState === 'opened') {
                    dev.barieState = 'closed';
                    broadcastSnapshot();
                }
            }, 3800);
        }
    } else {
        // Điều khiển Khu A / B / C / D
        if (action === 'set_light') {
            dev.light = Boolean(value);
            const roomName = `room_${dev.zone ? dev.zone.toLowerCase() : id.toLowerCase()}`;
            io.to(roomName).emit('zone_command', { action: 'set_light', value: dev.light });
            logEvent('LIGHT', `Quản trị viên ${dev.light ? 'BẬT' : 'TẮT'} đèn ${dev.name}`);
        } else if (action === 'set_pump') {
            dev.pump = Boolean(value);
            const roomName = `room_${dev.zone ? dev.zone.toLowerCase() : id.toLowerCase()}`;
            io.to(roomName).emit('zone_command', { action: 'set_pump', value: dev.pump });
            logEvent('FIRE', `Quản trị viên ${dev.pump ? 'BẬT' : 'TẮT'} van phun nước ${dev.name}`);
        } else if (action === 'test_fire') {
            // Giả lập báo cháy test
            dev.fire = true;
            dev.pump = true;
            logEvent('FIRE', `Thử nghiệm báo cháy tại ${dev.name}!`);
            io.to('room_zone_a').emit('zone_command', { action: 'fire_alert', value: true });
            io.to('room_zone_b').emit('zone_command', { action: 'fire_alert', value: true });
            const roomName = `room_${dev.zone ? dev.zone.toLowerCase() : id.toLowerCase()}`;
            io.to(roomName).emit('zone_command', { action: 'set_pump', value: true });
        }
    }

    broadcastSnapshot();
    res.json({ success: true, node: dev });
});


// 6.4. Bảng điều khiển tổng toàn bãi (Master Controls)
app.post('/api/system/control', (req, res) => {
    const { action, value } = req.body;

    if (action === 'all_lights') {
        const state = Boolean(value);
        setZoneLights(state);
        logEvent('LIGHT', `Quản trị viên đã ${state ? 'BẬT' : 'TẮT'} TOÀN BỘ ĐÈN CHIẾU SÁNG bãi xe.`);
    } else if (action === 'open_barie_auto') {
        const gate = devices.get('ESP_GATE');
        if (gate) {
            gate.barieState = 'opened';
            io.to('room_gate').emit('gate_command', { action: 'open_barie', beeps: 1, duration: 3500 });
            logEvent('BARIE', 'Quản trị viên Mở Barie (Tự đóng sau 3.5s).');
            setTimeout(() => {
                if (gate.barieState === 'opened') {
                    gate.barieState = 'closed';
                    broadcastSnapshot();
                }
            }, 3800);
        }
    } else if (action === 'close_barie') {
        const gate = devices.get('ESP_GATE');
        if (gate) {
            gate.barieState = 'closed';
            io.to('room_gate').emit('gate_command', { action: 'close_barie' });
            logEvent('BARIE', 'Quản trị viên Đóng Barie.');
        }
    } else if (action === 'emergency_open') {
        const gate = devices.get('ESP_GATE');
        if (gate) {
            gate.barieState = 'emergency_open';
            io.to('room_gate').emit('gate_command', { action: 'emergency_open' });
            logEvent('BARIE', 'Quản trị viên MỞ TOANG BARIE THOÁT HIỂM!');
        }
    } else if (action === 'test_fire_all') {
        for (const dev of devices.values()) {
            if (dev.type === 'zone') {
                dev.fire = true;
                dev.buzzer = true;
            }
        }
        io.to('room_zone_a').emit('zone_command', { action: 'fire_alert', value: true });
        io.to('room_zone_b').emit('zone_command', { action: 'fire_alert', value: true });
        logEvent('FIRE', 'Quản trị viên KÍCH HOẠT BÁO CHÁY THỬ NGHIỆM TOÀN BÃI!');
    }

    broadcastSnapshot();
    res.json({ success: true, message: `Thực hiện lệnh ${action} thành công` });
});

// 6.5. Nút Reset toàn bộ hệ thống PCCC
app.post('/api/system/reset-fire', (req, res) => {
    for (const dev of devices.values()) {
        dev.fire = false;
        dev.pump = false;
        dev.buzzer = false;
    }
    const gate = devices.get('ESP_GATE');
    if (gate && gate.barieState === 'emergency_open') {
        gate.barieState = 'closed';
        io.to('room_gate').emit('gate_command', { action: 'close_barie' });
    }

    io.to('room_zone_a').emit('zone_command', { action: 'reset_fire' });
    io.to('room_zone_b').emit('zone_command', { action: 'reset_fire' });

    logEvent('SYSTEM', 'Quản trị viên đã TẮT BÁO CHÁY & ĐẶT LẠI HỆ THỐNG AN TOÀN.');
    broadcastSnapshot();
    res.json({ success: true, message: 'Đã reset hệ thống PCCC thành công' });
});

// 6.5. Tuyến nạp Firmware Web OTA (Stream & Pipe)
app.post('/api/nodes/:id/ota', upload.single('firmware'), async (req, res) => {
    const { id } = req.params;
    if (!devices.has(id)) {
        return res.status(404).json({ success: false, error: 'Không tìm thấy Node' });
    }
    const dev = devices.get(id);
    if (!dev.online || !dev.ip) {
        return res.status(400).json({ success: false, error: 'Node đang ngoại tuyến (Offline), không thể nạp OTA' });
    }
    if (!req.file) {
        return res.status(400).json({ success: false, error: 'Vui lòng chọn file firmware (.bin)' });
    }

    logEvent('SYSTEM', `Bắt đầu nạp firmware OTA cho ${dev.name} (${dev.ip})...`, { id });

    try {
        const result = await streamOtaFirmware(dev.ip, req.file.path, io, id);
        fs.unlink(req.file.path, () => {}); // Dọn dẹp file tạm
        res.json(result);
    } catch (err) {
        fs.unlink(req.file.path, () => {});
        res.status(500).json({ success: false, error: err.message });
    }
});

// ----------------------------------------------------------------------------
// KHỞI ĐỘNG MÁY CHỦ
// ----------------------------------------------------------------------------
server.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`  HỆ THỐNG QUẢN LÝ BÃI ĐỖ XE PHÂN TÁN (MULTI-NODE)`);
    console.log(`  - Dashboard Quản Trị : http://localhost:${PORT}`);
    console.log(`  - Màn hình Cổng phụ : http://localhost:${PORT}/gate-display`);
    console.log(`  - Giao thức Socket   : Socket.IO & WebSocket Port ${PORT}`);
    console.log(`======================================================\n`);
});
