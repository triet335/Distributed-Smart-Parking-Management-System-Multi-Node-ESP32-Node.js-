/** Local smoke test using an installed Chrome/Edge and its DevTools protocol. */
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { createParkingServer } = require('../server');
const output = path.join(__dirname, '..', '.qa');
const browserPath = process.env.CHROME_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(file => fs.existsSync(file));
async function waitFor(check) {
    for (let i = 0; i < 150; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
    throw new Error('Browser condition timed out');
}
async function main() {
    if (!browserPath) throw new Error('Cần Chrome/Edge, hoặc đặt biến CHROME_PATH.');
    fs.mkdirSync(output, { recursive: true });
    const parking = createParkingServer({ dataFile: null });
    parking.server.listen(0, '127.0.0.1'); await once(parking.server, 'listening');
    const base = `http://127.0.0.1:${parking.server.address().port}`;
    const devices = [];
    const receivedCommands = [];
    let chrome, cdp;
    try {
        for (const [id, initial] of [['ESP-01', 3], ['ESP-02', 0]]) {
            const ws = new WebSocket(`${base.replace('http:', 'ws:')}/ws?id=${id}`);
            await once(ws, 'open'); let byte = initial;
            ws.send(Buffer.from([byte])); ws.send(JSON.stringify({ type: 'state', buzzer: false }));
            ws.on('message', raw => {
                const command = JSON.parse(raw.toString());
                receivedCommands.push(command);
                if (command.cmd === 'extinguish') { byte = command.value ? byte | 32 : byte & ~32; ws.send(Buffer.from([byte])); }
                ws.send(JSON.stringify({ type: 'ack', ...command, success: true, buzzer: command.value }));
            });
            devices.push(ws);
        }
        chrome = spawn(browserPath, ['--headless=new', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${path.join(output, 'browser-profile')}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
        const endpoint = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Không khởi chạy được trình duyệt.')), 15000);
            chrome.on('error', reject);
            chrome.stderr.on('data', chunk => { const found = chunk.toString().match(/DevTools listening on (ws:\/\/[^\s]+)/); if (found) { clearTimeout(timer); resolve(found[1]); } });
        });
        const browserOrigin = endpoint.replace('ws:', 'http:').split('/devtools/')[0];
        const target = await (await fetch(`${browserOrigin}/json/new?about:blank`, { method: 'PUT' })).json();
        cdp = new WebSocket(target.webSocketDebuggerUrl); await once(cdp, 'open');
        const requests = new Map(); let sequence = 0; const errors = [];
        cdp.on('message', raw => { const data = JSON.parse(raw); if (data.id) { const request = requests.get(data.id); requests.delete(data.id); if (data.error) request.reject(new Error(data.error.message)); else request.resolve(data.result); } else if (data.method === 'Runtime.exceptionThrown') errors.push(data.params.exceptionDetails.text); });
        const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; requests.set(id, { resolve, reject }); cdp.send(JSON.stringify({ id, method, params })); });
        const evaluate = async expression => { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
        await send('Page.enable'); await send('Runtime.enable');
        await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
        await send('Page.navigate', { url: base });
        await waitFor(() => evaluate("document.querySelectorAll('.parking-row').length === 2 && document.querySelector('.live-label')?.textContent.includes('trực tiếp')"));
        await evaluate('document.fonts.ready.then(() => true)');
        assert.equal(await evaluate('document.fonts.check(\'16px "Be Vietnam Pro"\', "Bãi giữ xe — Điều khiển thiết bị")'), true, 'Vietnamese font did not load');
        assert.equal(await evaluate('Array.from(document.fonts).filter(font => font.family === "Be Vietnam Pro" && font.status === "loaded").length'), 3, 'All local font weights should load');
        // Test buttons only preview the fire effect; sensor data and hardware stay intact.
        const sensorSnapshot = () => [...parking.nodes.values()].map(({ id, bitmask, fireAlarm, buzzer, extinguish, irCount }) => ({ id, bitmask, fireAlarm, buzzer, extinguish, irCount }));
        const beforeTest = sensorSnapshot();
        const eventsBeforeTest = await (await fetch(`${base}/api/events`)).json();
        await evaluate("document.querySelector('[data-fire-test-id=\"ESP-01\"]').click()");
        await waitFor(() => evaluate("document.querySelectorAll('.fire-row').length === 1 && document.querySelector('.row-fire-badge')?.textContent === 'THỬ BÁO CHÁY'"));
        assert.equal(await evaluate("!!document.querySelector('.fire-banner')"), false);
        assert.equal(await evaluate("document.querySelector('[aria-label=\"Còi báo động\"]').getAttribute('aria-checked')"), 'false');
        await evaluate("document.querySelector('[data-fire-test-id=\"ESP-02\"]').click()");
        await waitFor(() => evaluate("document.querySelectorAll('.fire-row').length === 2"));
        await evaluate("document.querySelector('[data-fire-test-id=\"ESP-01\"]').click()");
        await waitFor(() => evaluate("document.querySelectorAll('.fire-row').length === 1 && document.querySelector('.fire-row').dataset.nodeId === 'ESP-02'"));
        await evaluate("document.querySelector('[data-fire-test-id=\"ESP-02\"]').click()");
        await waitFor(() => evaluate("document.querySelectorAll('.fire-row').length === 0"));
        assert.deepEqual(sensorSnapshot(), beforeTest, 'Fire test changed sensor/control data');
        assert.deepEqual(await (await fetch(`${base}/api/events`)).json(), eventsBeforeTest, 'Fire test changed event history');
        assert.equal(receivedCommands.length, 0, 'Fire test sent a command to ESP32');
        assert.equal(await evaluate("document.querySelectorAll('.parking-slot.occupied').length"), 2);
        assert.equal(await evaluate("document.querySelectorAll('.parking-slot.available').length"), 4);
        await evaluate("document.querySelector('[aria-label=\"Còi báo động\"]').click()");
        await waitFor(() => evaluate("document.querySelector('[aria-label=\"Còi báo động\"]').getAttribute('aria-checked') === 'true'"));
        await evaluate("document.querySelector('[aria-label=\"Relay chữa cháy\"]').click()");
        await waitFor(() => evaluate("document.querySelector('[aria-label=\"Relay chữa cháy\"]').getAttribute('aria-checked') === 'true'"));
        await evaluate("document.querySelectorAll('.zone-tabs button')[2].click()");
        await waitFor(() => evaluate("document.querySelectorAll('.parking-row').length === 1"));
        await evaluate("document.querySelector('.filter-summary button').click()");
        await waitFor(() => evaluate("document.querySelectorAll('.parking-row').length === 2"));
        await evaluate("Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Thêm thiết bị')).click()");
        await waitFor(() => evaluate("document.querySelector('dialog')?.open"));
        await evaluate("document.querySelector('[name=id]').value='ESP-QA'; document.querySelector('[name=name]').value='Hàng kiểm thử'; document.querySelector('dialog form').requestSubmit()");
        await waitFor(() => evaluate("!document.querySelector('dialog') && document.querySelectorAll('.parking-row').length === 3"));
        assert.equal(await evaluate("document.querySelectorAll('.parking-slot.unknown').length"), 3);
        await evaluate("document.querySelectorAll('.nav-item')[2].click()");
        await waitFor(() => evaluate("document.querySelectorAll('.device-card').length === 3"));
        await evaluate("document.querySelector('[data-fire-test-id=\"ESP-QA\"]').click()");
        await waitFor(() => evaluate("document.querySelector('[data-fire-test-id=\"ESP-QA\"]').getAttribute('aria-pressed') === 'true'"));
        await evaluate("document.querySelectorAll('.nav-item')[0].click()");
        await waitFor(() => evaluate("document.querySelector('.fire-row')?.dataset.nodeId === 'ESP-QA'"));
        assert.equal(await evaluate("document.querySelectorAll('.parking-slot.unknown').length"), 3);
        await evaluate("document.querySelector('[data-fire-test-id=\"ESP-QA\"]').click()");
        await waitFor(() => evaluate("document.querySelectorAll('.fire-row').length === 0"));
        await evaluate("document.querySelectorAll('.nav-item')[2].click()");
        await waitFor(() => evaluate("document.querySelectorAll('.device-card').length === 3"));
        await evaluate("document.querySelectorAll('.nav-item')[3].click()");
        await waitFor(() => evaluate("document.querySelectorAll('tbody tr').length >= 3"));
        await evaluate("document.querySelectorAll('.nav-item')[0].click()");
        await waitFor(() => evaluate("document.querySelectorAll('.parking-row').length === 3"));
        await evaluate("document.querySelector('.toast button')?.click()");
        await new Promise(resolve => setTimeout(resolve, 400));
        const desktop = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
        fs.writeFileSync(path.join(output, 'desktop.png'), Buffer.from(desktop.data, 'base64'));
        await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
        await new Promise(resolve => setTimeout(resolve, 250));
        assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, 'Mobile layout overflows');
        const mobile = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
        fs.writeFileSync(path.join(output, 'mobile.png'), Buffer.from(mobile.data, 'base64'));
        for (const width of [320, 768, 1024]) {
            await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 680 });
            await new Promise(resolve => setTimeout(resolve, 150));
            assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, `Layout overflows at ${width}px`);
        }
        // Two online ESP32s in the same zone must still have independent rows/alarms.
        await fetch(`${base}/api/nodes/ESP-02/setup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'update', name: 'Hàng B', zone: 'Zone_A', slots: 3 }) });
        await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
        await evaluate("Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Thêm thiết bị')).click()");
        await waitFor(() => evaluate("document.querySelector('dialog')?.open"));
        await evaluate("document.querySelector('[name=id]').value='ESP-01'; document.querySelector('[name=name]').value='Hàng trùng'; document.querySelector('dialog form').requestSubmit()");
        await waitFor(() => evaluate("document.querySelector('dialog .form-error')?.textContent.includes('đã quản lý')"));
        assert.equal(parking.nodes.get('ESP-01').name, 'Hàng A');
        await evaluate("document.querySelector('dialog [aria-label=\"Đóng cửa sổ\"]').click()");
        devices[0].send(Buffer.from([0x33]));
        await waitFor(() => evaluate("document.querySelectorAll('.fire-row').length === 1 && !!document.querySelector('.fire-banner')"));
        await evaluate("document.querySelector('[data-fire-test-id=\"ESP-01\"]').click()");
        await waitFor(() => evaluate("document.querySelector('[data-fire-test-id=\"ESP-01\"]').getAttribute('aria-pressed') === 'true'"));
        await evaluate("document.querySelector('[data-fire-test-id=\"ESP-01\"]').click()");
        await waitFor(() => evaluate("document.querySelector('[data-fire-test-id=\"ESP-01\"]').getAttribute('aria-pressed') === 'false'"));
        assert.equal(await evaluate("document.querySelector('.row-fire-badge').textContent"), 'BÁO CHÁY', 'Stopping a test must preserve a real fire alarm');
        assert.equal(await evaluate("document.querySelector('.fire-row').dataset.nodeId"), 'ESP-01');
        assert.equal(await evaluate("document.querySelectorAll('[data-node-id=\"ESP-01\"]').length"), 1);
        assert.equal(await evaluate("getComputedStyle(document.querySelector('[data-node-id=\"ESP-01\"]')).animationName"), 'fire-attention');
        assert.notEqual(await evaluate("getComputedStyle(document.querySelector('[data-node-id=\"ESP-02\"]')).animationName"), 'fire-attention');
        assert.equal(await evaluate("getComputedStyle(document.querySelector('.fire-row .parking-slot')).backgroundColor"), 'rgb(255, 243, 239)', 'Fire slot colors must override decorative colors');
        // The attention effect actually changes the row's rendered background.
        const pulseColors = await evaluate("(() => { const row = document.querySelector('.fire-row'); const pulse = row.getAnimations().find(a => a.animationName === 'fire-attention'); pulse.pause(); pulse.currentTime = 0; const first = getComputedStyle(row).backgroundColor; pulse.currentTime = 850; const second = getComputedStyle(row).backgroundColor; pulse.play(); return [first, second]; })()");
        assert.notEqual(pulseColors[0], pulseColors[1]);
        // An alarm stays discoverable even when the row is hidden by filters.
        await evaluate("document.querySelectorAll('.zone-tabs button')[3].click()");
        await waitFor(() => evaluate("document.querySelectorAll('.parking-row').length === 0"));
        await evaluate("Array.from(document.querySelectorAll('.fire-banner button')).find(b => b.textContent.includes('Đến hàng báo cháy')).click()");
        await waitFor(() => evaluate("document.activeElement?.id === 'parking-row-ESP-01' && document.querySelectorAll('.parking-row').length === 3"));
        await new Promise(resolve => setTimeout(resolve, 500));
        const fire = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
        fs.writeFileSync(path.join(output, 'fire.png'), Buffer.from(fire.data, 'base64'));
        await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
        await new Promise(resolve => setTimeout(resolve, 250));
        assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, 'Fire layout overflows mobile');
        const fireMobile = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
        fs.writeFileSync(path.join(output, 'fire-mobile.png'), Buffer.from(fireMobile.data, 'base64'));
        await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
        assert.equal(await evaluate("getComputedStyle(document.querySelector('.fire-row')).animationName"), 'none');
        assert.equal(await evaluate("document.querySelector('.row-fire-badge').textContent"), 'BÁO CHÁY');
        await send('Emulation.setEmulatedMedia', { features: [] });
        devices[1].send(Buffer.from([0x10]));
        await waitFor(() => evaluate("document.querySelectorAll('.fire-row').length === 2"));
        devices[0].send(Buffer.from([0x23]));
        await waitFor(() => evaluate("document.querySelectorAll('.fire-row').length === 1 && document.querySelector('.fire-row').dataset.nodeId === 'ESP-02'"));
        devices[1].close();
        await waitFor(() => evaluate("document.querySelector('.fire-row .row-fire-message')?.textContent.includes('mất kết nối')"));
        const reconnect = new WebSocket(`${base.replace('http:', 'ws:')}/ws?id=ESP-02`);
        devices.push(reconnect); await once(reconnect, 'open'); reconnect.send(Buffer.from([0]));
        await waitFor(() => evaluate("document.querySelectorAll('.fire-row').length === 0 && !document.querySelector('.fire-banner')"));
        assert.deepEqual(errors, [], 'Browser JavaScript errors');
        console.log('Browser checks passed: desktop/mobile, one ESP32 per row, controls, isolated fire pulse, simultaneous fires, alarm navigation, clearing/reconnection, reduced motion. Screenshots: .qa/');
        await send('Browser.close').catch(() => {});
    } finally {
        cdp?.close(); chrome?.kill(); for (const ws of devices) ws.terminate(); await parking.close();
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
