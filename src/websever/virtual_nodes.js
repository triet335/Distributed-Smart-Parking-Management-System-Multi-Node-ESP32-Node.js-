/**
 * ============================================================================
 * ĐỒ ÁN LẬP TRÌNH MẠNG (KC321) - ĐẠI HỌC CẦN THƠ
 * GIẢNG VIÊN HƯỚNG DẪN: TS. GVC. NGUYỄN VĂN KHANH (PLC & IIoT LAB)
 * 
 * SCRIPT MÔ PHỎNG 2 NODE ẢO: KHU C & KHU D (6 Ô ĐỖ ẢO)
 * Mục đích:
 * 1. Chứng minh kiến trúc mạng phân tán Socket.IO Rooms chịu tải tốt
 * 2. Mở rộng quy mô bãi xe lên 12+ ô đỗ mà không cần thêm phần cứng vật lý
 * 3. Hỗ trợ kiểm thử hệ thống bất cứ lúc nào không có kit ESP32
 * ============================================================================
 */

const WebSocket = require('ws');
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const WS_URL = SERVER_URL.replace(/^http/, 'ws');

const SIM_NODES = [
    { id: 'ESP_ZONE_C', name: 'Khu C (Mô phỏng)', zone: 'Zone_C' },
    { id: 'ESP_ZONE_D', name: 'Khu D (Mô phỏng)', zone: 'Zone_D' }
];

console.log(`[VIRTUAL NODES] Khởi chạy mô phỏng ${SIM_NODES.length} Node ảo tới ${SERVER_URL}...`);

SIM_NODES.forEach((config, idx) => {
    connectSimNode(config, idx);
});

function connectSimNode(config, index) {
    const wsUrl = `${WS_URL}/ws?id=${config.id}`;
    console.log(`[${config.id}] Đang kết nối tới ${wsUrl}...`);

    let ws;
    try {
        ws = new WebSocket(wsUrl);
    } catch (e) {
        console.error(`[${config.id}] Lỗi khởi tạo:`, e.message);
        setTimeout(() => connectSimNode(config, index), 3000);
        return;
    }

    let slots = [0, 0, 0];
    let light = false;
    let fire = false;
    let pump = false;
    let timer = null;

    ws.on('open', () => {
        console.log(`[${config.id}] TRỰC TUYẾN THÀNH CÔNG! Bắt đầu giả lập trạng thái.`);

        // Gửi trạng thái ban đầu (dạng 1-byte nhị phân)
        sendBinaryState(ws, slots, light, fire, pump);

        // Giả lập xe vào ra ngẫu nhiên mỗi 5 - 8 giây
        const interval = 5000 + (index * 2000);
        timer = setInterval(() => {
            const randomSlot = Math.floor(Math.random() * 3);
            slots[randomSlot] = slots[randomSlot] === 1 ? 0 : 1;
            console.log(`[${config.id}] Thay đổi trạng thái: Ô ${randomSlot + 1} -> ${slots[randomSlot] ? 'CÓ XE' : 'TRỐNG'}`);
            sendBinaryState(ws, slots, light, fire, pump);
        }, interval);
    });

    ws.on('message', (data) => {
        try {
            const cmd = JSON.parse(data.toString());
            console.log(`[${config.id}] Nhận lệnh điều khiển:`, cmd);
            if (cmd.action === 'set_light') {
                light = Boolean(cmd.value);
            } else if (cmd.action === 'set_pump') {
                pump = Boolean(cmd.value);
            } else if (cmd.action === 'fire_alert') {
                fire = Boolean(cmd.value);
            } else if (cmd.action === 'reset_fire') {
                fire = false;
                pump = false;
            }
            sendBinaryState(ws, slots, light, fire, pump);
        } catch (e) {
            // Khung nhị phân hoặc tin thô
        }
    });

    ws.on('close', () => {
        console.warn(`[${config.id}] Mất kết nối. Thử kết nối lại sau 3 giây...`);
        if (timer) clearInterval(timer);
        setTimeout(() => connectSimNode(config, index), 3000);
    });

    ws.on('error', (err) => {
        console.error(`[${config.id}] Lỗi: ${err.message}`);
    });
}

function sendBinaryState(ws, slots, light, fire, pump) {
    if (ws.readyState !== WebSocket.OPEN) return;
    let byteVal = 0;
    if (slots[0]) byteVal |= (1 << 0);
    if (slots[1]) byteVal |= (1 << 1);
    if (slots[2]) byteVal |= (1 << 2);
    if (light)    byteVal |= (1 << 3);
    if (fire)     byteVal |= (1 << 4);
    if (pump)     byteVal |= (1 << 5);

    ws.send(Buffer.from([byteVal]));
}
