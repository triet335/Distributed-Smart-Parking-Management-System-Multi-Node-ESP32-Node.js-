import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import './styles.css';
import './visual-theme.css';

const ZONES = { Zone_A: 'Khu A', Zone_B: 'Khu B', Zone_C: 'Khu C' };
const NAV = [{ id: 'overview', icon: 'dashboard', name: 'Tổng quan' }, { id: 'parking', icon: 'parking', name: 'Sơ đồ bãi xe' }, { id: 'devices', icon: 'chip', name: 'Thiết bị ESP32' }, { id: 'activity', icon: 'history', name: 'Nhật ký hoạt động' }];
const EVENT_TYPES = { vehicle: 'Xe ra vào', connection: 'Kết nối', control: 'Điều khiển', warning: 'Cảnh báo', fire: 'Báo cháy', config: 'Cấu hình' };
// Visual tests stay in this browser session, separate from ESP32 sensor/control data.
const FireTestContext = createContext(null);
const paths = {
  dashboard: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  parking: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M9 17V7h5a3 3 0 0 1 0 6H9',
  chip: 'M7 7h10v10H7z M10 10h4v4h-4z M8 3v4 M16 3v4 M8 17v4 M16 17v4 M3 8h4 M3 16h4 M17 8h4 M17 16h4',
  history: 'M3 11a9 9 0 1 1 2.5 7 M3 4v7h7 M12 7v5l3 2',
  car: 'M4 10l2-6h12l2 6 M3 10h18v8H3z M6 18v3 M18 18v3 M6 14h2 M16 14h2',
  arrow: 'M5 12h14 M14 7l5 5-5 5',
  arrowUp: 'M6 16L18 4 M7 4h11v11',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4',
  drop: 'M12 2C9 7 4 11 4 15a8 8 0 0 0 16 0c0-4-5-8-8-13z M8 15a4 4 0 0 0 4 4',
  search: 'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  plus: 'M12 5v14 M5 12h14',
  download: 'M12 3v12 M7 10l5 5 5-5 M4 16v5h16v-5',
  wifi: 'M2 8a16 16 0 0 1 20 0 M5 12a11 11 0 0 1 14 0 M8 16a6 6 0 0 1 8 0 M12 20h.01',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z',
  chevron: 'M9 5l7 7-7 7',
  close: 'M6 6l12 12 M6 18L18 6',
  shield: 'M12 3l9 4v5c0 5-9 10-9 10S3 17 3 12V7z M8 12l3 3 5-6',
  reset: 'M3 10a9 9 0 1 1 2 8 M3 4v6h6',
  upload: 'M12 16V3 M7 8l5-5 5 5 M4 16v5h16v-5',
  warning: 'M12 3L1 21h22z M12 9v5 M12 17h.01',
  flame: 'M12 3c1 5 7 6 7 12a7 7 0 0 1-14 0c0-3 2-5 4-7 0 3 1 4 2 4 2-2 2-5 1-9z M12 14c-2 2-3 3-3 5a3 3 0 0 0 6 0c0-2-2-3-3-5z',
  help: 'M9 9a3 3 0 1 1 4 3c-1 1-1 2-1 3 M12 18h.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  clock: 'M12 7v5l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
};
function Icon({ name, size = 20, ...props }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d={paths[name] || paths.chip} /></svg>; }
const timeText = time => new Date(time).toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
const isReady = (node, connected) => connected && node.online && node.hasData && !node.fault;
const usedSlots = node => Array.from({ length: node.slots }, (_, i) => Boolean(node.bitmask & (1 << i))).filter(Boolean).length;
function since(time, now) { if (!time) return 'Chưa nhận dữ liệu'; const seconds = Math.max(0, Math.floor((now - time) / 1000)); return seconds < 2 ? 'Vừa cập nhật' : seconds < 60 ? `${seconds} giây trước` : `${Math.floor(seconds / 60)} phút trước`; }
async function api(url, body, timeout = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { method: 'POST', headers: body instanceof FormData ? undefined : { 'Content-Type': 'application/json' }, body: body instanceof FormData ? body : JSON.stringify(body), signal: controller.signal });
    const result = await response.json();
    if (!response.ok || result.success === false) throw new Error(result.error || 'Không thực hiện được yêu cầu.');
    return result;
  } catch (error) { throw new Error(error.name === 'AbortError' ? 'Quá thời gian chờ máy chủ.' : error.message); }
  finally { clearTimeout(timer); }
}
function downloadCSV(filename, rows) {
  const escape = value => `"${String(value ?? '').replace(/^[=+@-]/, "' $&").replaceAll('"', '""')}"`;
  const url = URL.createObjectURL(new Blob(['\uFEFF' + rows.map(row => row.map(escape).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function App() {
  const [fireTestIds, setFireTestIds] = useState([]);
  const toggleFireTest = id => setFireTestIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  const [page, setPage] = useState('overview');
  const [nodes, setNodes] = useState([]);
  const [events, setEvents] = useState([]);
  const [connected, setConnected] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [search, setSearch] = useState('');
  const [zone, setZone] = useState('all');
  const [status, setStatus] = useState('all');
  const [selectedId, setSelectedId] = useState('ESP-01');
  const [pending, setPending] = useState({});
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [ota, setOta] = useState({});
  const [focusRequest, setFocusRequest] = useState(null);
  const notify = (message, error = false) => setToast({ message, error, key: Date.now() });
  useEffect(() => {
    const socket = io({ reconnection: true });
    const update = node => setNodes(current => current.some(item => item.id === node.id) ? current.map(item => item.id === node.id ? { ...item, ...node } : item) : [...current, node]);
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => { setConnected(false); setPending({}); });
    socket.on('connect_error', () => setConnected(false));
    socket.on('init_nodes', data => { setNodes(data); setInitialized(true); });
    socket.on('init_events', setEvents);
    for (const event of ['node_configured', 'node_status_change', 'node_update_binary']) socket.on(event, update);
    socket.on('activity', event => setEvents(current => [event, ...current].slice(0, 200)));
    socket.on('node_control_pending', command => setPending(current => ({ ...current, [`${command.id}:${command.action}`]: true })));
    socket.on('node_control_applied', result => {
      update(result.node);
      setPending(current => { const next = { ...current }; delete next[`${result.id}:${result.action}`]; return next; });
    });
    socket.on('ota_progress', progress => setOta(current => ({ ...current, [progress.id]: progress })));
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { socket.disconnect(); clearInterval(timer); };
  }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), 6000); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    if (!focusRequest) return;
    const frame = requestAnimationFrame(() => {
      const row = document.getElementById(`parking-row-${focusRequest.id}`);
      if (!row) return;
      row.focus({ preventScroll: true });
      row.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusRequest]);
  function focusFire(id) {
    setZone('all'); setStatus('all'); setSearch(''); setSelectedId(id); setPage('parking');
    setFocusRequest({ id, time: Date.now() });
  }
  const all = nodes.slice().sort((a, b) => a.id.localeCompare(b.id));
  const shown = all.filter(node => (zone === 'all' || node.zone === zone) && (status === 'all' || (status === 'online' ? connected && node.online : !connected || !node.online)) && `${node.id} ${node.name} ${ZONES[node.zone]}`.toLowerCase().includes(search.toLowerCase().trim()));
  const selected = all.find(node => node.id === selectedId) || all[0];
  const total = all.reduce((sum, node) => sum + node.slots, 0);
  const valid = all.filter(node => isReady(node, connected));
  const occupied = valid.reduce((sum, node) => sum + usedSlots(node), 0);
  const known = valid.reduce((sum, node) => sum + node.slots, 0);
  const free = known - occupied;
  const online = all.filter(node => connected && node.online).length;
  const irCount = all.reduce((sum, node) => sum + node.irCount, 0);
  const fireNodes = all.filter(node => node.hasData && node.fireAlarm);
  const alerts = all.filter(node => node.fireAlarm || node.fault || !connected || !node.online);
  const rate = known ? Math.round(occupied / known * 100) : 0;
  async function control(node, action, state) {
    const key = `${node.id}:${action}`;
    setPending(current => ({ ...current, [key]: true }));
    try {
      await api(`/api/nodes/${encodeURIComponent(node.id)}/control`, { action, state });
      notify(action === 'reset_ir' ? 'Đã đặt lại bộ đếm IR.' : `${node.id} đã xác nhận lệnh điều khiển.`);
    } catch (error) { notify(error.message, true); }
    finally { setPending(current => { const next = { ...current }; delete next[key]; return next; }); }
  }
  function exportData() {
    if (page === 'activity') downloadCSV('parkflow-nhat-ky.csv', [['Thời gian', 'Loại', 'Thiết bị', 'Nội dung'], ...events.map(event => [new Date(event.time).toLocaleString('vi-VN'), EVENT_TYPES[event.type], event.nodeId, event.message])]);
    else downloadCSV('parkflow-bai-xe.csv', [['Thiết bị', 'Tên hàng', 'Khu vực', 'Kết nối', 'Tổng ô', 'Có xe', 'Còn trống', 'Lượt IR', 'Báo cháy'], ...shown.map(node => [node.id, node.name, ZONES[node.zone], connected && node.online ? 'Online' : 'Offline', node.slots, isReady(node, connected) ? usedSlots(node) : 'Chưa xác định', isReady(node, connected) ? node.slots - usedSlots(node) : 'Chưa xác định', node.irCount, node.hasData ? node.fireAlarm ? 'Có' : 'Không' : 'Chưa xác định'])]);
  }
  const filtering = zone !== 'all' || status !== 'all' || search.trim() !== '';
  const filters = <><div className="filter-bar"><div className="zone-tabs" aria-label="Lọc khu vực">{[['all', 'Tất cả khu vực'], ...Object.entries(ZONES)].map(([key, value]) => <button key={key} data-zone={key} aria-pressed={zone === key} className={zone === key ? 'active' : ''} onClick={() => setZone(key)}>{value}{key === 'all' && <span>{all.length}</span>}</button>)}</div><select aria-label="Lọc trạng thái kết nối" value={status} onChange={event => setStatus(event.target.value)}><option value="all">Tất cả trạng thái</option><option value="online">Đang kết nối</option><option value="offline">Mất kết nối</option></select></div>{filtering && <div className="filter-summary"><span role="status">Hiển thị <b>{shown.length}/{all.length}</b> hàng xe</span><button className="text-button" onClick={() => { setZone('all'); setStatus('all'); setSearch(''); }}><Icon name="close" size={15} />Xóa bộ lọc</button></div>}</>;

  return <FireTestContext.Provider value={{ ids: fireTestIds, toggle: toggleFireTest }}><div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#" onClick={event => { event.preventDefault(); setPage('overview'); }}><span className="brand-mark">P<span>↗</span></span><span>ParkFlow<small>SMART PARKING SYSTEM</small></span></a>
      <div className="workspace-label">KHÔNG GIAN QUẢN LÝ</div>
      <nav>{NAV.map(item => <button key={item.id} aria-current={page === item.id ? 'page' : undefined} aria-label={item.name} title={item.name} className={page === item.id ? 'nav-item active' : 'nav-item'} onClick={() => setPage(item.id)}><Icon name={item.icon} /><span>{item.name}</span>{item.id === 'devices' && <span className="nav-count">{all.length}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="system-card"><span className="system-icon"><Icon name="wifi" /></span><b>Kết nối hệ thống</b><p><span className={`dot ${connected ? 'green' : 'gray'}`} />{connected ? 'Máy chủ đang hoạt động' : 'Đang kết nối máy chủ…'}</p><div className="system-divider" /><span>{online}/{all.length} thiết bị trực tuyến</span></div><button className="nav-item" onClick={() => setModal({ type: 'help' })}><Icon name="help" />Hướng dẫn kết nối</button><div className="user-profile"><span className="avatar">N3</span><div><b>Nhóm 3 · KC321</b><small>Đại học Cần Thơ</small></div><Icon name="shield" size={18} /></div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar">
        <div className="breadcrumb">Không gian quản lý<Icon name="chevron" size={16} /><b>{NAV.find(item => item.id === page)?.name}</b></div>
        <label className="global-search"><Icon name="search" size={19} /><input aria-label="Tìm kiếm hàng xe hoặc thiết bị" value={search} onChange={event => setSearch(event.target.value)} placeholder="Tìm hàng xe, thiết bị…" /></label>
        <div className="topbar-right"><span className="live-label"><span className={`dot ${connected ? 'green' : 'gray'}`} />{connected ? 'Cập nhật trực tiếp' : 'Mất kết nối máy chủ'}</span><button className="icon-button notifications" title={`${alerts.length} thiết bị cần kiểm tra`} aria-label="Xem cảnh báo thiết bị" onClick={() => { setPage('devices'); setStatus('all'); setZone('all'); setSearch(''); }}><Icon name="bell" />{alerts.length > 0 && <i />}</button><span className="avatar small">N3</span></div>
      </header>
      <main key={page} className="page-content">
        <div className="page-heading"><div><div className="eyebrow">BÃI GIỮ XE THÔNG MINH</div><h1>{page === 'overview' ? 'Tổng quan bãi xe' : NAV.find(item => item.id === page)?.name}<span className="title-dot">.</span></h1><p>Giám sát tập trung, vận hành chủ động.</p></div><div className="heading-actions"><button className="button secondary" onClick={exportData}><Icon name="download" size={17} />Xuất dữ liệu</button><button className="button primary" onClick={() => setModal({ type: 'setup' })}><Icon name="plus" size={18} />Thêm thiết bị</button></div></div>
        {!connected && <div className="connection-notice" role="status"><Icon name="wifi" size={18} />Đang chờ kết nối máy chủ. Dữ liệu đã nhận được giữ lại để tham khảo; điều khiển tạm dừng.</div>}
        {fireNodes.length > 0 && <div className="fire-banner" role="alert"><span className="fire-banner-icon"><Icon name="flame" size={30} /></span><div><b>Cảnh báo cháy · {fireNodes.map(node => `${node.name} (${node.id})`).join(', ')}</b><p>Kiểm tra khu vực ngay. {fireNodes.some(node => !connected || !node.online) ? 'Có thiết bị đã mất kết nối: trạng thái cảnh báo cần được kiểm tra tại chỗ.' : 'Còi cảnh báo tự động được ưu tiên trên ESP32.'}</p><div className="fire-targets">{fireNodes.map(node => <button key={node.id} onClick={() => focusFire(node.id)}><Icon name="flame" size={15} />{node.name}<span>{node.id}</span><Icon name="arrow" size={14} /></button>)}</div></div><button className="button" onClick={() => focusFire(fireNodes[0].id)}>Đến hàng báo cháy<Icon name="arrow" size={16} /></button></div>}
        {page === 'overview' && <>
          <section className="welcome-banner">
            <div className="banner-content">
              <span className="banner-kicker"><span className={`dot ${connected && online > 0 ? 'green' : 'gray'}`} />TRUNG TÂM ĐIỀU HÀNH</span>
              <h2>Mỗi chỗ đỗ,<br className="hero-break" /> trong tầm mắt.</h2>
              <p>{online ? `${online} thiết bị đang kết nối. Dữ liệu bãi xe được đồng bộ theo thời gian thực.` : 'Sẵn sàng tiếp nhận dữ liệu từ ESP32. Kết nối thiết bị để bắt đầu.'}</p>
              <div className="banner-features"><span><Icon name="wifi" size={16} />Giám sát trực tiếp</span><span><Icon name="shield" size={16} />Điều khiển từ xa</span></div>
              <button onClick={() => setPage('parking')}>Khám phá sơ đồ bãi xe<Icon name="arrow" size={19} /></button>
            </div>
            <div className="banner-art" aria-hidden="true"><span className="orbit orbit-one"/><span className="orbit orbit-two"/><span className="art-spark spark-one"/><span className="art-spark spark-two"/><span className="mini-parking p-one">P</span><span className="mini-parking p-two">P</span><span className="banner-car"><Icon name="car" size={80} /></span><span className="art-label"><span className="dot green" /> SMART & CONNECTED</span></div>
          </section>
          <section className="stats-grid" aria-label="Thống kê bãi xe"><Stat title="Tổng sức chứa" value={total} unit="chỗ đỗ" icon="parking" note={`${all.length} hàng xe được quản lý`} /><Stat title="Chỗ còn trống" value={known ? free : '—'} unit="chỗ đỗ" icon="parking" tone="green" note={known ? 'Sẵn sàng tiếp nhận xe' : 'Đang chờ dữ liệu cảm biến'} /><Stat title="Xe đang đỗ" value={known ? occupied : '—'} unit="xe" icon="car" tone="orange" note={`${total - known} ô chưa xác định trạng thái`} /><Stat title="Lượt xe qua cổng" value={irCount} unit="lượt" icon="arrowUp" tone="blue" note="Tổng bộ đếm cảm biến IR" /></section>
        </>}
        {(page === 'overview' || page === 'parking') && <div className="dashboard-grid"><section className="panel parking-panel"><div className="panel-heading"><div><h2>Sơ đồ bãi xe <span className="subtle-tag">{all.length} hàng xe</span></h2><p>Mỗi ESP32 quản lý 1 hàng xe · mỗi hàng tối đa 3 ô đỗ</p></div><span className="panel-icon"><Icon name="parking" /></span></div>{filters}<div className="map-legend"><span><i className="legend-dot available"/>Còn trống</span><span><i className="legend-dot occupied"/>Có xe</span><span><i className="legend-dot unknown"/>Chưa xác định</span><span className="fire-legend"><i className="legend-dot fire"/>Báo cháy</span></div><div className="parking-map">{!initialized ? <Empty icon="wifi" title="Đang nhận danh sách thiết bị" text="Kiểm tra máy chủ Node.js nếu kết nối kéo dài." /> : shown.length ? shown.map(node => <ParkingRow key={node.id} node={node} connected={connected} selected={selected?.id === node.id} onSelect={() => setSelectedId(node.id)} />) : <Empty icon="search" title="Không tìm thấy hàng xe" text="Thử thay đổi khu vực hoặc từ khóa tìm kiếm." />}{shown.length > 0 && <div className="driveway"><span>LỐI DI CHUYỂN</span><div>→ &nbsp; → &nbsp; → &nbsp; → &nbsp; →</div><span><Icon name="arrow" size={16} /> LỐI RA</span></div>}</div><div className="map-footer"><Icon name="clock" size={14} /><span>Cập nhật tự động từ cảm biến ESP32</span><b>{timeText(now)}</b></div></section>
          <div className="right-column"><ControlPanel node={selected} nodes={all} connected={connected} pending={pending} now={now} onSelect={setSelectedId} onControl={control} onEdit={node => setModal({ type: 'setup', node })} />
          <section className="panel occupancy-panel"><div><span className="eyebrow">CÔNG SUẤT BÃI XE</span><h3>{known ? `${occupied} / ${known} chỗ đỗ` : 'Chờ dữ liệu'}</h3><p>{known ? 'Tính trên các ô có dữ liệu hợp lệ' : 'Kết nối ESP32 để xem công suất'}</p></div><div className="ring" style={{ '--progress': `${rate * 3.6}deg` }}><span>{known ? `${rate}%` : '—'}</span></div></section></div></div>}
        {page === 'devices' && <section className="panel"><div className="panel-heading"><div><h2>Danh sách thiết bị</h2><p>Một ESP32, một hàng xe độc lập · cấu hình và điều khiển theo hàng</p></div><span className="badge neutral">{online}/{all.length} trực tuyến</span></div>{filters}<div className="device-grid">{shown.map(node => <DeviceCard key={node.id} node={node} connected={connected} now={now} onEdit={() => setModal({ type: 'setup', node })} onOta={() => setModal({ type: 'ota', node })} onControl={() => { setSelectedId(node.id); setPage('overview'); }} onFire={() => focusFire(node.id)} />)}{!shown.length && <Empty icon="chip" title="Chưa có thiết bị phù hợp" text="Thêm ESP32 hoặc điều chỉnh bộ lọc." />}</div></section>}
        {(page === 'overview' || page === 'activity') && <section className="panel activity-panel"><div className="panel-heading"><div><h2>Nhật ký hoạt động <span className="live-pill">TRỰC TIẾP</span></h2><p>Kết nối, xe ra vào và các lệnh điều khiển gần đây</p></div>{page === 'overview' && <button className="text-button" onClick={() => setPage('activity')}>Xem tất cả<Icon name="arrow" size={15} /></button>}</div><EventsTable events={events} full={page === 'activity'} /></section>}
        <footer className="footer"><span>ParkFlow <i>/</i> Hệ thống quản lý bãi giữ xe phân tán</span><span>KC321 · Nhóm 3 <span className="dot green" /> ESP32 + Socket.IO</span></footer>
      </main>
    </div>
    {modal?.type === 'setup' && <SetupModal node={modal.node} onClose={() => setModal(null)} notify={notify} />}
    {modal?.type === 'ota' && <OtaModal node={modal.node} connected={connected && !!nodes.find(node => node.id === modal.node.id)?.online} progress={ota[modal.node.id]} onClose={() => setModal(null)} notify={notify} />}
    {modal?.type === 'help' && <Modal title="Kết nối ESP32 với ParkFlow" onClose={() => setModal(null)}><div className="help-content"><p>Máy tính chạy server và ESP32 cần dùng chung mạng Wi-Fi.</p><ol><li>Mở firmware trong <code>src/esp_client/clien_1</code> hoặc <code>clien_2</code>.</li><li>Đặt <code>WIFI_SSID</code>, <code>WIFI_PASSWORD</code> và <code>SERVER_HOST</code> là IPv4 của máy tính chạy server.</li><li>Giữ cổng <code>3000</code> và mã <code>ESP-01</code> / <code>ESP-02</code>, sau đó nạp firmware bằng PlatformIO.</li><li>Thiết bị tự xuất hiện khi kết nối. Mở cổng TCP 3000 trên tường lửa mạng nội bộ nếu cần.</li></ol><div className="form-note">Chưa có phần cứng? Chạy <code>npm run sim</code> trong thư mục <code>webserver</code> để kết nối 3 thiết bị mô phỏng.</div><p>Thống kê lượt IR là số xe đi qua cảm biến, không phải số xe đang đỗ. Firmware chỉ gửi trạng thái ô, IR, cháy, relay và lỗi cảm biến; hệ thống chưa có dữ liệu biển số hoặc phí giữ xe.</p></div></Modal>}
    {toast && <div key={toast.key} className={`toast ${toast.error ? 'error' : ''}`} role={toast.error ? 'alert' : 'status'}><Icon name={toast.error ? 'warning' : 'shield'} /><span>{toast.message}</span><button aria-label="Đóng thông báo" onClick={() => setToast(null)}><Icon name="close" size={16} /></button></div>}
  </div></FireTestContext.Provider>;
}

function Stat({ title, value, unit, icon, note, tone = '' }) { return <article className={`stat-card ${tone}`}><div className="stat-top"><span>{title}</span><span className="stat-icon"><Icon name={icon} size={20} /></span></div><div className="stat-number" key={String(value)}>{value}<small>{unit}</small></div><p><span className="tiny-line" />{note}</p></article>; }
function NodeBadge({ node, connected }) { const online = connected && node.online; return <span className={`badge ${online ? 'success' : 'neutral'}`}><span className={`dot ${online ? 'green' : 'gray'}`} />{online ? 'Trực tuyến' : 'Mất kết nối'}</span>; }
function Empty({ icon, title, text }) { return <div className="empty-state"><Icon name={icon} size={32} /><h3>{title}</h3><p>{text}</p></div>; }
function FireTestButton({ node }) {
  const { ids, toggle } = useContext(FireTestContext);
  const active = ids.includes(node.id);
  return <button type="button" data-fire-test-id={node.id} className={`fire-test-button ${active ? 'active' : ''}`} aria-pressed={active} aria-label={`${active ? 'Dừng thử' : 'Thử'} báo cháy ${node.id}`} title="Chỉ thử hiệu ứng giao diện, không điều khiển phần cứng" onClick={() => toggle(node.id)}><Icon name={active ? 'close' : 'flame'} size={17} />{active ? 'Dừng thử báo cháy' : 'Thử báo cháy'}</button>;
}
function DeviceCard({ node, connected, now, onEdit, onOta, onControl, onFire }) {
  const fire = node.hasData && node.fireAlarm;
  const testFire = useContext(FireTestContext).ids.includes(node.id);
  return <article data-zone={node.zone} className={`device-card ${fire || testFire ? 'device-fire' : ''}`}>
    <div className="device-top"><span className="device-symbol"><Icon name={fire ? 'flame' : 'chip'} size={24} /></span><NodeBadge node={node} connected={connected} /></div>
    <h3>{node.name}</h3><p>{node.id} · {ZONES[node.zone]}</p>
    <div className="device-assignment"><Icon name="parking" size={16} />Quản lý 1 hàng · {node.slots} ô đỗ</div>
    {fire && <button className="device-fire-link" onClick={onFire}><Icon name="flame" size={18} />BÁO CHÁY TẠI HÀNG NÀY<Icon name="arrow" size={16} /></button>}
    <dl><div><dt>Địa chỉ IP</dt><dd>{node.ip || 'Chưa kết nối'}</dd></div><div><dt>Dữ liệu gần nhất</dt><dd>{since(node.lastSeen, now)}</dd></div><div><dt>Gói trạng thái</dt><dd>{node.hasData ? `0x${node.bitmask.toString(16).padStart(2, '0').toUpperCase()}` : 'Chưa có dữ liệu'}</dd></div></dl>
    <div className="device-actions"><button className="button secondary" onClick={onEdit}><Icon name="settings" size={16} />Cấu hình hàng</button><button className="button secondary" disabled={!connected || !node.online} onClick={onOta}><Icon name="upload" size={16} />Firmware</button></div>
    <button className="text-button" onClick={onControl}>Điều khiển hàng này<Icon name="arrow" size={15} /></button>
    <FireTestButton node={node} />
  </article>;
}
function ParkingRow({ node, connected, selected, onSelect }) {
  const ready = isReady(node, connected);
  const realFire = node.hasData && node.fireAlarm;
  const testFire = useContext(FireTestContext).ids.includes(node.id);
  const fire = realFire || testFire;
  return <div className="parking-row-with-test"><button id={`parking-row-${node.id}`} data-node-id={node.id} data-zone={node.zone}
    className={`parking-row ${selected ? 'selected' : ''} ${fire ? 'fire-row' : ''}`}
    onClick={onSelect} aria-pressed={selected} aria-label={`Chọn ${node.name}, ${node.id}${realFire ? ', BÁO CHÁY' : testFire ? ', THỬ BÁO CHÁY' : ''}`}>
    <div className="row-heading">
      <div className="row-identity"><span className="row-device-icon"><Icon name={fire ? 'flame' : 'chip'} size={23} /></span><div><h3>{node.name}</h3><span className="row-device-id">{node.id} <span className={`dot ${connected && node.online ? 'green' : 'gray'}`} /></span></div></div>
      {fire ? <span className="row-fire-badge"><Icon name="flame" size={17} />{realFire ? 'BÁO CHÁY' : 'THỬ BÁO CHÁY'}</span> : <span className={`row-selection ${selected ? 'active' : ''}`}><Icon name={selected ? 'shield' : 'chevron'} size={15} />{selected ? 'Đang chọn' : 'Chọn hàng'}</span>}
    </div>
    <div className="row-details"><span className="row-assignment">1 ESP32 · 1 hàng · {node.slots} ô đỗ</span><span className="row-zone">{ZONES[node.zone]}</span><span className="row-availability">{node.fault ? 'Lỗi cảm biến' : ready ? `${node.slots - usedSlots(node)}/${node.slots} chỗ trống` : connected && node.online ? 'Chờ dữ liệu' : 'Ngoại tuyến'}</span></div>
    {fire && <div className="row-fire-message"><Icon name="warning" size={16} /><span>{!realFire ? 'Đang thử hiệu ứng báo cháy trên giao diện.' : connected && node.online ? 'Phát hiện cháy tại hàng này. Kiểm tra ngay!' : 'Cảnh báo cháy gần nhất · đã mất kết nối, cần kiểm tra tại chỗ.'}</span></div>}
    <div className="parking-slots">{Array.from({ length: node.slots }, (_, index) => {
      const occupied = !!(node.bitmask & (1 << index));
      const state = !ready ? 'unknown' : occupied ? 'occupied' : 'available';
      return <div className={`parking-slot ${state}`} key={`${index}:${state}`}><span className="slot-number">{node.id.replace('ESP-', '')}-{String(index + 1).padStart(2, '0')}</span>{!ready ? <span className="unknown-mark">—</span> : occupied ? <span className="car-top"><i/><b/><em/></span> : <span className="empty-parking">P</span>}<span className="slot-state">{!ready ? 'Chưa xác định' : occupied ? 'Có xe' : 'Còn trống'}</span></div>;
    })}</div>
  </button><FireTestButton node={node} /></div>;
}
function ControlPanel({ node, nodes, connected, pending, now, onSelect, onControl, onEdit }) {
  if (!node) return <section className="panel"><Empty icon="chip" title="Chưa có thiết bị" text="Thêm một thiết bị ESP32 để điều khiển." /></section>;
  const enabled = connected && node.online && node.hasData;
  return <section className="panel control-panel"><div className="panel-heading"><div><h2>Điều khiển thiết bị</h2><p>Vận hành từ xa qua ESP32</p></div><Icon name="settings" size={19} /></div><div className="control-body"><label className="field-label" htmlFor="control-node">THIẾT BỊ ĐANG CHỌN</label><select id="control-node" value={node.id} onChange={event => onSelect(event.target.value)}>{nodes.map(item => <option key={item.id} value={item.id}>{item.id} · {item.name}</option>)}</select><div className="connection-line"><NodeBadge node={node} connected={connected} /><span>{node.ip || 'Chưa có IP'}</span></div><div className="control-separator"/><DeviceSwitch icon="bell" title="Còi báo động" description={!enabled ? 'Chưa có dữ liệu trực tiếp' : node.fireAlarm ? 'Tự động bật do báo cháy' : node.buzzer === null ? 'Chưa có phản hồi trạng thái' : node.buzzer ? 'Đang phát cảnh báo' : 'Đang tắt'} checked={enabled && (node.buzzer === true || node.fireAlarm)} disabled={!enabled || !!pending[`${node.id}:buzzer`] || node.fireAlarm} busy={pending[`${node.id}:buzzer`]} onChange={() => onControl(node, 'buzzer', !(node.buzzer || node.fireAlarm))} /><DeviceSwitch icon="drop" title="Relay chữa cháy" description={!enabled ? 'Chưa có dữ liệu trực tiếp' : node.extinguish ? 'Relay đang bật' : 'Relay đang tắt'} checked={enabled && node.extinguish} disabled={!enabled || !!pending[`${node.id}:extinguish`]} busy={pending[`${node.id}:extinguish`]} onChange={() => onControl(node, 'extinguish', !node.extinguish)} /><div className="sensor-grid"><div><span>Cảm biến cháy</span><b className={node.hasData && node.fireAlarm ? 'danger-text' : enabled ? 'success-text' : ''}>{!enabled ? 'Chưa xác định' : node.fireAlarm ? 'Báo cháy' : 'Bình thường'}</b></div><div><span>Lượt xe qua IR</span><b>{node.irCount}<small> lượt</small></b></div></div><div className="control-note"><Icon name="shield" size={16} /><span>{enabled ? 'Lệnh điều khiển chờ ESP32 xác nhận.' : 'Kết nối thiết bị để bắt đầu điều khiển.'}</span></div><div className="control-bottom"><button className="text-button" disabled={!connected || !!pending[`${node.id}:reset_ir`]} onClick={() => onControl(node, 'reset_ir')}><Icon name="reset" size={14} />Đặt lại IR</button><button className="text-button" onClick={() => onEdit(node)}>Cấu hình<Icon name="chevron" size={13} /></button></div><div className="last-update">{since(node.lastSeen, now)}</div></div></section>;
}
function DeviceSwitch({ icon, title, description, checked, disabled, busy, onChange }) { return <div data-control={icon} className={`device-switch-row ${checked ? 'is-on' : ''} ${busy ? 'is-busy' : ''}`}><span className={`switch-icon ${checked ? 'on' : ''}`}><Icon name={icon} size={19} /></span><div><b>{title}</b><small aria-live="polite"><span key={`${!!busy}:${!!checked}`} className="switch-description">{busy ? 'Đang chờ xác nhận…' : description}</span></small></div><button role="switch" aria-label={title} aria-checked={!!checked} aria-busy={!!busy} disabled={disabled} className={`switch ${checked ? 'on' : ''} ${busy ? 'busy' : ''}`} onClick={onChange}><span/></button></div>; }
function EventsTable({ events, full }) {
  const [type, setType] = useState('all');
  const filtered = events.filter(event => type === 'all' || event.type === type).slice(0, full ? 200 : 5);
  return <>{full && <div className="events-filter"><label>Loại hoạt động <select value={type} onChange={event => setType(event.target.value)}><option value="all">Tất cả hoạt động</option>{Object.entries(EVENT_TYPES).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label><span>Lưu tối đa 200 sự kiện gần nhất</span></div>}{filtered.length ? <div className="table-scroll"><table><thead><tr><th>THỜI GIAN</th><th>HOẠT ĐỘNG</th><th>THIẾT BỊ</th><th>NỘI DUNG</th></tr></thead><tbody>{filtered.map(event => <tr key={event.id}><td className="time-cell">{timeText(event.time)}<small>{new Date(event.time).toLocaleDateString('vi-VN')}</small></td><td><span className={`event-type ${event.type}`}>{EVENT_TYPES[event.type] || event.type}</span></td><td><span className="node-code">{event.nodeId || 'Hệ thống'}</span></td><td>{event.message}</td></tr>)}</tbody></table></div> : <Empty icon="history" title="Chưa có hoạt động" text="Các sự kiện từ ESP32 và lệnh điều khiển sẽ xuất hiện tại đây." />}</>;
}
function Modal({ title, onClose, children, locked = false }) {
  const ref = useRef(null);
  useEffect(() => { const dialog = ref.current; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} className="modal" onCancel={event => { event.preventDefault(); if (!locked) onClose(); }} onClick={event => { if (event.target === ref.current && !locked) { const box = ref.current.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose(); } }}><div className="modal-heading"><h2>{title}</h2><button className="icon-button" disabled={locked} onClick={onClose} aria-label="Đóng cửa sổ"><Icon name="close" /></button></div>{children}</dialog>;
}
function SetupModal({ node, onClose, notify }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    setBusy(true); setError('');
    try { await api(`/api/nodes/${encodeURIComponent(form.get('id'))}/setup`, { mode: node ? 'update' : 'create', name: form.get('name'), zone: form.get('zone'), slots: Number(form.get('slots')) }); notify('Đã lưu cấu hình hàng xe.'); onClose(); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <Modal title={node ? `Cấu hình hàng · ${node.id}` : 'Thêm thiết bị ESP32'} onClose={onClose} locked={busy}><form className="modal-form" onSubmit={submit}><div className="assignment-note"><Icon name="chip" size={21} /><span><b>1 ESP32 = 1 hàng xe</b><small>Mỗi hàng có từ 1 đến 3 ô đỗ.</small></span><Icon name="parking" size={23} /></div><label>Mã ESP32 quản lý hàng<input name="id" defaultValue={node?.id} placeholder="Ví dụ: ESP-03" pattern="[a-zA-Z0-9_-]{1,32}" maxLength={32} readOnly={!!node} required /></label><label>Tên hàng xe<input name="name" defaultValue={node?.name} placeholder="Ví dụ: Hàng C" maxLength={80} required /></label><div className="form-columns"><label>Khu vực chứa hàng<select name="zone" defaultValue={node?.zone || 'Zone_A'}>{Object.entries(ZONES).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label><label>Số ô trong hàng<input name="slots" type="number" min="1" max="3" defaultValue={node?.slots || 3} required /></label></div><div className="form-note">Mã thiết bị phải trùng <code>NODE_ID</code> trong firmware. Khu vực dùng để nhóm các hàng; một ESP32 chỉ quản lý hàng được gắn với mã thiết bị của nó.</div>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Hủy</button><button className="button primary" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu cấu hình hàng'}</button></div></form></Modal>;
}
function OtaModal({ node, connected, progress, onClose, notify }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [started, setStarted] = useState(false);
  async function submit(event) {
    event.preventDefault(); if (!file) return;
    if (!/\.bin$/i.test(file.name) || file.size === 0 || file.size > 4 * 1024 * 1024) { setError('Chọn file .bin không rỗng, tối đa 4 MB.'); return; }
    setBusy(true); setError(''); setStarted(true);
    const body = new FormData(); body.append('firmware', file);
    try { await api(`/api/nodes/${encodeURIComponent(node.id)}/ota`, body, 120000); notify(`${node.id}: cập nhật firmware thành công.`); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <Modal title={`Cập nhật firmware · ${node.id}`} onClose={onClose} locked={busy}><form className="modal-form" onSubmit={submit}><p>Nạp firmware không dây cho <b>{node.name}</b>. Thiết bị sẽ khởi động lại khi ESP32 xác nhận cập nhật thành công.</p><label className="file-drop"><Icon name="upload" size={30} /><b>Chọn firmware .bin</b><span>Tối đa 4 MB · Firmware đúng loại ESP32</span><input type="file" accept=".bin" disabled={busy} onChange={event => { setFile(event.target.files[0]); setError(''); setStarted(false); }} required /></label>{started && <div className="ota-progress"><progress value={progress?.percent || 0} max="100" /><span>{progress?.status || 'Đang tải lên máy chủ…'} {progress?.percent || 0}%</span></div>}{!connected && <p className="form-error">Thiết bị đang mất kết nối.</p>}{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Đóng</button><button className="button primary" disabled={busy || !file || !connected}>{busy ? 'Đang cập nhật…' : 'Nạp firmware'}</button></div></form></Modal>;
}

if (typeof document !== 'undefined') createRoot(document.getElementById('root')).render(<App />);
