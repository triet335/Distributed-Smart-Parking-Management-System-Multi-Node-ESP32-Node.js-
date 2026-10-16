'use strict';
// Gia lap 1 ESP32 quan ly 3 cho do cua hang 2.
const io = require('socket.io-client');
const socket = io('http://localhost:3000', { transports: ['websocket'] });
const DEVICE_ID = 'ESP32_002';
const slots = [0, 1, 0]; // 0 = trong, 1 = co xe
let fire = false;
let buzzer = false;

function sendStatus() {
  if (!socket.connected) return;
  socket.emit('status', {
    slots: slots.slice(),
    fire,
    relay: fire,
    buzzer: fire && buzzer
  });
}

socket.on('connect', () => {
  console.log('[SIM] Ket noi. Dang ky:', DEVICE_ID);
  socket.emit('register_device', DEVICE_ID);
  sendStatus();
});

socket.on('control', cmd => {
  console.log('[SIM] Lenh tu ROOM:', cmd);
  if (!cmd || typeof cmd !== 'object') return;
  if (cmd.action === 'request_status') {
    socket.emit('control_reply', { message: 'Hang 2 da nhan request_status' });
  } else if (cmd.action === 'toggle_slot' && [0, 1, 2].includes(cmd.slot)) {
    slots[cmd.slot] = slots[cmd.slot] === 1 ? 0 : 1;
    socket.emit('control_reply', { message: `Da dao trang thai cho ${cmd.slot + 1}` });
  } else if (cmd.action === 'set_fire' && typeof cmd.fire === 'boolean') {
    fire = cmd.fire;
    if (!fire) buzzer = false;
    socket.emit('control_reply', { message: fire ? 'Gia lap bao chay' : 'Gia lap het chay' });
  }
  sendStatus();
});

socket.on('disconnect', () => console.log('[SIM] Mat ket noi server'));

// LED gia lap nhap nhay 500ms / lan khi co chay.
setInterval(() => { if (fire) buzzer = !buzzer; else buzzer = false; }, 500);
// Heartbeat / trang thai moi 5 giay (theo tinh than bai giang).
setInterval(sendStatus, 5000);
