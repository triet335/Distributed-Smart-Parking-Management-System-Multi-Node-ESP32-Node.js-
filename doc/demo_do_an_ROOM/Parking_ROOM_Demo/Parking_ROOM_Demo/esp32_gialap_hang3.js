'use strict';
// Gia lap ESP32_003 quan ly 3 cho do Hang 3. Chay rieng: npm run sim3.
const io = require('socket.io-client');
const socket = io('http://localhost:3000', { transports: ['websocket'] });
const DEVICE_ID = 'ESP32_003';
const slots = [1, 0, 1]; // 0 = trong, 1 = co xe
let fire = false;
let buzzer = false;

function sendStatus() {
  if (!socket.connected) return;
  socket.emit('status', { slots: slots.slice(), fire, relay: fire, buzzer });
}

socket.on('connect', () => {
  console.log('[SIM H3] Da ket noi, dang ky:', DEVICE_ID);
  socket.emit('register_device', DEVICE_ID);
  sendStatus();
});

socket.on('control', command => {
  if (!command || typeof command !== 'object') return;
  console.log('[SIM H3] Lenh duoc gui rieng qua ROOM:', command);
  if (command.action === 'request_status') {
    socket.emit('control_reply', { message: 'Hang 3 da nhan request_status' });
  } else if (command.action === 'toggle_slot' && [0, 1, 2].includes(command.slot)) {
    slots[command.slot] = slots[command.slot] ? 0 : 1;
    socket.emit('control_reply', { message: `Hang 3: da dao cho ${command.slot + 1}` });
  } else if (command.action === 'set_fire' && typeof command.fire === 'boolean') {
    fire = command.fire;
    if (!fire) buzzer = false;
    socket.emit('control_reply', { message: fire ? 'Hang 3: BAO CHAY' : 'Hang 3: an toan' });
  }
  sendStatus();
});

socket.on('disconnect', () => console.log('[SIM H3] Mat ket noi Server'));
setInterval(() => { buzzer = fire ? !buzzer : false; }, 500);
setInterval(sendStatus, 5000);
