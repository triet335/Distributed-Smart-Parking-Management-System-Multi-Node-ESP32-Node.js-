'use strict';
// Demo mang LAN, Socket.IO 2.4.1. 4 hang x 3 cho = 12 cho.
const http = require('http');
const fs = require('fs');
const path = require('path');
const socketIO = require('socket.io');

const PORT = 3000;
const CONFIG = {
  ESP32_001: { row: 1, type: 'real' },
  ESP32_002: { row: 2, type: 'sim' },
  ESP32_003: { row: 3, type: 'sim' },
  ESP32_004: { row: 4, type: 'real' }
};
const devices = new Map();
const history = [];
const HISTORY_LIMIT = 100;

for (const [deviceId, info] of Object.entries(CONFIG)) {
  devices.set(deviceId, {
    deviceId, row: info.row, type: info.type,
    socketId: null, online: false,
    slots: [null, null, null], fire: null, relay: null, buzzer: null,
    lastSeen: null
  });
}

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(path.join(__dirname, 'web', 'index.html')).pipe(res);
    return;
  }
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, data: getSnapshot() }));
    return;
  }
  res.writeHead(404);
  res.end('Not found');
});

const io = socketIO(server, { origins: '*:*' }); // Tuong thich bai giang Socket.IO 2.4.1

function writeHistory(message) {
  history.unshift({ time: Date.now(), message });
  if (history.length > HISTORY_LIMIT) history.pop();
}

function getSnapshot() {
  const rows = Array.from(devices.values()).map(d => ({
    deviceId: d.deviceId, row: d.row, type: d.type, online: d.online,
    // Trang thai cu khong duoc xem la trang thai hien tai khi offline
    slots: d.online ? d.slots.slice() : [null, null, null],
    fire: d.online ? d.fire : null,
    relay: d.online ? d.relay : null,
    buzzer: d.online ? d.buzzer : null,
    lastSeen: d.lastSeen
  }));
  const allSlots = rows.flatMap(d => d.slots);
  return {
    rows,
    total: rows.length * 3,
    occupied: allSlots.filter(s => s === 1).length,
    free: allSlots.filter(s => s === 0).length,
    unknown: allSlots.filter(s => s === null).length,
    anyFire: rows.some(d => d.fire === true),
    history: history.slice()
  };
}

function broadcast() {
  io.to('dashboard').emit('snapshot', getSnapshot());
}

function validateSlots(value) {
  return Array.isArray(value) && value.length === 3 &&
    value.every(x => x === 0 || x === 1 || x === null);
}

io.on('connection', socket => {
  console.log('[CONNECT]', socket.id);

  // Web tham gia ROOM dashboard de nhan so lieu cua tat ca cac hang.
  socket.on('register_web', () => {
    if (socket.deviceId) return;
    socket.isWeb = true;
    socket.join('dashboard');
    socket.emit('snapshot', getSnapshot());
    console.log('[WEB JOIN] dashboard:', socket.id);
  });

  // Moi ESP32 tham gia ROOM rieng theo deviceId va ROOM theo hang.
  socket.on('register_device', deviceId => {
    if (socket.isWeb || typeof deviceId !== 'string' || !devices.has(deviceId)) {
      socket.emit('notice', 'Device ID khong hop le');
      return;
    }
    if (socket.deviceId && socket.deviceId !== deviceId) return;
    const d = devices.get(deviceId);
    if (d.socketId && d.socketId !== socket.id) {
      const previous = io.sockets.connected[d.socketId];
      if (previous) previous.disconnect(true);
    }

    socket.deviceId = deviceId;
    socket.join(`device_${deviceId}`);
    socket.join(`row_${d.row}`);
    d.socketId = socket.id;
    d.online = true;
    d.lastSeen = Date.now();
    d.slots = [null, null, null];
    d.fire = null; d.relay = null; d.buzzer = null;
    writeHistory(`Hàng ${d.row}: ${deviceId} đã kết nối`);
    console.log(`[JOIN] ${deviceId} -> device_${deviceId}, row_${d.row}`);
    broadcast();
  });

  // ESP32/bo gia lap gui du lieu tu cam bien ve Server.
  socket.on('status', raw => {
    if (!socket.deviceId) return;
    let state = raw;
    if (typeof state === 'string') {
      try { state = JSON.parse(state); } catch (_) { return; }
    }
    if (!state || typeof state !== 'object' || !validateSlots(state.slots) ||
        typeof state.fire !== 'boolean') return;
    const d = devices.get(socket.deviceId);
    if (!d || d.socketId !== socket.id) return;

    // Chi ghi lich su xe vao/ra neu gia tri truoc va sau deu da biet.
    state.slots.forEach((next, index) => {
      const before = d.slots[index];
      if (before !== null && next !== null && before !== next) {
        writeHistory(`Hàng ${d.row} - chỗ ${index + 1}: ${next ? 'Xe vào' : 'Xe ra'}`);
      }
    });
    if (d.fire !== null && d.fire !== state.fire) {
      writeHistory(`Hàng ${d.row}: ${state.fire ? 'CẢNH BÁO CHÁY' : 'Hết báo cháy'}`);
    } else if (d.fire === null && state.fire) {
      writeHistory(`Hàng ${d.row}: CẢNH BÁO CHÁY`);
    }
    if (!d.online) writeHistory(`Hàng ${d.row}: đã nhận lại dữ liệu`);
    d.slots = state.slots.slice();
    d.fire = state.fire;
    d.relay = typeof state.relay === 'boolean' ? state.relay : null;
    d.buzzer = typeof state.buzzer === 'boolean' ? state.buzzer : null;
    d.lastSeen = Date.now();
    d.online = true;
    broadcast();
  });

  // Lenh Web -> Server -> dung ROOM cua 1 ESP32.
  socket.on('control_device', input => {
    if (!socket.isWeb || !input || typeof input !== 'object') return;
    const { deviceId, action } = input;
    if (typeof deviceId !== 'string' || !devices.has(deviceId)) return;
    const d = devices.get(deviceId);
    if (!d.online) {
      socket.emit('notice', `Hàng ${d.row} (${deviceId}) đang offline`);
      return;
    }
    const command = { action };
    if (action === 'request_status') {
      // Su dung duoc cho ca 2 ESP32 that va 2 ESP32 gia lap.
    } else if (d.type === 'sim' && action === 'toggle_slot' &&
               Number.isInteger(input.slot) && input.slot >= 0 && input.slot < 3) {
      command.slot = input.slot;
    } else if (d.type === 'sim' && action === 'set_fire' &&
               typeof input.fire === 'boolean') {
      command.fire = input.fire;
    } else {
      socket.emit('notice', 'Lenh khong duoc ho tro cho thiet bi nay');
      return;
    }
    io.to(`device_${deviceId}`).emit('control', command);
    console.log('[ROOM SEND]', `device_${deviceId}`, command);
    socket.emit('notice', `Đã gửi ${action} tới ROOM device_${deviceId}`);
  });

  socket.on('control_reply', raw => {
    if (!socket.deviceId) return;
    const d = devices.get(socket.deviceId);
    if (!d || d.socketId !== socket.id) return;
    let data = raw;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch (_) { data = {}; }
    }
    const message = data && typeof data.message === 'string'
      ? data.message.slice(0, 120) : 'Đã nhận lệnh';
    io.to('dashboard').emit('control_reply', {
      deviceId: d.deviceId, message, time: Date.now()
    });
  });

  socket.on('disconnect', () => {
    if (socket.deviceId) {
      const d = devices.get(socket.deviceId);
      if (d && d.socketId === socket.id) {
        d.socketId = null;
        d.online = false;
        writeHistory(`Hàng ${d.row}: ${d.deviceId} ngắt kết nối`);
        broadcast();
      }
    }
    console.log('[DISCONNECT]', socket.id);
  });
});

// Qua 15 giay khong co status: coi la offline de tranh hien du lieu cu.
setInterval(() => {
  let changed = false;
  const now = Date.now();
  for (const d of devices.values()) {
    if (d.online && d.lastSeen !== null && now - d.lastSeen > 15000) {
      d.online = false;
      writeHistory(`Hàng ${d.row}: mất dữ liệu quá 15 giây`);
      changed = true;
    }
  }
  if (changed) broadcast();
}, 3000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Parking ROOM 4 hang: http://localhost:${PORT}`);
  console.log('Gia lap: npm run sim2  |  npm run sim3 (2 terminal rieng)');
});
