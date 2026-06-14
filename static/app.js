'use strict';

// ── Status map ───────────────────────────────────────────────────────────────
const STATUS_MAP = {
  'OL CHRG':    { label: '市電正常・充電中',   cls: 'ok' },
  'OL':         { label: '市電正常供電',        cls: 'ok' },
  'OB DISCHRG': { label: '電池供電中',          cls: 'warn' },
  'OB':         { label: '電池供電中',          cls: 'warn' },
  'LB':         { label: '電池電量嚴重不足',    cls: 'crit' },
};

const CHARGER_LABEL = { floating: '維持電量', charging: '充電中', resting: '待機', discharging: '放電中' };

const $ = id => document.getElementById(id);

// ── Dashboard ────────────────────────────────────────────────────────────────
function parseStatus(raw) {
  if (!raw) return { label: '未知', cls: '' };
  for (const [k, v] of Object.entries(STATUS_MAP)) {
    if (raw === k) return v;
  }
  if (raw.includes('OB')) return { label: '電池供電中',   cls: 'warn' };
  if (raw.includes('LB')) return { label: '電池電量不足', cls: 'crit' };
  if (raw.includes('OL')) return { label: '市電正常',     cls: 'ok' };
  return { label: raw, cls: '' };
}

function updateDashboard(d) {
  const { label, cls } = parseStatus(d['ups.status'] || '');
  $('statusBanner').className = `status-banner ${cls}`;
  $('statusCode').textContent = d['ups.status'] || '--';
  $('statusDesc').textContent = label;
  $('deviceModel').textContent = d['device.model'] || d['ups.model'] || '--';
  $('deviceSerial').textContent = d['device.serial'] ? `S/N ${d['device.serial']}` : '';

  const charge = parseFloat(d['battery.charge'] ?? 0);
  const circ = 314.16;
  const ring = $('batteryRing');
  ring.style.strokeDashoffset = circ * (1 - charge / 100);
  // SVG 元素的 className 是唯讀的 SVGAnimatedString，strict mode 下直接賦值會丟出
  // TypeError 並中斷後續所有欄位更新，必須用 setAttribute。
  ring.setAttribute('class', 'ring-fill' + (charge <= 15 ? ' crit' : charge <= 30 ? ' warn' : ''));
  $('batteryCharge').textContent = `${charge}%`;
  const cs = d['battery.charger.status'] || '';
  $('batteryChargerStatus').textContent = CHARGER_LABEL[cs] || cs;

  const rSec = parseInt(d['battery.runtime'] ?? 0);
  const rMin = Math.floor(rSec / 60);
  $('runtime').textContent = rMin;
  $('runtimeHour').textContent = rSec >= 3600 ? `約 ${(rSec / 3600).toFixed(1)} 小時` : '';

  const load = parseFloat(d['ups.load'] ?? 0);
  $('load').textContent = `${load}%`;
  const lb = $('loadBar');
  lb.style.width = `${Math.min(load, 100)}%`;
  lb.className = 'bar-fill' + (load >= 90 ? ' crit' : load >= 70 ? ' warn' : '');
  $('loadWatt').textContent    = d['ups.power'] || d['ups.realpower'] || '--';
  $('loadNominal').textContent = d['ups.realpower.nominal'] || d['ups.power.nominal'] || '--';

  $('inputVoltage').textContent  = d['input.voltage']  || '--';
  $('inputFreq').textContent     = d['input.frequency'] || '--';
  $('outputVoltage').textContent = d['output.voltage']  || '--';
  $('outputCurrent').textContent = d['output.current']  || '--';
  $('batteryVoltage').textContent        = d['battery.voltage']         || '--';
  $('batteryVoltageNominal').textContent = d['battery.voltage.nominal'] || '--';
  $('efficiency').textContent = d['ups.efficiency'] || '--';
  $('realpower').textContent  = d['ups.realpower']  || '--';

  const tr = d['ups.test.result'] || '--';
  const te = $('testResult');
  te.textContent = tr;
  te.className = 'test-result' + (tr.toLowerCase().includes('fail') ? ' fail' : '');
  const ti = parseInt(d['ups.test.interval'] ?? 0);
  $('testInterval').textContent = ti ? Math.round(ti / 86400) : '--';

  $('lastUpdated').textContent = new Date().toLocaleTimeString('zh-TW');

  checkBatteryAlert(d['ups.status'] || '');
}

// ── Battery alert (transient popup) ───────────────────────────────────────────
// 彈出提醒只在「市電 → 電池」切換瞬間出現一次，固定時間後自動消失；
// 是否仍在電池供電 / 是否 OL CHRG 充電中等持續狀態，一律交給狀態列 (statusBanner) 顯示。
const ALERT_AUTO_HIDE_MS = 8000;
let prevStatus = null;
let alertTimer = null;

function isOnBattery(s) { return s.includes('OB') || s.includes('DISCHRG'); }

function checkBatteryAlert(status) {
  const now  = isOnBattery(status);
  const prev = prevStatus !== null && isOnBattery(prevStatus);

  if (now) {
    // 切到電池供電的瞬間彈出一次提醒（prevStatus === null 為首次載入，不算切換）
    if (!prev && prevStatus !== null) {
      showBatteryBanner();
      fireBrowserNotif('⚡ 市電中斷', 'UPS 已切換至電池供電，請注意電力狀況');
    }
  } else {
    // 目前並非電池供電（OL / OL CHRG…）—— 強制隱藏提醒，杜絕橫幅與狀態矛盾殘留
    hideBatteryBanner();
    if (prev) {
      fireBrowserNotif('✅ 市電恢復', 'UPS 已恢復市電供電');
    }
  }

  prevStatus = status;
}

function showBatteryBanner() {
  $('batteryAlert').hidden = false;
  clearTimeout(alertTimer);
  alertTimer = setTimeout(hideBatteryBanner, ALERT_AUTO_HIDE_MS);
}

function hideBatteryBanner() {
  clearTimeout(alertTimer);
  $('batteryAlert').hidden = true;
}

$('alertClose').addEventListener('click', hideBatteryBanner);

// ── Browser notifications ─────────────────────────────────────────────────────
// 瀏覽器推播只在「安全環境」(HTTPS 或 localhost) 才能使用；以 http://<IP> 連線會被
// 瀏覽器基於安全性封鎖。此時系統其餘功能與 LINE 通知不受影響，僅停用瀏覽器推播。
const hasNotifAPI = 'Notification' in window;

// → 'unsupported' | 'insecure' | 'granted' | 'denied' | 'default'
function notifState() {
  if (!hasNotifAPI) return 'unsupported';
  if (!window.isSecureContext) return 'insecure';
  return Notification.permission;
}

function updateNotifBtn() {
  const s = notifState();
  const btn = $('notifBtn');
  if (s === 'unsupported') { btn.style.display = 'none'; return; }
  btn.style.display = '';
  // insecure 借用 denied 的灰階樣式
  btn.className = `icon-btn notif-btn ${s === 'insecure' ? 'denied' : s}`;
  btn.title = {
    granted:  '瀏覽器通知已啟用 · 點擊查看通知設定',
    denied:   '通知已被瀏覽器封鎖 · 點擊查看通知設定',
    default:  '點擊查看 / 啟用瀏覽器通知',
    insecure: '瀏覽器通知需 HTTPS 或 localhost · 點擊查看說明',
  }[s] || '';
}

async function requestNotifPermission() {
  const s = notifState();
  if (s === 'unsupported' || s === 'insecure') {
    showToast('此連線環境無法啟用瀏覽器通知（需 HTTPS 或 localhost）'); return;
  }
  if (s === 'granted') { showToast('瀏覽器通知已啟用'); return; }
  if (s === 'denied')  { showToast('通知已被封鎖，請在瀏覽器設定中手動允許'); return; }
  try { await Notification.requestPermission(); } catch {}
  updateNotifBtn();
  renderBrowserNotifStatus();   // 設定面板開著時同步更新狀態卡
  if (notifState() === 'granted') showToast('瀏覽器通知已啟用');
}

function fireBrowserNotif(title, body) {
  if (notifState() !== 'granted') return;
  try { new Notification(title, { body, tag: 'ups-alert' }); } catch {}
}

// 通知分頁頂部的瀏覽器推播狀態卡（把權限提醒收進「通知」設定內）
function browserNotifStatusHTML() {
  const map = {
    granted:     { cls: 'ok',   icon: '✅', text: '瀏覽器推播已啟用，UPS 事件會跳出系統通知。', btn: '' },
    default:     { cls: 'warn', icon: '🔔', text: '尚未啟用瀏覽器推播。授權後即使切到其他分頁，UPS 事件仍會跳出系統通知。', btn: '啟用瀏覽器通知' },
    denied:      { cls: 'warn', icon: '🔕', text: '瀏覽器推播已被封鎖。請點網址列左側的圖示，把「通知」改為允許後重新整理頁面。', btn: '' },
    insecure:    { cls: 'warn', icon: '🔒', text: '目前以非安全連線 (例如 <code>http://IP</code>) 開啟，瀏覽器基於安全性停用了推播。需改用 <code>HTTPS</code>，或透過 <code>http://localhost</code> 連線才能啟用。', btn: '' },
    unsupported: { cls: 'warn', icon: '🚫', text: '此瀏覽器不支援推播通知。', btn: '' },
  };
  const m = map[notifState()] || map.unsupported;
  return `
    <div class="notif-status ${m.cls}">
      <div class="notif-status-main"><span>${m.icon}</span><div>${m.text}</div></div>
      ${m.btn ? `<button class="btn-mini" id="enableNotifBtn">${m.btn}</button>` : ''}
      <div class="notif-status-foot">無論瀏覽器推播是否啟用，<strong>LINE 通知</strong>都會照常運作，不受影響。</div>
    </div>`;
}

function wireBrowserNotifBtn() {
  const b = document.getElementById('enableNotifBtn');
  if (b) b.addEventListener('click', requestNotifPermission);
}

function renderBrowserNotifStatus() {
  const wrap = $('browserNotifWrap');
  if (!wrap) return;
  wrap.innerHTML = browserNotifStatusHTML();
  wireBrowserNotifBtn();
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
let ws, reconnectTimer;

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.onopen = () => {
    $('wsBadge').className = 'ws-badge connected';
    $('wsLabel').textContent = '已連線';
    clearTimeout(reconnectTimer);
  };

  ws.onmessage = e => {
    try { updateDashboard(JSON.parse(e.data)); } catch {}
  };

  ws.onclose = ws.onerror = () => {
    $('wsBadge').className = 'ws-badge disconnected';
    $('wsLabel').textContent = '連線中斷';
    reconnectTimer = setTimeout(connectWS, 3000);
  };
}

// ── Chart.js ──────────────────────────────────────────────────────────────────
const hasCharts = typeof Chart !== 'undefined';
let powerChart, batteryChart, loadChart;
let activeRange = '24h';
let historyTimer;

const CHART_COMMON = {
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 300 },
  plugins: {
    legend: { display: false },
    tooltip: {
      mode: 'index', intersect: false,
      backgroundColor: 'rgba(18,18,28,0.97)',
      borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1,
      titleColor: '#636580', bodyColor: '#dde1f0',
      // 標題格式化 callback 在 makeChart() 內掛上（此物件會經 JSON 深拷貝，函式無法保留）
    },
  },
  scales: {
    x: {
      grid: { color: 'rgba(255,255,255,0.04)' },
      ticks: {
        color: '#636580', maxTicksLimit: 8,
        // 刻度格式化 callback 同樣在 makeChart() 內掛上
      },
    },
    y: {
      grid: { color: 'rgba(255,255,255,0.04)' },
      ticks: { color: '#636580' },
      beginAtZero: true,
    },
  },
};

// 座標軸刻度：依範圍精簡顯示（避免每格塞滿完整日期而擠在一起）
function fmtTs(ts, range) {
  const d = new Date(ts * 1000);
  const p = x => String(x).padStart(2, '0');
  if (range === '30d') return `${d.getMonth()+1}/${d.getDate()}`;
  if (range === '7d')  return `${d.getMonth()+1}/${d.getDate()} ${p(d.getHours())}:00`;
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Tooltip 標題：完整標示「年/月/日 時:分」
function fmtTsFull(ts, range) {
  const d = new Date(ts * 1000);
  const p = x => String(x).padStart(2, '0');
  const ymd = `${d.getFullYear()}/${p(d.getMonth()+1)}/${p(d.getDate())}`;
  if (range === '30d') return ymd;                                  // 30 天為每日彙整，僅到日
  return `${ymd} ${p(d.getHours())}:${p(d.getMinutes())}`;          // 其餘到時:分
}

function makeChart(canvasId, color, yMax) {
  const ctx = $(canvasId).getContext('2d');
  const opts = JSON.parse(JSON.stringify(CHART_COMMON));
  if (yMax) { opts.scales.y.max = yMax; }
  // JSON.stringify 會丟掉所有函式，需把刻度 / tooltip 的格式化 callback 補回，
  // 否則 X 軸會退回預設、直接印出原始 timestamp 數字。
  opts.scales.x.ticks.callback = function (v) { return fmtTs(this.getLabelForValue(v), activeRange); };
  opts.plugins.tooltip.callbacks = {
    title: items => items.length ? fmtTsFull(items[0].label, activeRange) : '',
  };
  return new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        data: [],
        borderColor: color,
        backgroundColor: color.replace(')', ', 0.07)').replace('rgb', 'rgba'),
        fill: true, tension: 0.35, pointRadius: 0, borderWidth: 1.5,
      }],
    },
    options: opts,
  });
}

function initCharts() {
  if (!hasCharts) {
    document.querySelectorAll('.chart-canvas-wrap').forEach(el => {
      el.innerHTML = '<div class="charts-unavail">圖表需要 Chart.js，請確認網路後重新建置容器</div>';
    });
    return;
  }
  // Use rgb() so the replace trick for rgba background works
  powerChart   = makeChart('powerChart',   'rgb(0,214,143)',  null);
  batteryChart = makeChart('batteryChart', 'rgb(59,130,246)', 100);
  loadChart    = makeChart('loadChart',    'rgb(255,179,0)',   100);
}

function applyHistory(data) {
  if (!hasCharts) return;
  const set = (chart, values) => {
    chart.data.labels = data.labels;
    chart.data.datasets[0].data = values;
    chart.update('none');
  };
  set(powerChart,   data.power);
  set(batteryChart, data.battery);
  set(loadChart,    data.load);
}

async function loadHistory(range) {
  activeRange = range;
  try {
    const res = await fetch(`/api/history?range=${range}`);
    applyHistory(await res.json());
  } catch {}
}

async function loadStats() {
  try {
    const s = await (await fetch('/api/stats')).json();
    $('kwhToday').textContent  = `${s.today.kwh} kWh`;
    $('kwhWeek').textContent   = `${s.week.kwh} kWh`;
    $('kwhMonth').textContent  = `${s.month.kwh} kWh`;
    if (s.month.cost !== null) {
      $('costCard').style.display = '';
      $('costMonth').textContent = `NT$ ${s.month.cost}`;
    }
  } catch {}
}

function setRange(range) {
  activeRange = range;
  document.querySelectorAll('.range-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.range === range)
  );
  loadHistory(range);
  clearInterval(historyTimer);
  historyTimer = setInterval(() => loadHistory(range), range === '1h' ? 60_000 : 300_000);
}

// ── Settings modal ──────────────────────────────────────────────────────────────
const NOTIF_TYPES = [
  { key: 'on_battery',       label: '市電中斷',      desc: '切換至電池供電時通知',   hasThreshold: false },
  { key: 'battery_low',      label: '電池電量低',    desc: '電量低於閾值時通知',      hasThreshold: true, tLabel: '警告閾值 (%)' },
  { key: 'battery_critical', label: '電池嚴重不足',  desc: '電量嚴重不足時緊急通知',  hasThreshold: true, tLabel: '緊急閾值 (%)' },
  { key: 'power_restored',   label: '市電恢復',      desc: '市電恢復正常供電時通知',  hasThreshold: false },
  { key: 'overload',         label: '過載警告',      desc: '負載超過閾值時通知',      hasThreshold: true, tLabel: '過載閾值 (%)' },
];
// 動作的觸發事件與通知共用同一組門檻（門檻在「通知」分頁設定）
const TRIGGER_LABELS = {
  on_battery: '市電中斷', battery_low: '電池電量低', battery_critical: '電池嚴重不足',
  power_restored: '市電恢復', overload: '過載警告',
};
const VARS_HINT = '可用變數：{battery_charge} 電量%　{battery_runtime} 剩餘分鐘　{ups_load} 負載%';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// modal 內可編輯的狀態：主機為 write-once（即時 API 管理），動作隨設定一起儲存
const settingsState = { hosts: [], actions: [] };

async function openModal(initialTab = 'monitor') {
  // 先開窗並切到指定分頁 —— 即使後續資料載入或任何分頁渲染失敗，
  // 彈出視窗仍保證能打開（符合「沒有 HTTPS/localhost 也要能開」的需求）。
  $('modal').classList.add('open');
  $('overlay').classList.add('open');
  try { switchTab(initialTab); } catch (e) { console.warn('switchTab:', e); }

  let settings = {};
  try { settings = await (await fetch('/api/settings')).json(); }
  catch { showToast('無法載入設定，先顯示預設值'); }
  try { settingsState.hosts = await (await fetch('/api/hosts')).json(); }
  catch { settingsState.hosts = []; }
  settingsState.actions = Array.isArray(settings.actions) ? settings.actions.map(a => ({ ...a })) : [];

  // 各分頁獨立 try/catch，單一分頁渲染失敗不影響其他分頁與開窗
  try { renderMonitorPane(settings); } catch (e) { console.warn('monitor pane:', e); }
  try { renderNotifPane(settings); }   catch (e) { console.warn('notif pane:', e); }
  try { renderHostsPane(); }           catch (e) { console.warn('hosts pane:', e); }
  try { renderActionsPane(); }         catch (e) { console.warn('actions pane:', e); }
}

function closeModal() {
  $('modal').classList.remove('open');
  $('overlay').classList.remove('open');
}

function switchTab(tab) {
  document.querySelectorAll('.modal-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.modal-pane').forEach(p => p.classList.toggle('active', p.id === `pane-${tab}`));
}

// ── Pane: 監控 ────────────────────────────────────────────────────────────────
function renderMonitorPane(s) {
  $('pane-monitor').innerHTML = `
    <div class="form-section">
      <h3>監控設定</h3>
      <div class="form-row">
        <div class="form-group">
          <label>輪詢間隔 (秒)</label>
          <input type="number" id="cfg__interval" value="${esc(s.check_interval ?? 30)}" min="5" max="300">
          <span class="hint">建議 10～60 秒</span>
        </div>
        <div class="form-group">
          <label>電費單價 (元/kWh)</label>
          <input type="number" id="cfg__rate" value="${esc(s.electricity_rate ?? 0)}" step="0.1" min="0">
          <span class="hint">台灣平均約 3～4 元，0 表示不顯示費用</span>
        </div>
      </div>
    </div>`;
}

// ── Pane: 通知 ────────────────────────────────────────────────────────────────
function renderNotifPane(s) {
  const n = s.notifications || {};
  const rows = NOTIF_TYPES.map(t => {
    const c = n[t.key] || {};
    return `
      <div class="notif-card">
        <div class="notif-header">
          <label class="toggle">
            <input type="checkbox" id="${t.key}__en" ${c.enabled ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
          <div><div class="notif-title">${t.label}</div><div class="notif-desc">${t.desc}</div></div>
        </div>
        <div class="notif-body">
          <div class="form-group">
            <label>通知訊息</label>
            <textarea id="${t.key}__msg" rows="2">${esc(c.message ?? '')}</textarea>
            <span class="hint">${VARS_HINT}</span>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>冷卻時間 (秒)</label>
              <input type="number" id="${t.key}__cd" value="${esc(c.cooldown ?? 300)}" min="10">
            </div>
            ${t.hasThreshold ? `<div class="form-group"><label>${t.tLabel}</label><input type="number" id="${t.key}__th" value="${esc(c.threshold ?? 30)}" min="1" max="100"></div>` : ''}
          </div>
        </div>
      </div>`;
  }).join('');
  $('pane-notif').innerHTML = `
    <div class="form-section">
      <h3>瀏覽器推播</h3>
      <div id="browserNotifWrap">${browserNotifStatusHTML()}</div>
    </div>
    <p class="pane-intro">以下條件符合時透過 LINE 推播通知。門檻同時作為「觸發動作」的觸發條件。</p>
    <div class="form-section"><h3>LINE 通知條件</h3>${rows}</div>`;
  wireBrowserNotifBtn();
}

// ── Pane: 遠端主機（write-once）────────────────────────────────────────────────
function renderHostsPane() {
  const cards = settingsState.hosts.length
    ? settingsState.hosts.map(h => `
        <div class="entity-card" data-host="${esc(h.id)}">
          <div class="entity-main">
            <div class="entity-name">${esc(h.name)} <span class="locked-badge">🔒 唯讀</span></div>
            <div class="entity-meta">${esc(h.username)}@${esc(h.host)}:${esc(h.port)}</div>
            <div class="entity-fp">${esc(h.fingerprint || '')}</div>
            <div class="cmd-result" id="hosttest-${esc(h.id)}"></div>
          </div>
          <div class="entity-actions">
            <button class="btn-mini" data-host-test="${esc(h.id)}">測試</button>
            <button class="btn-danger" data-host-del="${esc(h.id)}">刪除</button>
          </div>
        </div>`).join('')
    : `<div class="empty-hint">尚未新增任何主機</div>`;

  $('pane-hosts').innerHTML = `
    <p class="pane-intro">儲存遠端 NUT / 伺服器的 SSH 連線憑證。基於安全考量，主機<strong>建立後無法修改，只能刪除後重建</strong>；私鑰寫入後不會再回傳顯示。</p>
    <div class="entity-list">${cards}</div>
    <button class="btn-add" id="hostAddBtn">＋ 新增主機</button>
    <div class="sub-form" id="hostForm" hidden>
      <div class="form-row">
        <div class="form-group"><label>名稱</label><input type="text" id="host__name" placeholder="例如 NUT 主機"></div>
        <div class="form-group"><label>SSH 帳號</label><input type="text" id="host__user" placeholder="root"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>位置（IP / 主機名）</label><input type="text" id="host__addr" placeholder="192.168.1.10"></div>
        <div class="form-group"><label>連接埠</label><input type="number" id="host__port" value="22" min="1" max="65535"></div>
      </div>
      <div class="form-group">
        <label>SSH 私鑰</label>
        <textarea id="host__key" class="mono" rows="6" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;..."></textarea>
        <span class="hint">貼上 PEM / OpenSSH 私鑰；儲存後即無法檢視或修改。</span>
      </div>
      <div class="entity-actions">
        <button class="btn-mini" id="hostCancelBtn">取消</button>
        <button class="btn-primary" id="hostSaveBtn" style="flex:0 0 auto;padding:9px 18px">儲存主機</button>
      </div>
    </div>`;

  $('hostAddBtn').addEventListener('click', () => {
    $('hostForm').hidden = false;
    $('hostAddBtn').hidden = true;
  });
  $('hostCancelBtn').addEventListener('click', () => { $('hostForm').hidden = true; $('hostAddBtn').hidden = false; });
  $('hostSaveBtn').addEventListener('click', createHost);
  $('pane-hosts').querySelectorAll('[data-host-del]').forEach(b =>
    b.addEventListener('click', () => deleteHost(b.dataset.hostDel)));
  $('pane-hosts').querySelectorAll('[data-host-test]').forEach(b =>
    b.addEventListener('click', () => testHost(b.dataset.hostTest)));
}

async function createHost() {
  const body = {
    name:        $('host__name').value.trim(),
    username:    $('host__user').value.trim(),
    host:        $('host__addr').value.trim(),
    port:        parseInt($('host__port').value) || 22,
    private_key: $('host__key').value,
  };
  if (!body.name || !body.username || !body.host || !body.private_key.trim()) {
    showToast('請完整填寫名稱、帳號、位置與私鑰'); return;
  }
  const btn = $('hostSaveBtn'); btn.disabled = true; btn.textContent = '儲存中...';
  try {
    const res = await fetch('/api/hosts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await res.json();
    if (!res.ok || !d.ok) { showToast(d.error || '建立失敗'); return; }
    syncActionsFromDOM();          // 保留動作分頁未儲存的編輯
    settingsState.hosts.push(d.host);
    renderHostsPane();
    renderActionsPane();           // 動作的主機下拉需同步
    showToast('主機已新增');
  } catch { showToast('建立失敗，請重試'); }
  finally { btn.disabled = false; btn.textContent = '儲存主機'; }
}

async function deleteHost(id) {
  if (!confirm('確定刪除這台主機？相關觸發動作將失效。')) return;
  try {
    await fetch(`/api/hosts/${id}`, { method: 'DELETE' });
    syncActionsFromDOM();          // 保留動作分頁未儲存的編輯
    settingsState.hosts = settingsState.hosts.filter(h => h.id !== id);
    renderHostsPane();
    renderActionsPane();
    showToast('主機已刪除');
  } catch { showToast('刪除失敗'); }
}

async function testHost(id) {
  const out = $(`hosttest-${id}`);
  if (out) out.textContent = '測試連線中...';
  try {
    const d = await (await fetch(`/api/hosts/${id}/test`, { method: 'POST' })).json();
    if (out) out.textContent = d.ok ? '✓ 連線成功' : `✗ ${d.error || d.stderr || '連線失敗'}`;
  } catch { if (out) out.textContent = '✗ 測試失敗'; }
}

// ── Pane: 觸發動作 ────────────────────────────────────────────────────────────
function syncActionsFromDOM() {
  settingsState.actions = [...$('pane-actions').querySelectorAll('[data-action]')].map(card => {
    const id = card.dataset.action;
    const g = sel => card.querySelector(sel);
    return {
      id,
      name:     g('[data-f="name"]').value.trim(),
      enabled:  g('[data-f="enabled"]').checked,
      trigger:  g('[data-f="trigger"]').value,
      host_id:  g('[data-f="host"]').value,
      command:  g('[data-f="command"]').value,
      cooldown: parseInt(g('[data-f="cooldown"]').value) || 300,
    };
  });
}

function renderActionsPane() {
  const hostOpts = (sel) => settingsState.hosts.length
    ? settingsState.hosts.map(h => `<option value="${esc(h.id)}" ${h.id === sel ? 'selected' : ''}>${esc(h.name)} (${esc(h.username)}@${esc(h.host)})</option>`).join('')
    : '';
  const trigOpts = (sel) => Object.entries(TRIGGER_LABELS)
    .map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v}</option>`).join('');

  const cards = settingsState.actions.map(a => `
    <div class="entity-card" data-action="${esc(a.id)}" style="flex-direction:column;align-items:stretch">
      <div style="display:flex;align-items:center;gap:12px">
        <label class="toggle"><input type="checkbox" data-f="enabled" ${a.enabled ? 'checked' : ''}><span class="slider"></span></label>
        <input type="text" data-f="name" value="${esc(a.name || '')}" placeholder="動作名稱" style="flex:1;background:rgba(255,255,255,0.05);border:1px solid var(--border);border-radius:10px;color:var(--text);font-size:13px;padding:8px 10px;outline:none">
        <button class="btn-mini" data-action-run="${esc(a.id)}">測試執行</button>
        <button class="btn-danger" data-action-del="${esc(a.id)}">刪除</button>
      </div>
      <div class="form-row">
        <div class="form-group"><label>觸發條件</label><select data-f="trigger">${trigOpts(a.trigger)}</select></div>
        <div class="form-group"><label>目標主機</label><select data-f="host">${hostOpts(a.host_id)}</select></div>
      </div>
      <div class="form-group">
        <label>執行指令</label>
        <textarea data-f="command" class="mono" rows="2" placeholder="sudo shutdown -h +1">${esc(a.command || '')}</textarea>
      </div>
      <div class="form-group" style="max-width:180px"><label>冷卻時間 (秒)</label><input type="number" data-f="cooldown" value="${esc(a.cooldown ?? 300)}" min="10"></div>
      <div class="cmd-result" id="acttest-${esc(a.id)}"></div>
    </div>`).join('');

  const noHostWarn = settingsState.hosts.length ? '' :
    `<div class="empty-hint">尚無遠端主機，請先到「遠端主機」分頁新增。</div>`;
  const body = settingsState.actions.length ? cards :
    `<div class="empty-hint">尚未設定任何觸發動作</div>`;

  $('pane-actions').innerHTML = `
    <p class="pane-intro">當觸發條件成立時，於指定主機透過 SSH 執行指令（例如電量過低時關機）。觸發門檻沿用「通知」分頁的設定。<strong>請先儲存設定才會生效。</strong></p>
    ${noHostWarn}
    <div class="entity-list">${body}</div>
    <button class="btn-add" id="actionAddBtn" ${settingsState.hosts.length ? '' : 'disabled style="opacity:.5;cursor:not-allowed"'}>＋ 新增動作</button>`;

  $('actionAddBtn').addEventListener('click', () => {
    syncActionsFromDOM();
    settingsState.actions.push({
      id: 'a' + Date.now().toString(36), name: '', enabled: true,
      trigger: 'battery_critical', host_id: settingsState.hosts[0]?.id || '',
      command: '', cooldown: 300,
    });
    renderActionsPane();
  });
  $('pane-actions').querySelectorAll('[data-action-del]').forEach(b =>
    b.addEventListener('click', () => { syncActionsFromDOM(); settingsState.actions = settingsState.actions.filter(a => a.id !== b.dataset.actionDel); renderActionsPane(); }));
  $('pane-actions').querySelectorAll('[data-action-run]').forEach(b =>
    b.addEventListener('click', () => runActionTest(b.dataset.actionRun)));
}

async function runActionTest(id) {
  const out = $(`acttest-${id}`);
  if (out) out.textContent = '需先儲存設定後才能測試；執行中...';
  try {
    const res = await fetch(`/api/actions/${id}/run`, { method: 'POST' });
    const d = await res.json();
    if (!out) return;
    if (d.ok) out.textContent = `✓ exit=0\n${d.stdout || ''}`.trim();
    else out.textContent = `✗ ${d.error || ''} exit=${d.exit_status}\n${d.stderr || ''}`.trim();
  } catch { if (out) out.textContent = '✗ 執行失敗（請確認已儲存設定）'; }
}

// ── Collect & save ─────────────────────────────────────────────────────────────
function collectSettings() {
  const s = {
    check_interval:   parseInt($('cfg__interval').value) || 30,
    electricity_rate: parseFloat($('cfg__rate').value)   || 0,
    notifications: {},
    actions: [],
  };
  for (const t of NOTIF_TYPES) {
    const c = {
      enabled:  $(`${t.key}__en`).checked,
      message:  $(`${t.key}__msg`).value,
      cooldown: parseInt($(`${t.key}__cd`).value) || 300,
    };
    if (t.hasThreshold) c.threshold = parseInt($(`${t.key}__th`).value) || 30;
    s.notifications[t.key] = c;
  }
  syncActionsFromDOM();
  s.actions = settingsState.actions.filter(a => a.host_id && a.command.trim());
  return s;
}

async function saveSettings() {
  try {
    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(collectSettings()),
    });
    showToast('設定已儲存');
    closeModal();
    loadStats(); // refresh cost display
  } catch { showToast('儲存失敗，請重試'); }
}

async function sendTestNotification() {
  const btn = $('testBtn');
  btn.textContent = '發送中...'; btn.disabled = true;
  try {
    const d = await (await fetch('/api/notify/test', { method: 'POST' })).json();
    if (!d.token_set)    showToast('LINE_ACCESS_TOKEN 尚未設定（請設定環境變數）');
    else if (!d.user_id_set) showToast('ADMIN_USER_ID 尚未設定（請設定環境變數）');
    else if (d.ok)       showToast('測試通知已發送');
    else                 showToast('發送失敗，請確認 Token 與 User ID 是否正確');
  } catch { showToast('發送失敗'); }
  finally { btn.textContent = '發送測試通知'; btn.disabled = false; }
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg) {
  const el = $('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

// ── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // 先綁定所有互動事件 —— 確保即使後續的選用初始化（通知 / 圖表 / WebSocket）在
  // 非安全環境 (http://IP) 下出錯，設定彈窗等 UI 仍能正常開啟與操作。
  // 齒輪 → 開設定（監控分頁）；鈴鐺 → 直接開到「通知」分頁（含瀏覽器推播狀態與說明）。
  // 用箭頭函式包起來，避免把 click 事件物件當成分頁名稱傳進去。
  $('settingsBtn').addEventListener('click', () => openModal('monitor'));
  $('notifBtn').addEventListener('click', () => openModal('notif'));
  $('closeBtn').addEventListener('click', closeModal);
  $('overlay').addEventListener('click', closeModal);
  $('saveBtn').addEventListener('click', saveSettings);
  $('testBtn').addEventListener('click', sendTestNotification);
  $('modalNav').addEventListener('click', e => {
    const btn = e.target.closest('.modal-tab');
    if (btn) switchTab(btn.dataset.tab);
  });
  $('rangeTabs').addEventListener('click', e => {
    const btn = e.target.closest('.range-tab');
    if (btn) setRange(btn.dataset.range);
  });

  // 以下皆為選用功能，各自獨立 try/catch，任一失敗都不影響 UI 與其他功能。
  try { updateNotifBtn(); } catch (e) { console.warn('notif init failed:', e); }
  try { initCharts(); }     catch (e) { console.warn('Chart.js init failed:', e); }
  try { connectWS(); }      catch (e) { console.warn('WebSocket init failed:', e); }
  try { setRange('24h'); }  catch (e) { console.warn('history init failed:', e); }

  fetch('/api/status').then(r => r.json()).then(updateDashboard).catch(() => {});
  loadStats();
  setInterval(loadStats, 300_000);
});
