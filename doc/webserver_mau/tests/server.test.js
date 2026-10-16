const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const express = require('express');
const multer = require('multer');
const WebSocket = require('ws');
const { io } = require('socket.io-client');
const { createParkingServer } = require('../server');

async function setup(t, options = {}) {
    const parking = createParkingServer({ dataFile: null, commandTimeout: 250, ...options });
    parking.server.listen(0, '127.0.0.1');
    await once(parking.server, 'listening');
    const base = `http://127.0.0.1:${parking.server.address().port}`;
    t.after(() => parking.close());
    return { ...parking, base,
        get: async route => (await fetch(base + route)).json(),
        post: (route, body) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
        async device(id = 'ESP-01') {
            const ws = new WebSocket(`${base.replace('http:', 'ws:')}/ws?id=${id}`);
            await once(ws, 'open');
            return ws;
        }
    };
}
async function until(predicate, message = 'Timed out waiting for state') {
    for (let attempt = 0; attempt < 100; attempt++) {
        if (await predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(message);
}

test('new browser receives safe node snapshots while hardware is connected', async t => {
    const ctx = await setup(t);
    const ws = await ctx.device(); ws.send(Buffer.from([5]));
    await until(() => ctx.nodes.get('ESP-01').hasData);
    const socket = io(ctx.base, { transports: ['websocket'], reconnection: false });
    t.after(() => socket.disconnect());
    const [nodes] = await once(socket, 'init_nodes');
    assert.equal(nodes.find(node => node.id === 'ESP-01').bitmask, 5);
    assert.equal(nodes.find(node => node.id === 'ESP-01').online, true);
    assert.ok(nodes.every(node => !Object.hasOwn(node, 'wsClient')));
    assert.equal((await ctx.get('/api/health')).ok, true);
});

test('binary bitmask decodes sensors, IR counts rising edges, text never corrupts it', async t => {
    const ctx = await setup(t);
    const ws = await ctx.device();
    const node = ctx.nodes.get('ESP-01');
    ws.send(Buffer.from([0x7d]));
    await until(() => node.bitmask === 0x7d);
    assert.equal(node.fireAlarm, true); assert.equal(node.extinguish, true); assert.equal(node.fault, true);
    assert.equal(node.irCount, 1);
    ws.send(Buffer.from([0x7d])); ws.send('ping'); ws.send(JSON.stringify({ type: 'state', buzzer: true }));
    await until(() => node.buzzer === true);
    assert.equal(node.bitmask, 0x7d); assert.equal(node.irCount, 1);
    ws.send(Buffer.from([0])); ws.send(Buffer.from([8]));
    await until(() => node.irCount === 2);
    assert.equal((await ctx.get('/api/events')).filter(event => event.type === 'fire').length, 1);
    ws.send(Buffer.from([1, 2])); ws.send(Buffer.alloc(0));
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(node.bitmask, 8);
});

test('invalid controls/configuration rejected; offline device cannot report success', async t => {
    const ctx = await setup(t);
    assert.equal((await ctx.post('/api/nodes/ESP-01/control', { action: 'extinguish', state: true })).status, 409);
    assert.equal((await ctx.post('/api/nodes/ESP-01/control', { action: 'buzzer', state: 'false' })).status, 400);
    assert.equal((await ctx.post('/api/nodes/ESP-01/control', { action: 'unknown', state: true })).status, 400);
    assert.equal((await ctx.post('/api/nodes/ESP-01/setup', { name: 'Hàng A', zone: 'Zone_A', slots: 4 })).status, 400);
    assert.equal((await ctx.post('/api/nodes/ESP-01/setup', { name: 'Hàng A', zone: 'Zone_A', slots: 3 })).status, 200);
    ctx.nodes.get('ESP-01').irCount = 7;
    assert.equal((await ctx.post('/api/nodes/ESP-01/control', { action: 'reset_ir' })).status, 200);
    assert.equal(ctx.nodes.get('ESP-01').irCount, 0);
});

test('each ESP32 keeps one row; creating a second row with the same ID is rejected', async t => {
    const ctx = await setup(t);
    const config = { name: 'Hàng mới', zone: 'Zone_A', slots: 3 };
    assert.equal((await ctx.post('/api/nodes/ESP-01/setup', { ...config, mode: 'create' })).status, 409);
    assert.equal(ctx.nodes.get('ESP-01').name, 'Hàng A');
    assert.equal((await ctx.post('/api/nodes/ESP-06/setup', { ...config, mode: 'create' })).status, 200);
    assert.equal((await ctx.post('/api/nodes/ESP-06/setup', { ...config, name: 'Hàng thứ hai', mode: 'create' })).status, 409);
    assert.equal((await ctx.post('/api/nodes/ESP-06/setup', { ...config, name: 'Hàng đã cập nhật', mode: 'update' })).status, 200);
    assert.equal((await ctx.get('/api/nodes')).filter(node => node.id === 'ESP-06').length, 1);
    assert.equal(ctx.nodes.get('ESP-06').name, 'Hàng đã cập nhật');
});

test('buzzer control waits for matching ACK and updates confirmed physical state', async t => {
    const ctx = await setup(t);
    const ws = await ctx.device(); ws.send(Buffer.from([0]));
    await until(() => ctx.nodes.get('ESP-01').hasData);
    const incoming = once(ws, 'message');
    const response = ctx.post('/api/nodes/ESP-01/control', { action: 'buzzer', state: true });
    const [raw] = await incoming;
    const command = JSON.parse(raw.toString());
    assert.equal(command.cmd, 'buzzer'); assert.equal(command.value, true); assert.ok(command.requestId);
    ws.send(JSON.stringify({ type: 'ack', cmd: command.cmd, value: true, success: true, requestId: 'wrong-id' }));
    assert.equal(ctx.nodes.get('ESP-01').buzzer, null);
    ws.send(JSON.stringify({ type: 'ack', ...command, success: true, buzzer: true }));
    const result = await response;
    assert.equal(result.status, 200); assert.equal((await result.json()).node.buzzer, true);
    assert.equal(ctx.nodes.get('ESP-01').bitmask, 0);
});

test('legacy firmware confirms relay via bit 5; displayed state follows telemetry', async t => {
    const ctx = await setup(t);
    const ws = await ctx.device(); ws.send(Buffer.from([1]));
    await until(() => ctx.nodes.get('ESP-01').hasData);
    const incoming = once(ws, 'message');
    const response = ctx.post('/api/nodes/ESP-01/control', { action: 'extinguish', state: true });
    await incoming;
    assert.equal(ctx.nodes.get('ESP-01').extinguish, false);
    ws.send(Buffer.from([0x21]));
    assert.equal((await response).status, 200);
    assert.equal(ctx.nodes.get('ESP-01').extinguish, true);
});

test('unacknowledged commands time out and active fire prevents silencing buzzer', async t => {
    const ctx = await setup(t, { commandTimeout: 70 });
    const ws = await ctx.device(); ws.send(Buffer.from([0x10]));
    await until(() => ctx.nodes.get('ESP-01').hasData);
    assert.equal((await ctx.post('/api/nodes/ESP-01/control', { action: 'buzzer', state: false })).status, 409);
    const response = await ctx.post('/api/nodes/ESP-01/control', { action: 'extinguish', state: true });
    assert.equal(response.status, 504); assert.equal((await response.json()).success, false);
    assert.equal(ctx.nodes.get('ESP-01').extinguish, false);
});

test('replacing connection does not let old socket mark the new ESP32 offline', async t => {
    const ctx = await setup(t);
    await ctx.device();
    const replacement = await ctx.device(); replacement.send(Buffer.from([2]));
    await until(() => ctx.nodes.get('ESP-01').bitmask === 2);
    assert.equal(ctx.nodes.get('ESP-01').online, true);
    replacement.close();
    await until(() => !ctx.nodes.get('ESP-01').online);
    assert.equal(ctx.nodes.get('ESP-01').hasData, true); // stale reading is retained, clearly offline
});

test('configuration and IR counter survive restart without restoring live sensor data', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'parkflow-test-'));
    const dataFile = path.join(directory, 'parking.json');
    const first = createParkingServer({ dataFile });
    const node = first.nodes.get('ESP-01');
    node.name = 'Hàng kiểm thử'; node.irCount = 12; node.online = true; node.hasData = true; node.bitmask = 7;
    await first.close();
    const second = createParkingServer({ dataFile });
    t.after(async () => { await second.close(); fs.rmSync(directory, { recursive: true, force: true }); });
    assert.equal(second.nodes.get('ESP-01').name, 'Hàng kiểm thử');
    assert.equal(second.nodes.get('ESP-01').irCount, 12);
    assert.equal(second.nodes.get('ESP-01').online, false);
    assert.equal(second.nodes.get('ESP-01').hasData, false);
});

test('OTA forwards multipart firmware and only succeeds when device returns OK', async t => {
    const firmware = Buffer.alloc(20000, 0xe9);
    const fake = express();
    let received, reply = 'OK';
    fake.post('/update', multer({ storage: multer.memoryStorage() }).single('firmware'), (req, res) => { received = req.file.buffer; res.send(reply); });
    const deviceServer = http.createServer(fake);
    deviceServer.listen(0, '127.0.0.1'); await once(deviceServer, 'listening');
    t.after(() => new Promise(resolve => deviceServer.close(resolve)));
    const ctx = await setup(t, { otaPort: deviceServer.address().port });
    const ws = await ctx.device(); ws.send(Buffer.from([0]));
    await until(() => ctx.nodes.get('ESP-01').hasData);
    async function upload() {
        const body = new FormData(); body.append('firmware', new Blob([firmware]), 'firmware.bin');
        return fetch(`${ctx.base}/api/nodes/ESP-01/ota`, { method: 'POST', body });
    }
    assert.equal((await upload()).status, 200);
    assert.deepEqual(received, firmware);
    reply = 'FAIL';
    assert.equal((await upload()).status, 502);
    const invalid = new FormData(); invalid.append('firmware', new Blob(['hello']), 'firmware.txt');
    assert.equal((await fetch(`${ctx.base}/api/nodes/ESP-01/ota`, { method: 'POST', body: invalid })).status, 400);
});

test('standalone simulator registers three devices and executes dashboard commands', async t => {
    const ctx = await setup(t, { commandTimeout: 2000 });
    const simulator = spawn(process.execPath, [path.join(__dirname, '..', 'virtual_nodes.js')], {
        env: { ...process.env, SERVER_URL: ctx.base }, stdio: 'ignore', windowsHide: true
    });
    t.after(async () => { if (simulator.exitCode === null) { const done = once(simulator, 'exit'); simulator.kill(); await done; } });
    await until(() => ['ESP-03', 'ESP-04', 'ESP-05'].every(id => ctx.nodes.get(id)?.hasData));
    assert.equal(ctx.nodes.get('ESP-03').name, 'Hàng C · Mô phỏng');
    assert.equal((await ctx.post('/api/nodes/ESP-03/control', { action: 'buzzer', state: true })).status, 200);
    assert.equal(ctx.nodes.get('ESP-03').buzzer, true);
    assert.equal((await ctx.post('/api/nodes/ESP-04/control', { action: 'extinguish', state: true })).status, 200);
    assert.equal(ctx.nodes.get('ESP-04').extinguish, true);
});
