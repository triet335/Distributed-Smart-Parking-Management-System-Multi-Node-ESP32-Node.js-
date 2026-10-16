/**
 * ============================================================================
 * ĐỒ ÁN LẬP TRÌNH MẠNG (KC321) - ĐẠI HỌC CẦN THƠ
 * GIẢNG VIÊN HƯỚNG DẪN: TS. GVC. NGUYỄN VĂN KHANH (PLC & IIoT LAB)
 * 
 * JAVASCRIPT ĐIỀU KHIỂN GIAO DIỆN WEB DASHBOARD (Socket.IO Realtime)
 * ============================================================================
 */

const socket = io();

// State cache
let currentSnapshot = null;
let currentEvents = [];

// DOM Elements
const $ = (id) => document.getElementById(id);

// 1. KẾT NỐI SOCKET.IO
socket.on('connect', () => {
    $('connBadge').className = 'badge badge-online';
    $('connBadge').textContent = '🟢 Máy chủ trực tuyến';
    socket.emit('register_web');
    console.log('[Socket.IO] Đã kết nối với máy chủ');
});

socket.on('disconnect', () => {
    $('connBadge').className = 'badge badge-offline';
    $('connBadge').textContent = '🔴 Mất kết nối máy chủ';
    console.warn('[Socket.IO] Mất kết nối máy chủ');
});

// 2. NHẬN SNAPSHOT TRẠNG THÁI HỆ THỐNG
socket.on('snapshot', (data) => {
    currentSnapshot = data;
    renderSnapshot(data);
});

// 3. NHẬN SỰ KIỆN MỚI
socket.on('new_event', (eventItem) => {
    currentEvents.unshift(eventItem);
    if (currentEvents.length > 100) currentEvents.pop();
    renderLogTable(currentEvents);
});

// 4. TIẾN TRÌNH STREAM FIRMWARE WEB OTA
socket.on('ota_progress', (progress) => {
    $('otaProgressBox').classList.remove('hidden');
    $('otaProgressBar').style.width = `${progress.percent}%`;
    if (progress.status === 'uploading') {
        $('otaStatusText').textContent = `Đang Stream: ${progress.percent}% (${Math.round(progress.uploadedBytes / 1024)} KB / ${Math.round(progress.totalSize / 1024)} KB)`;
    } else if (progress.status === 'flashing') {
        $('otaStatusText').textContent = 'Đã truyền xong! Đang ghi Flash...';
    } else if (progress.status === 'success') {
        $('otaStatusText').textContent = '🎉 Nạp thành công! ESP32 đang khởi động lại.';
        $('otaProgressBar').style.background = '#16a34a';
    } else if (progress.status === 'error') {
        $('otaStatusText').textContent = `❌ Lỗi: ${progress.message}`;
        $('otaProgressBar').style.background = '#dc2626';
    }
});

// ----------------------------------------------------------------------------
// RENDER GIAO DIỆN TỪ SNAPSHOT
// ----------------------------------------------------------------------------
function renderSnapshot(data) {
    if (!data || !data.summary) return;
    const s = data.summary;
    const devs = new Map(data.devices.map(d => [d.id, d]));

    // A. Cập nhật thẻ KPI
    $('kpiTotal').textContent = s.totalSlots;
    $('kpiOccupied').textContent = s.occupied;
    $('kpiFree').textContent = s.free;
    $('kpiVehicles').textContent = s.vehiclesCount;

    if (s.free === 0) {
        $('kpiFreeStatus').textContent = '⚠️ BÃI XE ĐÃ ĐẦY';
        $('kpiFreeStatus').style.color = '#dc2626';
    } else {
        $('kpiFreeStatus').textContent = 'Sẵn sàng đón xe';
        $('kpiFreeStatus').style.color = '#16a34a';
    }

    // B. Cảnh báo cháy Banner
    if (s.isAnyFire) {
        $('fireBanner').classList.remove('hidden');
    } else {
        $('fireBanner').classList.add('hidden');
    }

    // C. Cập nhật Node Cổng (ESP_GATE)
    const gate = devs.get('ESP_GATE');
    if (gate) {
        $('gateNodeStatus').className = `node-pill ${gate.online ? 'pill-online' : 'pill-offline'}`;
        $('gateNodeStatus').textContent = `ESP_GATE: ${gate.online ? 'Trực tuyến' : 'Ngoại tuyến'}`;

        const isOpened = gate.barieState === 'opened' || gate.barieState === 'emergency_open';
        const armSvg = $('barrierArmSvg');
        if (armSvg) armSvg.style.transform = isOpened ? 'rotate(-70deg)' : 'rotate(0deg)';
        const led = $('barrierLed');
        if (led) led.setAttribute('fill', isOpened ? '#22c55e' : '#ef4444');
        $('barrierText').className = isOpened ? 'state-opened' : 'state-closed';
        $('barrierText').textContent = gate.barieState === 'emergency_open'
            ? 'MỞ TOANG THOÁT HIỂM (90°)'
            : isOpened ? 'ĐANG MỞ (90°)' : 'ĐANG ĐÓNG (0°)';

        $('nfcUid').textContent = gate.lastUid || 'CHƯA QUẸT THẺ';

        // Badge hành động NFC
        if (gate.lastAction === 'IN') {
            $('nfcAction').className = 'badge badge-online';
            $('nfcAction').textContent = 'VÀO BÃI (Hợp lệ)';
        } else if (gate.lastAction === 'OUT') {
            $('nfcAction').className = 'badge badge-primary';
            $('nfcAction').textContent = 'RA BÃI (Hợp lệ)';
        } else if (gate.lastAction === 'FULL_REJECT') {
            $('nfcAction').className = 'badge badge-offline';
            $('nfcAction').textContent = 'TỪ CHỐI (Bãi đầy)';
        } else if (gate.lastAction === 'REJECT') {
            $('nfcAction').className = 'badge badge-offline';
            $('nfcAction').textContent = 'TỪ CHỐI (Thẻ lạ)';
        } else {
            $('nfcAction').className = 'badge badge-gray';
            $('nfcAction').textContent = '--';
        }

        // Mức sáng LDR Cổng
        if (gate.ldrDark) {
            $('ambientBadge').className = 'badge badge-dark';
            $('ambientBadge').textContent = '🌙 Trời Tối (Đèn bật)';
            $('nfcLdrStatus').className = 'badge badge-dark';
            $('nfcLdrStatus').textContent = 'Trời Tối';
        } else {
            $('ambientBadge').className = 'badge badge-light';
            $('ambientBadge').textContent = '☀️ Trời Sáng (Đèn tắt)';
            $('nfcLdrStatus').className = 'badge badge-light';
            $('nfcLdrStatus').textContent = 'Trời Sáng';
        }
    }

    // D. Cập nhật Khu A (Slot 1, 2, 3)
    const zoneA = devs.get('ESP_ZONE_A');
    if (zoneA) {
        $('zoneAStatus').className = `node-pill ${zoneA.online ? 'pill-online' : 'pill-offline'}`;
        $('zoneAStatus').textContent = `ESP_ZONE_A: ${zoneA.online ? 'Trực tuyến' : 'Offline'}`;

        $('lightBadgeA').className = `ind-badge ${zoneA.light ? 'active-light' : ''}`;
        $('lightBadgeA').textContent = `💡 Đèn: ${zoneA.light ? 'BẬT' : 'Tắt'}`;

        $('fireBadgeA').className = `ind-badge ${zoneA.fire ? 'active-fire' : ''}`;
        $('fireBadgeA').textContent = `🚨 PCCC: ${zoneA.fire ? 'BÁO CHÁY!' : 'An toàn'}`;

        $('pumpBadgeA').className = `ind-badge ${zoneA.pump ? 'active-pump' : ''}`;
        $('pumpBadgeA').textContent = `💧 Bơm: ${zoneA.pump ? 'PHUN NƯỚC' : 'Tắt'}`;

        updateSlotBox(1, zoneA.slots ? zoneA.slots[0] : 0, zoneA.online);
        updateSlotBox(2, zoneA.slots ? zoneA.slots[1] : 0, zoneA.online);
        updateSlotBox(3, zoneA.slots ? zoneA.slots[2] : 0, zoneA.online);
    }

    // E. Cập nhật Khu B (Slot 4, 5, 6)
    const zoneB = devs.get('ESP_ZONE_B');
    if (zoneB) {
        $('zoneBStatus').className = `node-pill ${zoneB.online ? 'pill-online' : 'pill-offline'}`;
        $('zoneBStatus').textContent = `ESP_ZONE_B: ${zoneB.online ? 'Trực tuyến' : 'Offline'}`;

        $('lightBadgeB').className = `ind-badge ${zoneB.light ? 'active-light' : ''}`;
        $('lightBadgeB').textContent = `💡 Đèn: ${zoneB.light ? 'BẬT' : 'Tắt'}`;

        $('fireBadgeB').className = `ind-badge ${zoneB.fire ? 'active-fire' : ''}`;
        $('fireBadgeB').textContent = `🚨 PCCC: ${zoneB.fire ? 'BÁO CHÁY!' : 'An toàn'}`;

        $('pumpBadgeB').className = `ind-badge ${zoneB.pump ? 'active-pump' : ''}`;
        $('pumpBadgeB').textContent = `💧 Bơm: ${zoneB.pump ? 'PHUN NƯỚC' : 'Tắt'}`;

        updateSlotBox(4, zoneB.slots ? zoneB.slots[0] : 0, zoneB.online);
        updateSlotBox(5, zoneB.slots ? zoneB.slots[1] : 0, zoneB.online);
        updateSlotBox(6, zoneB.slots ? zoneB.slots[2] : 0, zoneB.online);
    }

    // F. Cập nhật Khu C & Khu D mô phỏng
    const zoneC = devs.get('ESP_ZONE_C');
    if (zoneC) {
        $('simStatusC').className = `badge ${zoneC.online ? 'badge-online' : 'badge-gray'}`;
        $('simStatusC').textContent = zoneC.online ? 'Đang chạy' : 'Offline';
        updateSimSlot('slotC1', 7, zoneC.slots ? zoneC.slots[0] : 0, zoneC.online);
        updateSimSlot('slotC2', 8, zoneC.slots ? zoneC.slots[1] : 0, zoneC.online);
        updateSimSlot('slotC3', 9, zoneC.slots ? zoneC.slots[2] : 0, zoneC.online);
    }

    const zoneD = devs.get('ESP_ZONE_D');
    if (zoneD) {
        $('simStatusD').className = `badge ${zoneD.online ? 'badge-online' : 'badge-gray'}`;
        $('simStatusD').textContent = zoneD.online ? 'Đang chạy' : 'Offline';
        updateSimSlot('slotD1', 10, zoneD.slots ? zoneD.slots[0] : 0, zoneD.online);
        updateSimSlot('slotD2', 11, zoneD.slots ? zoneD.slots[1] : 0, zoneD.online);
        updateSimSlot('slotD3', 12, zoneD.slots ? zoneD.slots[2] : 0, zoneD.online);
    }

    // G. Bảng sự kiện ban đầu
    if (data.events && currentEvents.length === 0) {
        currentEvents = data.events;
        renderLogTable(currentEvents);
    }
}

function updateSlotBox(slotNum, state, isOnline) {
    const box = $(`slotBox${slotNum}`);
    const car = $(`slotCar${slotNum}`);
    const status = $(`slotStatus${slotNum}`);
    if (!box) return;

    if (!isOnline) {
        box.className = 'slot-box slot-offline';
        car.textContent = '⚪';
        status.textContent = 'MẤT MẠNG';
    } else if (state === 1) {
        box.className = 'slot-box slot-occupied';
        car.textContent = '🚗';
        status.textContent = 'CÓ XE';
    } else {
        box.className = 'slot-box slot-free';
        car.textContent = '🅿️';
        status.textContent = 'TRỐNG';
    }
}

function updateSimSlot(elemId, slotNum, state, isOnline) {
    const elem = $(elemId);
    if (!elem) return;
    if (!isOnline) {
        elem.className = 'sim-slot';
        elem.style.background = '#e2e8f0';
        elem.style.color = '#64748b';
        elem.textContent = `Ô ${slotNum}: Offline`;
    } else if (state === 1) {
        elem.className = 'sim-slot occupied';
        elem.textContent = `Ô ${slotNum}: Có xe`;
    } else {
        elem.className = 'sim-slot free';
        elem.textContent = `Ô ${slotNum}: Trống`;
    }
}

function renderLogTable(list) {
    const tbody = $('logTbody');
    if (!tbody) return;
    if (!list || list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="text-center muted-text">Chưa có sự kiện nào</td></tr>';
        return;
    }

    tbody.innerHTML = list.map(ev => {
        const timeStr = new Date(ev.time).toLocaleTimeString('vi-VN');
        let typeBadge = '<span class="badge badge-gray">HỆ THỐNG</span>';
        if (ev.type === 'IN') typeBadge = '<span class="badge badge-online">VÀO BÃI</span>';
        else if (ev.type === 'OUT') typeBadge = '<span class="badge badge-primary">RA BÃI</span>';
        else if (ev.type === 'REJECT') typeBadge = '<span class="badge badge-offline">TỪ CHỐI</span>';
        else if (ev.type === 'FIRE') typeBadge = '<span class="badge badge-offline" style="background:#dc2626">BÁO CHÁY</span>';
        else if (ev.type === 'LIGHT') typeBadge = '<span class="badge badge-light">CHIẾU SÁNG</span>';
        else if (ev.type === 'BARIE') typeBadge = '<span class="badge badge-primary">BARIE</span>';

        return `
            <tr>
                <td style="font-family:monospace; color:#64748b; white-space:nowrap">${timeStr}</td>
                <td>${typeBadge}</td>
                <td>${ev.message}</td>
            </tr>
        `;
    }).join('');
}

// ----------------------------------------------------------------------------
// GỬI LỆNH ĐIỀU KHIỂN TỚI SERVER
// ----------------------------------------------------------------------------
async function sendControl(nodeId, action, value = true) {
    try {
        const res = await fetch(`/api/nodes/${nodeId}/control`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, value })
        });
        const result = await res.json();
        if (!result.success) alert(`Lỗi: ${result.error}`);
    } catch (e) {
        alert(`Không thể kết nối máy chủ: ${e.message}`);
    }
}

// Gắn sự kiện các nút bấm
$('btnOpenBarie').addEventListener('click', () => sendControl('ESP_GATE', 'open_barie'));
$('btnCloseBarie').addEventListener('click', () => sendControl('ESP_GATE', 'close_barie'));
$('btnEmergencyOpen').addEventListener('click', () => sendControl('ESP_GATE', 'emergency_open'));

$('btnToggleLightA').addEventListener('click', () => {
    const devs = new Map((currentSnapshot?.devices || []).map(d => [d.id, d]));
    const curA = devs.get('ESP_ZONE_A')?.light || false;
    sendControl('ESP_ZONE_A', 'set_light', !curA);
});

$('btnToggleLightB').addEventListener('click', () => {
    const devs = new Map((currentSnapshot?.devices || []).map(d => [d.id, d]));
    const curB = devs.get('ESP_ZONE_B')?.light || false;
    sendControl('ESP_ZONE_B', 'set_light', !curB);
});

$('btnTestFireA').addEventListener('click', () => sendControl('ESP_ZONE_A', 'test_fire'));
$('btnTestFireB').addEventListener('click', () => sendControl('ESP_ZONE_B', 'test_fire'));

$('btnResetFire').addEventListener('click', async () => {
    try {
        const res = await fetch('/api/system/reset-fire', { method: 'POST' });
        const result = await res.json();
        if (result.success) {
            $('fireBanner').classList.add('hidden');
        }
    } catch (e) {
        alert('Lỗi khi gửi lệnh reset: ' + e.message);
    }
});

// Xuất file CSV
$('btnExportCsv').addEventListener('click', () => {
    if (!currentEvents || currentEvents.length === 0) {
        alert('Chưa có dữ liệu nhật ký để xuất');
        return;
    }
    const header = ['ID', 'Thời gian', 'Phân loại', 'Nội dung'];
    const rows = currentEvents.map(e => [
        `"${e.id}"`,
        `"${new Date(e.time).toLocaleString('vi-VN')}"`,
        `"${e.type}"`,
        `"${e.message.replace(/"/g, '""')}"`
    ]);
    const csvContent = '\uFEFF' + [header.join(','), ...rows.map(r => r.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `nhat_ky_bai_xe_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
});

// Nạp firmware OTA
$('otaForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nodeId = $('otaNodeSelect').value;
    const file = $('otaFileInput').files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('firmware', file);

    $('otaProgressBox').classList.remove('hidden');
    $('otaProgressBar').style.width = '0%';
    $('otaProgressBar').style.background = '#1e40af';
    $('otaStatusText').textContent = 'Đang tải file lên máy chủ và khởi tạo luồng Stream...';

    try {
        const res = await fetch(`/api/nodes/${nodeId}/ota`, {
            method: 'POST',
            body: formData
        });
        const result = await res.json();
        if (!result.success) {
            $('otaStatusText').textContent = `❌ Lỗi: ${result.error}`;
            $('otaProgressBar').style.background = '#dc2626';
        }
    } catch (err) {
        $('otaStatusText').textContent = `❌ Lỗi kết nối: ${err.message}`;
        $('otaProgressBar').style.background = '#dc2626';
    }
});


// Gửi lệnh điều khiển tổng hợp (Master Controls)
async function sendMasterControl(action, value = true) {
    try {
        const res = await fetch('/api/system/control', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, value })
        });
        const result = await res.json();
        if (!result.success) alert(`Lỗi: ${result.error || result.message}`);
    } catch (e) {
        alert(`Không thể kết nối máy chủ: ${e.message}`);
    }
}

// Bảng điều khiển tổng
const bindIf = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
bindIf('btnAllLightsOn', () => sendMasterControl('all_lights', true));
bindIf('btnAllLightsOff', () => sendMasterControl('all_lights', false));
bindIf('btnMasterOpenAuto', () => sendMasterControl('open_barie_auto'));
bindIf('btnMasterClose', () => sendMasterControl('close_barie'));
bindIf('btnMasterEmergencyOpen', () => sendMasterControl('emergency_open'));
bindIf('btnMasterTestFire', () => sendMasterControl('test_fire_all'));
bindIf('btnMasterResetFire', async () => {
    try {
        const res = await fetch('/api/system/reset-fire', { method: 'POST' });
        const result = await res.json();
        if (result.success) $('fireBanner').classList.add('hidden');
    } catch (e) { alert('Lỗi: ' + e.message); }
});
