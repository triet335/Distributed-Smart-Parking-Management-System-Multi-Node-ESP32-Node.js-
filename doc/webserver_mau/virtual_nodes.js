/** Three clearly named simulated ESP32 nodes, including command acknowledgments. */
const WebSocket = require('ws');
const baseURL = process.env.SERVER_URL || `http://localhost:${process.env.PORT || 3000}`;
const configs = [
    { id: 'ESP-03', name: 'Hàng C · Mô phỏng', zone: 'Zone_C', slots: 3 },
    { id: 'ESP-04', name: 'Hàng D · Mô phỏng', zone: 'Zone_C', slots: 3 },
    { id: 'ESP-05', name: 'Hàng E · Mô phỏng', zone: 'Zone_B', slots: 3 }
];
let stopping = false;
const clients = new Set();
const reconnects = new Set();
console.log(`ESP32 mô phỏng → ${baseURL}. Ctrl+C để dừng.`);
async function connect(config, index) {
    if (stopping) return;
    try {
        const response = await fetch(`${baseURL}/api/nodes/${config.id}/setup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config), signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error('Không đăng ký được cấu hình.');
    } catch (error) {
        console.error(`[${config.id}] ${error.message}. Thử lại sau 3 giây.`);
        retry(config, index); return;
    }
    if (stopping) return;
    const target = new URL('/ws', baseURL); target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:'; target.searchParams.set('id', config.id);
    const ws = new WebSocket(target);
    clients.add(ws);
    let slots = 0, relay = false, buzzer = false, ir = false, interval, pulse;
    function send() { if (ws.readyState === WebSocket.OPEN) ws.send(Buffer.from([slots | (ir ? 8 : 0) | (relay ? 32 : 0)])); }
    ws.on('open', () => {
        console.log(`[${config.id}] Trực tuyến`);
        send(); ws.send(JSON.stringify({ type: 'state', buzzer }));
        interval = setInterval(() => {
            slots ^= 1 << Math.floor(Math.random() * 3);
            ir = true; send();
            pulse = setTimeout(() => { ir = false; send(); }, 100);
        }, 4000 + index * 1200);
    });
    ws.on('message', message => {
        const text = message.toString();
        if (text === 'ping') { ws.send('pong'); return; }
        try {
            const command = JSON.parse(text);
            const supported = ['buzzer', 'extinguish'].includes(command.cmd) && typeof command.value === 'boolean';
            if (supported) {
                if (command.cmd === 'buzzer') buzzer = command.value;
                else relay = command.value;
                send();
                ws.send(JSON.stringify({ type: 'state', buzzer }));
            }
            ws.send(JSON.stringify({ type: 'ack', requestId: command.requestId, cmd: command.cmd, value: command.value, success: supported, buzzer }));
            console.log(`[${config.id}] ${command.cmd} = ${command.value}`);
        } catch { /* Ignore non-JSON frames. */ }
    });
    ws.on('close', () => { clearInterval(interval); clearTimeout(pulse); clients.delete(ws); retry(config, index); });
    ws.on('error', error => console.error(`[${config.id}] ${error.message}`));
}
function retry(config, index) {
    if (stopping) return;
    const timer = setTimeout(() => { reconnects.delete(timer); connect(config, index); }, 3000);
    reconnects.add(timer);
}
for (const [index, config] of configs.entries()) connect(config, index);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    stopping = true;
    for (const timer of reconnects) clearTimeout(timer);
    for (const ws of clients) ws.terminate();
});
