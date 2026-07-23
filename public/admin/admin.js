const API = location.origin;
const TOKEN_KEY = 'bar_admin_token';

let currentPage = 'board';
let allOrders = [];
let statsData = null;
let historyOrders = [];
let memberResults = [];
let selectedMemberId = null;
let statsFrom = todayStr();
let statsTo = todayStr();
let historyFrom = todayStr();
let historyTo = todayStr();
let sse = null;
let pollTimer = null;
let timerTick = null;
let lastPaidIds = new Set();
let adminInfo = null;

let floorData = null;
let floorSlot = null;
let productFilter = 'all';
let allProducts = [];
let historyPage = 1;
const HISTORY_PAGE_SIZE = 12;
const SOUND_KEY = 'bar_admin_sound';
let soundEnabled = localStorage.getItem(SOUND_KEY) !== 'off';

const PAGE_TITLES = {
  board: '作战看板',
  floor: '桌位实况',
  history: '订单历史',
  members: '会员查询',
  redeem: '核销中心',
  wine: '存酒管理',
  products: '商品管理',
  inventory: '原料库存',
  stats: '经营数据',
  stored: '存分管理',
  tools: '营运工具',
  audit: '审计日志',
};

let redeemHistoryFilter = 'completed';
let wineTab = 'pending';
let wineItems = [];
let wineSearchKw = '';
let auditFrom = todayStr();
let auditTo = todayStr();

let storedMemberId = null;
let memberTab = 'overview';
let memberDetailCache = null;
let floorHighlightTable = null;

let adminRole = 'staff';

function chinaNowParts(instant = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  return Object.fromEntries(fmt.formatToParts(instant).map((p) => [p.type, p.value]));
}

function todayStr() {
  const p = chinaNowParts();
  return `${p.year}-${p.month}-${p.day}`;
}

function parseDbTimeUtc(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (/[zZ]$/.test(s)) return new Date(s);
  const d = new Date(`${s.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatChinaDateTime(value) {
  const d = parseDbTimeUtc(value);
  if (!d) return String(value || '');
  const p = chinaNowParts(d);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

function formatChinaTime(value) {
  const d = parseDbTimeUtc(value);
  if (!d) return '';
  const p = chinaNowParts(d);
  return `${p.hour}:${p.minute}`;
}

function shiftDate(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function monthStartStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function statsQueryUrl(from, to) {
  return `/api/admin/stats?from=${from}&to=${to}`;
}

function setStatsPreset(preset) {
  const today = todayStr();
  if (preset === 'today') {
    statsFrom = today;
    statsTo = today;
  } else if (preset === '7d') {
    statsFrom = shiftDate(today, -6);
    statsTo = today;
  } else if (preset === '30d') {
    statsFrom = shiftDate(today, -29);
    statsTo = today;
  } else if (preset === 'month') {
    statsFrom = monthStartStr();
    statsTo = today;
  }
  $('stats-from').value = statsFrom;
  $('stats-to').value = statsTo;
  document.querySelectorAll('.preset-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.preset === preset);
  });
}

function $(id) { return document.getElementById(id); }

function token() { return localStorage.getItem(TOKEN_KEY); }

function forceRelogin(message) {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem('bar_admin_name');
  localStorage.removeItem('bar_admin_role');
  showLogin();
  showToast(message || '登录已过期，请重新登录');
}

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token()) headers.Authorization = `Bearer ${token()}`;
  const res = await fetch(`${API}${path}`, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    forceRelogin('登录已过期（seed 后需重新登录）');
    throw new Error('登录已过期');
  }
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

function formatTimer(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function payLabel(method) {
  return {
    wxpay: '微信支付',
    wxpay_dev: '微信(开发)',
    balance: '储值余额',
    groupon: '团购',
    cash_manual: '现金补录',
  }[method] || method || '-';
}

function showToast(msg, duration = 2800) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.add('hidden'), duration);
}

function flashNewOrder(text) {
  const el = $('new-order-flash');
  $('flash-text').textContent = text;
  el.classList.remove('hidden');
  playDing();
  clearTimeout(flashNewOrder._t);
  flashNewOrder._t = setTimeout(() => el.classList.add('hidden'), 4000);
}

function playDing() {
  if (!soundEnabled) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  } catch (_) { /* ignore */ }
}

function setConnStatus(mode) {
  const sub = $('server-time');
  const labels = {
    live: '<span class="conn-live">● 实时连接</span>',
    poll: '<span class="conn-poll">● 轮询模式</span>',
    off: '<span class="conn-off">● 连接断开</span>',
  };
  const p = chinaNowParts();
  const time = `${p.hour}:${p.minute}:${p.second}`;
  sub.innerHTML = `${labels[mode] || ''} · 北京时间 ${time}`;

  const kdsBadge = $('kds-live-badge');
  if (kdsBadge) {
    kdsBadge.classList.toggle('offline', mode === 'off');
    const label = mode === 'live' ? 'KDS 厨房屏' : mode === 'poll' ? 'KDS 轮询' : 'KDS 离线';
    kdsBadge.innerHTML = `<i class="kds-pulse"></i> ${label}`;
  }
}

function renderTimeline(o) {
  const steps = o.timeline || [];
  if (!steps.length) {
    return `<div class="card-times muted">${esc(o.createdAtLabel || o.createdAt || '')}</div>`;
  }
  return `
    <div class="order-timeline">
      ${steps.map((s) => `
        <div class="tl-step ${s.done ? 'done' : ''} ${(o.currentStep || o.status) === s.key ? 'current' : ''}">
          <span class="tl-label">${esc(s.label)}</span>
          <span class="tl-time">${s.done ? esc(s.time) : '—'}</span>
        </div>
      `).join('')}
    </div>
    <div class="card-times">${esc(o.timeSummary || o.createdAtShort || '')}</div>
  `;
}

function renderOrderCard(o, { compact = false } = {}) {
  const urgency = o.urgency || 'normal';
  const timerCls = ['paid', 'making'].includes(o.status) ? urgency : '';
  const elapsed = o._localElapsed ?? o.elapsedSeconds ?? 0;
  const waitHint = o.waitLabel ? `已等 ${o.waitLabel}` : '';

  const itemsHtml = o.items.map((i) => `
    <div class="item-line">
      <span class="item-name">${esc(i.name)}</span>
      <span class="item-qty">×${i.qty}</span>
    </div>
  `).join('');

  let actions = '';
  if (o.status === 'pending') {
    actions = `<button class="btn-cancel" data-id="${o.id}" data-action="cancelled">取消</button>`;
  } else if (o.status === 'paid') {
    actions = `<button class="btn-make" data-id="${o.id}" data-action="making">开始制作</button>`;
  } else if (o.status === 'making') {
    actions = `<button class="btn-done" data-id="${o.id}" data-action="done">已完成</button>`;
  }

  const timerHtml = ['paid', 'making'].includes(o.status)
    ? `<div class="timer ${timerCls}" title="${esc(waitHint)}">${formatTimer(elapsed)}</div>`
    : o.status === 'pending'
      ? '<div class="timer fresh">待支付</div>'
      : '';

  if (compact) {
    return `
      <div class="order-card kds-ticket compact status-${o.status} ${o.status} urgency-${urgency}" data-id="${o.id}">
        <div class="card-top">
          <div class="card-top-main">
            <div class="pickup-no">#${esc(o.pickupNo || '----')}</div>
            <div class="card-meta compact-meta">
              <span class="meta-tag table">${esc(o.tableName)}</span>
              <span class="meta-tag">${esc(o.nickname)}</span>
            </div>
          </div>
          ${timerHtml}
        </div>
        <div class="card-items">${itemsHtml}</div>
        ${o.note ? `<div class="card-note">备注：${esc(o.note)}</div>` : ''}
        <div class="card-foot compact-foot">
          <div class="card-price">¥${o.totalYuan}</div>
          <div class="card-pay">${payLabel(o.paymentMethod)}</div>
        </div>
        ${o.status === 'pending' ? '<div class="warn-banner">未支付 · 禁止出酒</div>' : ''}
        ${actions ? `<div class="card-actions">${actions}</div>` : ''}
      </div>
    `;
  }

  return `
    <div class="order-card ${o.status} urgency-${urgency}" data-id="${o.id}">
      <div class="card-top">
        <div>
          <div class="pickup-no">#${esc(o.pickupNo || '----')}</div>
          <div class="order-placed-at">下单 ${esc(o.orderTimeLabel || o.createdAtShort || '—')}</div>
        </div>
        ${timerHtml}
      </div>
      ${renderTimeline(o)}
      <div class="card-meta">
        <span class="meta-tag table">${esc(o.tableName)}</span>
        <span class="meta-tag">${esc(o.nickname)}</span>
      </div>
      <div class="card-items">${itemsHtml}</div>
      ${o.note ? `<div class="card-note">备注：${esc(o.note)}</div>` : ''}
      <div class="card-foot">
        <div>
          <div class="card-price">¥${o.totalYuan}</div>
          <div class="card-pay">${payLabel(o.paymentMethod)}</div>
        </div>
      </div>
      ${o.status === 'pending' ? '<div class="warn-banner">未支付 · 禁止出酒</div>' : ''}
      ${actions ? `<div class="card-actions">${actions}</div>` : ''}
    </div>
  `;
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s ?? '';
  return d.innerHTML;
}

function bindCardActions(container) {
  container.querySelectorAll('[data-action]').forEach((btn) => {
    btn.onclick = () => handleAction(btn.dataset.id, btn.dataset.action);
  });
}

async function handleAction(id, status) {
  if (status === 'cancelled' && !confirm('确认取消该未支付订单？')) return;
  try {
    const res = await api(`/api/admin/orders/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    showToast(res.message);
    await loadBoardData();
    if (currentPage === 'history') await loadHistory();
    closeOrderDetail();
  } catch (e) {
    showToast(e.message);
  }
}

function renderBoard() {
  const pending = allOrders.filter((o) => o.status === 'pending');
  const paid = allOrders.filter((o) => o.status === 'paid');
  const making = allOrders.filter((o) => o.status === 'making');

  $('count-pending').textContent = pending.length;
  $('count-paid').textContent = paid.length;
  $('count-making').textContent = making.length;

  renderColumn('col-pending', pending, '暂无待支付订单', '客人付款后才会进入制作队列');
  renderColumn('col-paid', paid, '队列已清空', '新单支付后会出现在这里');
  renderColumn('col-making', making, '暂无制作中', '点击「开始制作」后订单移入此列');

  const queue = paid.length + making.length;
  const badge = $('nav-badge-queue');
  if (queue > 0) {
    badge.textContent = queue;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }

  const kdsQueue = $('kds-total-queue');
  if (kdsQueue) kdsQueue.textContent = queue;
}

function renderColumn(id, orders, emptyText, emptyHint = '') {
  const el = $(id);
  if (!orders.length) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon"></div>
        <p class="empty-state-title">${emptyText}</p>
        ${emptyHint ? `<p class="empty-state-hint">${emptyHint}</p>` : ''}
      </div>`;
    return;
  }
  el.innerHTML = orders.map((o) => renderOrderCard(o, { compact: true })).join('');
  bindCardActions(el);
}

function tickTimers() {
  const now = Date.now();
  allOrders.forEach((o) => {
    if (!['paid', 'making'].includes(o.status)) return;
    const from = o.status === 'making' ? (o.makingAt || o.paidAt) : o.paidAt;
    if (!from) return;
    const parsed = parseDbTimeUtc(from);
    const t = parsed ? parsed.getTime() : null;
    if (!t) return;
    o._localElapsed = Math.max(0, Math.floor((now - t) / 1000));
    if (o._localElapsed >= 480) o.urgency = 'critical';
    else if (o._localElapsed >= 300) o.urgency = 'warning';
    else if (o._localElapsed >= 120) o.urgency = 'attention';
    else o.urgency = 'fresh';
  });

  if (currentPage === 'board') {
    ['col-pending', 'col-paid', 'col-making'].forEach((id) => {
      const col = $(id);
      col.querySelectorAll('.order-card').forEach((card) => {
        const order = allOrders.find((o) => o.id === card.dataset.id);
        if (!order || !['paid', 'making'].includes(order.status)) return;
        const timer = card.querySelector('.timer');
        if (timer) {
          timer.textContent = formatTimer(order._localElapsed);
          timer.className = `timer ${order.urgency}`;
        }
        card.className = `order-card kds-ticket compact status-${order.status} ${order.status} urgency-${order.urgency}`;
      });
    });
  }
}

function updateHeaderKpi() {
  if (!statsData) return;
  $('hdr-revenue').textContent = `¥${statsData.revenueYuan}`;
  $('hdr-queue').textContent = statsData.kitchenQueue;
}

async function loadStats(from, to) {
  try {
    const f = from || (currentPage === 'stats' ? statsFrom : todayStr());
    const t = to || (currentPage === 'stats' ? statsTo : todayStr());
    statsData = await api(statsQueryUrl(f, t));
    if (f === todayStr() && t === todayStr()) updateHeaderKpi();
    if (currentPage === 'stats') renderStatsPage();
  } catch (e) {
    if (e.message !== '登录已过期') console.warn('stats load failed', e);
  }
}

async function loadBoardOrders() {
  try {
    const data = await api('/api/admin/orders/live?status=active');
    const newPaid = data.orders.filter((o) => o.status === 'paid');
    const newIds = new Set(newPaid.map((o) => o.id));

    newPaid.forEach((o) => {
      if (!lastPaidIds.has(o.id) && lastPaidIds.size > 0) {
        flashNewOrder(`新订单 #${o.pickupNo}`);
      }
    });
    lastPaidIds = newIds;

    allOrders = data.orders;
    if (currentPage === 'board') renderBoard();
    updateBoardKPI(data.orders);
    setConnStatus(sse ? 'live' : 'poll');
    return true;
  } catch (e) {
    if (e.message !== '登录已过期') setConnStatus('off');
    return false;
  }
}

async function loadKitchenSummary() {
  try {
    const data = await api('/api/admin/kitchen/summary');
    $('drink-total').textContent = `${data.totalDrinks} 杯`;
    const el = $('drink-summary');
    if (!data.items.length) {
      el.innerHTML = '<div class="card-stack-empty" style="padding:20px">暂无待出酒</div>';
      return;
    }
    const cats = data.byCategory || {};
    const catNames = Object.keys(cats);
    if (catNames.length > 1) {
      el.innerHTML = catNames.map((cat) => `
        <div class="drink-cat">
          <div class="drink-cat-title">${esc(cat)}</div>
          ${cats[cat].map((i) => `
            <div class="drink-row">
              <span>${esc(i.name)}</span>
              <strong>×${i.qty}</strong>
            </div>
          `).join('')}
        </div>
      `).join('');
    } else {
      el.innerHTML = data.items.map((i) => `
        <div class="drink-row">
          <span>${esc(i.name)}</span>
          <strong>×${i.qty}</strong>
        </div>
      `).join('');
    }
  } catch (_) {
    $('drink-summary').innerHTML = '<div class="res-item">加载失败</div>';
  }
}

async function loadBoardData() {
  const ok = await loadBoardOrders();
  await Promise.allSettled([
    loadStats(todayStr()),
    loadKitchenSummary(),
    loadInventoryAlerts(),
  ]);
  if (ok && !sse) setConnStatus('poll');
}

function updateBoardKPI(orders) {
  const today = todayStr();
  const todayOrders = orders.filter((o) => o.created_at && o.created_at.startsWith(today));
  const revenue = todayOrders.reduce((sum, o) => sum + (o.total_cents || 0), 0);
  const pending = orders.filter((o) => o.status === 'pending').length;
  const making = orders.filter((o) => o.status === 'making').length;

  const revEl = $('kpi-revenue');
  const ordEl = $('kpi-orders');
  const penEl = $('kpi-pending');
  const makEl = $('kpi-making');

  if (revEl) revEl.textContent = '¥' + (revenue / 100).toFixed(0);
  if (ordEl) ordEl.textContent = todayOrders.length;
  if (penEl) penEl.textContent = pending;
  if (makEl) makEl.textContent = making;
}

async function loadInventoryAlerts() {
  try {
    const data = await api('/api/admin/inventory');
    const bar = $('stock-alert-bar');
    if (data.alerts?.length) {
      bar.textContent = `原料预警：${data.alerts.join('、')} 库存不足 · 点击查看`;
      bar.classList.remove('hidden');
    } else {
      bar.classList.add('hidden');
    }
  } catch (_) {
    $('stock-alert-bar').classList.add('hidden');
  }
}

async function loadTournamentToday() {
  try {
    const data = await api('/api/admin/tournament/today');
    $('tournament-count').textContent = `${data.joined || 0}/${data.capacity || 18}`;
    const el = $('tournament-list');
    if (!data.registrations?.length) {
      el.innerHTML = `<div class="res-item">${data.mode === 'weekend' ? '周末赛' : '周中局'} · 暂无报名</div>`;
      return;
    }
    el.innerHTML = data.registrations.map((r) => `
      <div class="res-item tournament-item">
        <div>
          <strong>${esc(r.nickname)}</strong>
          <span class="tournament-status ${r.status === 'checked_in' ? 'in' : 'wait'}">${r.status === 'checked_in' ? '已签到' : '待签到'}</span>
        </div>
        ${r.status !== 'checked_in' ? `<button class="btn-ghost-sm" data-checkin="${r.id}">签到</button>` : ''}
      </div>
    `).join('');
    el.querySelectorAll('[data-checkin]').forEach((btn) => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        try {
          const res = await api(`/api/admin/tournament/${btn.dataset.checkin}/checkin`, { method: 'PATCH' });
          showToast(res.message);
          loadTournamentToday();
        } catch (err) { showToast(err.message); }
      };
    });
  } catch (_) {
    $('tournament-list').innerHTML = '<div class="res-item">加载失败</div>';
  }
}

function renderFloorSeatGrid(seats) {
  return seats.map((s) => `
    <div class="floor-chip seat-${s.number} ${s.status === 'reserved' ? 'occupied' : ''}" title="${s.nickname ? esc(s.nickname) : '空位'}">
      <span class="floor-chip-num">${s.number}</span>
      <span class="floor-chip-label">${s.status === 'reserved' ? esc(s.nickname || '已约') : '空'}</span>
    </div>
  `).join('');
}

function renderFloorTableCard(table) {
  const barHtml = table.barOrders.length
    ? table.barOrders.map((o) => `
      <div class="floor-bar-order" data-order-id="${o.id}">
        <div class="floor-bar-head">
          <strong>#${esc(o.pickupNo)}</strong>
          <span class="status-pill status-${o.status}">${esc(o.statusLabel)}</span>
        </div>
        <div class="floor-bar-meta">
          ${esc(o.nickname)} · ¥${o.totalYuan}
          ${o.note ? ` · ${esc(o.note)}` : ''}
        </div>
        <small class="muted">${esc(o.createdAt)}</small>
      </div>
    `).join('')
    : '<div class="floor-empty">当前时段无在店酒水单</div>';

  const tableBookHtml = table.tableBookings.length
    ? table.tableBookings.map((b) => `
      <div class="floor-table-book">
        <strong>整桌预约</strong> · ${b.peopleCount}人 · ${esc(b.nickname)}
        ${b.note ? `<br><small>${esc(b.note)}</small>` : ''}
      </div>
    `).join('')
    : '';

  const scheduleHtml = table.todaySchedule.length
    ? table.todaySchedule.map((r) => `
      <div class="floor-schedule-item">
        <span class="floor-schedule-time">${esc(r.time)}</span>
        <span>${esc(r.seat)} · ${esc(r.nickname)}</span>
      </div>
    `).join('')
    : '<div class="floor-empty">今日暂无其他时段预约</div>';

  return `
    <article class="floor-table-card">
      <header class="floor-table-head">
        <div>
          <h3>${esc(table.name)}</h3>
          <p class="muted">当前时段 <strong class="gold">${table.occupiedSeats}/${table.seatsMax}</strong> 座已预约
            · 在店单 <strong>${table.barOrders.length}</strong> 笔</p>
          <div class="floor-table-progress">
            <div class="floor-table-progress-fill" style="width:${table.seatsMax ? Math.round(table.occupiedSeats / table.seatsMax * 100) : 0}%"></div>
          </div>
        </div>
      </header>
      <div class="floor-table-body v2">
        <div class="floor-arena-wrap">
          <div class="floor-arena">
            <div class="floor-felt">
              <span class="floor-felt-label">德州桌</span>
              <span class="floor-felt-sub">${table.occupiedSeats}/${table.seatsMax} 座</span>
            </div>
            <div class="floor-seat-ring">${renderFloorSeatGrid(table.seats)}</div>
          </div>
        </div>
        <div class="floor-panels v2">
          ${tableBookHtml ? `<section class="floor-panel"><h4>整桌预约</h4>${tableBookHtml}</section>` : ''}
          <section class="floor-panel">
            <h4 class="floor-panel-title">${Ico.icon('drink', 'ico ico-panel')}吧台酒水（今日在店）</h4>
            <div class="floor-bar-list">${barHtml}</div>
          </section>
          <section class="floor-panel">
            <h4 class="floor-panel-title">${Ico.icon('calendar', 'ico ico-panel')}今日预约一览</h4>
            <div class="floor-schedule">${scheduleHtml}</div>
          </section>
        </div>
      </div>
    </article>
  `;
}

function floorTileStatus(table) {
  if (table.barOrders?.length) return 'active';
  if (table.occupiedSeats >= table.seatsMax) return 'full';
  if (table.occupiedSeats > 0) return 'partial';
  return 'empty';
}

function renderFloorOverview() {
  const el = $('floor-overview');
  if (!el || !floorData?.tables?.length) {
    if (el) el.innerHTML = '';
    return;
  }

  el.innerHTML = floorData.tables.map((table, idx) => {
    const status = floorTileStatus(table);
    const tableKey = table.id || table.name || String(idx);
    const isActive = floorHighlightTable === tableKey;
    return `
      <article class="bitego-table-tile status-${status} ${isActive ? 'active-tile' : ''}" data-table-key="${esc(tableKey)}">
        <div class="bitego-tile-head">
          <h4>${esc(table.name)}</h4>
          <span class="bitego-status-chip">${table.occupiedSeats}/${table.seatsMax} 座</span>
        </div>
        <div class="bitego-tile-meta">
          <span>${table.barOrders.length} 酒水单</span>
          <span>${Math.max(0, table.seatsMax - table.occupiedSeats)} 空位</span>
        </div>
        <div class="bitego-seat-dots">
          ${table.seats.map((s) => `<i class="bitego-dot ${s.status === 'reserved' ? 'reserved' : ''}" title="${esc(s.nickname || '空')}"></i>`).join('')}
        </div>
      </article>
    `;
  }).join('');

  el.querySelectorAll('.bitego-table-tile').forEach((tile) => {
    tile.onclick = () => {
      floorHighlightTable = tile.dataset.tableKey;
      renderFloorOverview();
      const target = document.querySelector(`[data-floor-key="${tile.dataset.tableKey}"]`);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  });
}

function renderFloorKpi(summary) {
  const el = $('floor-kpi');
  if (!summary) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = `
    <div class="floor-kpi-card">
      <span class="floor-kpi-label">座位占用</span>
      <strong class="floor-kpi-val gold">${summary.totalOccupied}/${summary.totalSeats}</strong>
      <div class="floor-kpi-bar"><div class="floor-kpi-fill" style="width:${summary.occupancyPct}%"></div></div>
    </div>
    <div class="floor-kpi-card">
      <span class="floor-kpi-label">在店酒水</span>
      <strong class="floor-kpi-val">${summary.totalBarOrders} 单</strong>
      <small class="muted">待支付 / 制作中</small>
    </div>
    <div class="floor-kpi-card">
      <span class="floor-kpi-label">今日预约</span>
      <strong class="floor-kpi-val">${summary.totalSchedule} 条</strong>
      <small class="muted">全时段合计</small>
    </div>
    <div class="floor-kpi-card">
      <span class="floor-kpi-label">空位可约</span>
      <strong class="floor-kpi-val success">${summary.totalEmpty} 座</strong>
      <small class="muted">当前时段</small>
    </div>
  `;
}

function renderFloorPage() {
  if (!floorData) return;
  $('floor-meta').textContent = `${floorData.date} · 更新 ${floorData.updatedAt}（北京时间）`;
  $('floor-current-slot').textContent = floorData.slotLabel;
  renderFloorKpi(floorData.summary);

  const sel = $('floor-slot-select');
  sel.innerHTML = floorData.slots.map((s) => `
    <option value="${s.start}" ${floorData.slot === s.start ? 'selected' : ''}>${esc(s.label)}</option>
  `).join('');
  sel.onchange = () => {
    floorSlot = sel.value;
    loadFloorPage();
  };

  renderFloorOverview();

  $('floor-tables').innerHTML = floorData.tables.map((table, idx) => {
    const tableKey = table.id || table.name || String(idx);
    const highlight = floorHighlightTable === tableKey ? ' highlight' : '';
    return `<div class="floor-table-wrap${highlight}" data-floor-key="${esc(tableKey)}">${renderFloorTableCard(table)}</div>`;
  }).join('');

  $('floor-tables').querySelectorAll('[data-order-id]').forEach((el) => {
    el.onclick = () => openOrderDetail(el.dataset.orderId);
    el.style.cursor = 'pointer';
  });
}

async function loadFloorPage() {
  try {
    const q = floorSlot ? `?slot=${encodeURIComponent(floorSlot)}` : '';
    floorData = await api(`/api/admin/floor/status${q}`);
    if (!floorSlot) floorSlot = floorData.slot;
    renderFloorPage();
  } catch (e) {
    $('floor-meta').textContent = '加载失败';
    $('floor-tables').innerHTML = `<div class="floor-empty">${esc(e.message)}</div>`;
  }
}

async function loadFloorSummary() {
  try {
    const data = await api('/api/admin/floor/status');
    const el = $('floor-side-summary');
    const badge = $('floor-side-badge');
    if (!data.tables?.length) {
      el.innerHTML = '<div class="res-item">暂无桌位数据</div>';
      badge.textContent = '—';
      return;
    }
    const totalReserved = data.tables.reduce((n, t) => n + t.occupiedSeats, 0);
    const totalBar = data.tables.reduce((n, t) => n + t.barOrders.length, 0);
    badge.textContent = `${totalReserved}座 · ${totalBar}单`;
    el.innerHTML = data.tables.map((t) => `
      <div class="res-item">
        <strong>${esc(t.name)}</strong>
        <br>预约 <span class="gold">${t.occupiedSeats}/${t.seatsMax}</span>
        · 酒水 <span class="gold">${t.barOrders.length}</span> 单
        <br><small class="muted">${esc(data.slotLabel)}</small>
      </div>
    `).join('');
  } catch (_) {
    $('floor-side-summary').innerHTML = '<div class="res-item">加载失败</div>';
    $('floor-side-badge').textContent = '—';
  }
}

async function loadRecentDone() {
  try {
    const data = await api('/api/admin/orders/live?status=done');
    const el = $('recent-done');
    const orders = data.orders.slice(0, 5);
    if (!orders.length) {
      el.innerHTML = '<div class="done-item">暂无已完成</div>';
      return;
    }
    el.innerHTML = orders.map((o) => `
      <div class="done-item">
        <strong>#${esc(o.pickupNo)}</strong> · ¥${o.totalYuan}
        <small class="muted">${esc(o.doneAtLabel || o.orderTimeLabel || '')}</small>
      </div>
    `).join('');
  } catch (_) { /* ignore */ }
}

async function loadHistory() {
  historyPage = 1;
  const data = await api(`/api/admin/orders/history?from=${historyFrom}&to=${historyTo}&limit=500`);
  historyOrders = data.orders;
  renderHistory();
}

function renderMemberHero(u, storedWineCount, storedWine = []) {
  const hero = $('member-hero');
  const placeholder = $('member-hero-placeholder');
  if (hero) {
    hero.classList.remove('hidden');
    hero.innerHTML = `
      <div class="fuint-vip-head">
        <div class="fuint-vip-avatar">${esc((u.nickname || '酒')[0])}</div>
        <div>
          <div class="fuint-vip-name">${esc(u.nickname)}</div>
          <span class="fuint-vip-tier">${esc(u.levelName || '会员')}</span>
          <div class="fuint-vip-meta">${esc(u.phone || '未绑定手机')} · ${esc(u.memberCode || u.inviteCode || '—')}</div>
        </div>
      </div>
      <div class="fuint-vip-stats">
        <div class="fuint-stat-tile gold">
          <small>积分</small>
          <strong>${u.points ?? 0}</strong>
        </div>
        <div class="fuint-stat-tile accent fuint-stat-click" data-goto-stored="${esc(u.id)}" title="管理存分">
          <small>存分</small>
          <strong>${u.storedScore ?? 0}</strong>
        </div>
        <div class="fuint-stat-tile">
          <small>存酒</small>
          <strong>${storedWineCount ?? 0}</strong>
        </div>
        <div class="fuint-stat-tile">
          <small>储值</small>
          <strong>¥${u.balanceYuan ?? '0.00'}</strong>
        </div>
      </div>
      ${storedWine?.length ? `
        <div class="stored-wine-list" style="margin-top:14px">
          ${storedWine.slice(0, 3).map((w) => `
            <div class="stored-wine-item">
              <span class="wine-line">${Ico.icon('drink', 'ico ico-inline')} ${esc(w.product_name)}</span>
              <span class="muted">${esc(w.pickup_code)}</span>
            </div>
          `).join('')}
        </div>` : ''}
    `;
    hero.querySelector('[data-goto-stored]')?.addEventListener('click', () => {
      gotoStoredWithMember(u.id);
    });
  }
  if (placeholder) placeholder.classList.add('hidden');
}

function switchMemberTab(tab) {
  memberTab = tab;
  document.querySelectorAll('.fuint-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  if (memberDetailCache) renderMemberTabContent(memberDetailCache);
}

function renderMemberTabContent(data) {
  const el = $('member-detail');
  if (!el) return;
  const u = data.user;

  if (memberTab === 'overview') {
    el.innerHTML = `
      <div class="fuint-overview-grid">
        <div class="fuint-overview-tile"><small>会员积分</small><strong style="color:var(--gold)">${u.points ?? 0}</strong></div>
        <div class="fuint-overview-tile"><small>存分余额</small><strong>${u.storedScore ?? 0}</strong></div>
        <div class="fuint-overview-tile"><small>储值余额</small><strong>¥${u.balanceYuan ?? '0.00'}</strong></div>
        <div class="fuint-overview-tile"><small>待取存酒</small><strong>${data.storedWineCount ?? 0} 杯</strong></div>
      </div>
      <div class="member-section">
        <h5>最近积分变动</h5>
        <div class="fuint-log-list">
          ${data.pointLogs?.length
    ? data.pointLogs.slice(0, 5).map((l) => `
              <div class="fuint-log-item">
                <span>${esc(l.reason)}</span>
                <span class="${l.change_amount >= 0 ? 'pos' : 'neg'}">${l.change_amount >= 0 ? '+' : ''}${l.change_amount}</span>
              </div>
            `).join('')
    : '<div class="res-item">暂无积分记录</div>'}
        </div>
      </div>
    `;
    return;
  }

  if (memberTab === 'points') {
    el.innerHTML = `
      <div class="fuint-log-list">
        ${data.pointLogs?.length
    ? data.pointLogs.map((l) => `
            <div class="fuint-log-item">
              <span>${esc(l.reason)} <small class="muted">${esc(l.created_at || '')}</small></span>
              <span class="${l.change_amount >= 0 ? 'pos' : 'neg'}">${l.change_amount >= 0 ? '+' : ''}${l.change_amount}</span>
            </div>
          `).join('')
    : '<div class="res-item">暂无积分记录</div>'}
      </div>
    `;
    return;
  }

  if (memberTab === 'wine') {
    el.innerHTML = `
      <div class="fuint-log-list">
        ${data.storedWine?.length
    ? data.storedWine.map((w) => `
            <div class="fuint-log-item">
              <span class="wine-line">${Ico.icon('drink', 'ico ico-inline')} ${esc(w.product_name)}</span>
              <span>取酒码 <strong class="gold">${esc(w.pickup_code)}</strong></span>
            </div>
          `).join('')
    : '<div class="res-item">暂无存酒，客人积分兑换后会显示在这里</div>'}
        ${data.redemptions?.length
    ? data.redemptions.map((r) => `
            <div class="fuint-log-item">
              <span>${esc(r.product_name)} · ${r.status === 'pending' ? '待取酒' : '已核销'}</span>
              <span>${r.points_cost}积分</span>
            </div>
          `).join('')
    : ''}
      </div>
    `;
    return;
  }

  if (memberTab === 'orders') {
    el.innerHTML = `
      <div class="fuint-log-list">
        ${data.orders?.length
    ? data.orders.map((o) => `
            <div class="fuint-log-item">
              <span>#${esc(o.pickupNo)} · ¥${o.totalYuan} · ${esc(o.tableName || '')}</span>
              <span class="pos">+${o.pointsEarned}积分</span>
            </div>
          `).join('')
    : '<div class="res-item">暂无订单</div>'}
      </div>
    `;
  }
}

function renderMemberPickList(members) {
  const el = $('member-pick-list');
  if (!members?.length) {
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }
  el.classList.remove('hidden');
  el.innerHTML = `
    <p class="muted small">尾号匹配多位客人，请选择：</p>
    ${members.map((m) => `
      <button type="button" class="member-pick-btn" data-id="${m.id}">
        <strong>${esc(m.nickname)}</strong>
        <span>${esc(m.phone)} · ${m.points}积分 · 存酒${m.storedWineCount}杯</span>
      </button>
    `).join('')}
  `;
  el.querySelectorAll('.member-pick-btn').forEach((btn) => {
    btn.onclick = async () => {
      el.classList.add('hidden');
      await loadMemberDetail(btn.dataset.id);
      const data = await api(`/api/admin/members/${btn.dataset.id}`);
      renderMemberHero(data.user, data.storedWineCount, data.storedWine);
    };
  });
}

async function lookupMemberByPhone() {
  const phone = ($('member-phone').value || '').replace(/\D/g, '');
  if (phone.length < 4) {
    showToast('请输入手机号');
    return;
  }
  $('member-tail').value = '';
  await runMemberLookup(`phone=${encodeURIComponent(phone)}`);
}

async function lookupMemberByTail() {
  const tail = ($('member-tail').value || '').replace(/\D/g, '');
  if (tail.length !== 4) {
    showToast('请输入4位手机尾号');
    return;
  }
  $('member-phone').value = '';
  await runMemberLookup(`tail=${encodeURIComponent(tail)}`);
}

async function runMemberLookup(query) {
  try {
    const data = await api(`/api/admin/members/lookup?${query}`);
    if (data.multiple) {
      $('member-hero')?.classList.add('hidden');
      $('member-hero-placeholder')?.classList.remove('hidden');
      memberDetailCache = null;
      $('member-detail').innerHTML = '<div class="member-empty-state"><p>请选择下方匹配的会员</p></div>';
      renderMemberPickList(data.members);
      return;
    }
    $('member-pick-list').classList.add('hidden');
    selectedMemberId = data.user.id;
    renderMemberHero(data.user, data.storedWineCount, data.storedWine);
    await loadMemberDetail(data.user.id, data);
    showToast(`已找到 ${data.user.nickname}`);
  } catch (e) {
    $('member-hero')?.classList.add('hidden');
    $('member-hero-placeholder')?.classList.remove('hidden');
    $('member-pick-list').classList.add('hidden');
    memberDetailCache = null;
    $('member-detail').innerHTML = `<div class="member-empty-state"><p>${esc(e.message)}</p></div>`;
  }
}

async function loadMemberDetail(id, cached = null) {
  selectedMemberId = id;
  const data = cached || await api(`/api/admin/members/${id}`);
  memberDetailCache = data;
  if (!cached) renderMemberHero(data.user, data.storedWineCount, data.storedWine);
  renderMemberTabContent(data);
}

async function loadPendingRedeems() {
  try {
    const data = await api('/api/admin/redeem/pending');
    const el = $('pending-redeems');
    const countEl = $('pending-redeem-count');
    if (countEl) countEl.textContent = data.redemptions?.length || 0;
    if (!data.redemptions.length) {
      el.innerHTML = '<div class="res-item">暂无待核销</div>';
      return;
    }
    el.innerHTML = data.redemptions.map((r) => `
      <div class="pending-item" data-code="${esc(r.pickupCode)}">
        <div>
          <div class="pending-code">${esc(r.pickupCode)}</div>
          <div class="pending-meta">${esc(r.productName)} · ${r.pointsCost}积分</div>
        </div>
        <div class="pending-meta">${esc(r.nickname)}<br>${r.created_at}</div>
      </div>
    `).join('');
    el.querySelectorAll('.pending-item').forEach((item) => {
      item.onclick = () => {
        $('redeem-code').value = item.dataset.code;
        $('redeem-btn').click();
      };
    });
  } catch (_) {
    $('pending-redeems').innerHTML = '<div class="res-item">加载失败</div>';
  }
}

async function loadRedeemHistory() {
  const el = $('redeem-history-list');
  if (!el) return;
  try {
    const status = redeemHistoryFilter === 'completed' ? 'completed' : 'all';
    const data = await api(`/api/admin/redeem/history?status=${status}&limit=30`);
    if (!data.redemptions?.length) {
      el.innerHTML = '<div class="res-item">暂无记录</div>';
      return;
    }
    el.innerHTML = data.redemptions.map((r) => `
      <div class="ref-log-item">
        <span>
          <strong class="gold">${esc(r.pickupCode)}</strong> ${esc(r.productName)}
          <br><small class="muted">${esc(r.nickname)} · ${r.status === 'pending' ? '待取' : '已核销'}</small>
        </span>
        <span class="muted">${formatChinaDateTime(r.verifiedAt || r.createdAt)}</span>
      </div>
    `).join('');
  } catch (e) {
    el.innerHTML = `<div class="res-item">${esc(e.message)}</div>`;
  }
}

function loadRedeemPage() {
  loadPendingRedeems();
  loadRedeemHistory();
  document.querySelectorAll('#redeem-history-tabs .ref-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.rh === redeemHistoryFilter);
    btn.onclick = () => {
      redeemHistoryFilter = btn.dataset.rh;
      loadRedeemPage();
    };
  });
}

function renderWineList() {
  const el = $('wine-list');
  const kw = wineSearchKw.toLowerCase();
  const filtered = kw
    ? wineItems.filter((w) =>
      (w.pickupCode || '').toLowerCase().includes(kw)
      || (w.nickname || '').toLowerCase().includes(kw)
      || (w.productName || '').toLowerCase().includes(kw))
    : wineItems;

  if (!filtered.length) {
    el.innerHTML = `<div class="empty-state"><p>${wineTab === 'pending' ? '暂无待取存酒' : '暂无已取记录'}${kw ? '（无匹配筛选）' : ''}</p></div>`;
    return;
  }

  el.innerHTML = `
    <table class="order-track-table">
      <thead><tr>
        <th>存酒时间</th><th>客人</th><th>酒水</th><th>取酒码</th><th>积分</th><th>操作</th>
      </tr></thead>
      <tbody>${filtered.map((w) => `
        <tr>
          <td>${formatChinaDateTime(w.createdAt)}</td>
          <td>${esc(w.nickname)}</td>
          <td>${esc(w.productName)}</td>
          <td><strong class="gold">${esc(w.pickupCode)}</strong></td>
          <td>${w.pointsCost}</td>
          <td>
            ${wineTab === 'pending' ? `<button class="btn-link-sm" data-verify="${esc(w.pickupCode)}">去核销</button>` : ''}
            <button class="btn-link-sm" data-member="${w.userId}">会员</button>
          </td>
        </tr>
      `).join('')}</tbody>
    </table>`;

  el.querySelectorAll('[data-verify]').forEach((btn) => {
    btn.onclick = () => {
      switchPage('redeem');
      $('redeem-code').value = btn.dataset.verify;
      $('redeem-btn').click();
    };
  });
  el.querySelectorAll('[data-member]').forEach((btn) => {
    btn.onclick = () => { switchPage('members'); loadMemberDetail(btn.dataset.member); };
  });
}

async function loadWinePage() {
  document.querySelectorAll('#wine-tabs .ref-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.wine === wineTab);
    btn.onclick = () => { wineTab = btn.dataset.wine; loadWinePage(); };
  });
  const searchEl = $('wine-search');
  if (searchEl && !searchEl.dataset.bound) {
    searchEl.dataset.bound = '1';
    searchEl.oninput = () => {
      wineSearchKw = searchEl.value.trim();
      renderWineList();
    };
  }
  try {
    const data = await api(`/api/admin/stored-wine?status=${wineTab}`);
    wineItems = data.items || [];
    renderWineList();
  } catch (e) {
    $('wine-list').innerHTML = `<div class="res-item">${esc(e.message)}</div>`;
  }
}

async function loadAuditPage() {
  const el = $('audit-list');
  try {
    const q = `from=${auditFrom}&to=${auditTo}${$('audit-action')?.value ? `&action=${encodeURIComponent($('audit-action').value)}` : ''}`;
    const data = await api(`/api/admin/audit-logs?${q}`);
    if (!data.logs?.length) {
      el.innerHTML = '<div class="empty-state"><p>该时段暂无操作记录</p></div>';
      return;
    }
    const actionLabels = {
      admin_login: '登录',
      admin_cash_order: '现金补录',
      admin_groupon_verify: '团购核销',
      admin_stored_score: '存分调整',
      admin_redeem_verify: '兑换核销',
      admin_inventory_update: '库存调整',
      admin_inventory_create: '新增原料',
      admin_inventory_purchase: '采购入库',
      admin_product_update: '商品更新',
      admin_shift_open: '开班',
      admin_shift_close: '交班',
      admin_order_status: '订单状态',
    };
    el.innerHTML = `
      <table class="order-track-table">
        <thead><tr><th>时间</th><th>操作</th><th>操作人</th><th>详情</th><th>IP</th></tr></thead>
        <tbody>${data.logs.map((l) => `
          <tr>
            <td>${formatChinaDateTime(l.createdAt)}</td>
            <td>${actionLabels[l.action] || l.action}</td>
            <td>${esc(l.adminName)}${l.nickname ? `<br><span class="muted small">${esc(l.nickname)}</span>` : ''}</td>
            <td><span class="audit-detail" title="${esc(l.detail)}">${esc(l.detail?.slice(0, 80) || '—')}</span></td>
            <td class="muted">${esc(l.ip || '—')}</td>
          </tr>
        `).join('')}</tbody>
      </table>`;
  } catch (e) {
    el.innerHTML = `<div class="res-item">${esc(e.message)}</div>`;
  }
}

async function loadShiftPanel() {
  try {
    const data = await api('/api/admin/shift/current');
    const badge = $('shift-status-badge');
    const info = $('shift-info');
    const openForm = $('shift-open-form');
    const closeForm = $('shift-close-form');
    if (data.shift) {
      badge.textContent = '营业中';
      badge.className = 'shift-badge open';
      info.innerHTML = `开班 ${formatChinaDateTime(data.shift.openedAt)} · ${esc(data.shift.adminName)}<br>本班现金营收 <strong class="gold">¥${data.shift.cashSalesYuan}</strong> · 备用金 ¥${data.shift.openingCashYuan}`;
      openForm?.classList.add('hidden');
      closeForm?.classList.remove('hidden');
    } else {
      badge.textContent = '未开班';
      badge.className = 'shift-badge closed';
      info.textContent = '开班后可统计本班现金营收';
      openForm?.classList.remove('hidden');
      closeForm?.classList.add('hidden');
    }
  } catch (_) {}
}

async function loadToolsPage() {
  await loadShiftPanel();
}

async function loadInventoryExtras() {
  try {
    const [mov, pur] = await Promise.all([
      api('/api/admin/inventory/movements?limit=30'),
      api('/api/admin/inventory/purchases?limit=20'),
    ]);
    const movEl = $('inventory-movements');
    if (movEl) {
      movEl.innerHTML = mov.movements?.length
        ? mov.movements.map((m) => `
          <div class="ref-log-item">
            <span>${esc(m.itemName)} <strong class="${m.deltaQty >= 0 ? 'pos' : 'neg'}">${m.deltaQty >= 0 ? '+' : ''}${m.deltaQty}</strong> ${esc(m.unit)}<br><small class="muted">${esc(m.reason)}</small></span>
            <span class="muted">${formatChinaDateTime(m.createdAt)}</span>
          </div>
        `).join('')
        : '<div class="res-item">暂无流水</div>';
    }
    const purEl = $('inventory-purchases');
    if (purEl) {
      purEl.innerHTML = pur.purchases?.length
        ? pur.purchases.map((p) => `
          <div class="ref-log-item">
            <span>${esc(p.itemName)} +${p.qty} ${esc(p.unit)}<br><small class="muted">${esc(p.supplierName)}</small></span>
            <span class="muted">${formatChinaDateTime(p.createdAt)}</span>
          </div>
        `).join('')
        : '<div class="res-item">暂无采购</div>';
    }
  } catch (_) {}
}

function renderHistoryFlow(timeline) {
  const steps = timeline || [];
  return steps.map((s, i) => `
    <div class="flow-segment ${s.done ? 'done' : 'pending'}">
      <div class="flow-node">${i + 1}</div>
      <div class="flow-body">
        <span class="flow-label">${esc(s.label)}</span>
        <span class="flow-time">${s.done ? esc(s.time || s.dateTime || '—') : '—'}</span>
      </div>
    </div>
    ${i < steps.length - 1 ? '<div class="flow-line"></div>' : ''}
  `).join('');
}

function renderHistoryCard(o) {
  const itemsPreview = o.items.slice(0, 2).map((i) => `${i.name}×${i.qty}`).join('、');
  const more = o.items.length > 2 ? ` 等${o.items.length}项` : '';

  return `
    <div class="order-card history-card ${o.status}" data-id="${o.id}" role="button" tabindex="0">
      <div class="history-card-top">
        <div>
          <div class="pickup-no">#${esc(o.pickupNo || '----')}</div>
          <div class="history-meta-line">${esc(o.nickname)} · ${esc(o.tableName)} · ¥${o.totalYuan}</div>
        </div>
        <span class="status-pill status-${o.status}">${esc(o.statusLabel || o.status)}</span>
      </div>
      <div class="history-flow">${renderHistoryFlow(o.timeline)}</div>
      <div class="card-meta">
        <span class="meta-tag">${esc(o.nickname)}</span>
        ${o.phone ? `<span class="meta-tag">${esc(o.phone)}</span>` : ''}
        <span class="meta-tag table">${esc(o.tableName)}</span>
      </div>
      <div class="history-items muted">${esc(itemsPreview)}${more}</div>
      <div class="history-card-foot">
        <div>
          <div class="card-price">¥${o.totalYuan}</div>
          <div class="card-pay">${payLabel(o.paymentMethod)}${o.wxTransactionId ? ` · ${esc(String(o.wxTransactionId).slice(0, 12))}…` : ''}</div>
        </div>
        <span class="history-detail-hint">查看详情 ›</span>
      </div>
    </div>
  `;
}

function bindHistoryCards(container) {
  container.querySelectorAll('.history-card').forEach((card) => {
    const open = () => openOrderDetail(card.dataset.id);
    card.onclick = (e) => {
      if (e.target.closest('button')) return;
      open();
    };
    card.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    };
  });
}

function closeOrderDetail() {
  $('order-detail-mask').classList.add('hidden');
}

async function openOrderDetail(orderId) {
  if (!orderId) return;
  try {
    const data = await api(`/api/admin/orders/${encodeURIComponent(orderId)}`);
    renderOrderDetailModal(data);
    $('order-detail-mask').classList.remove('hidden');
  } catch (e) {
    showToast(e.message || '加载订单详情失败');
  }
}

function renderOrderDetailModal({ order: o, paymentLogs }) {
  $('order-detail-title').textContent = `订单 #${o.pickupNo || '----'}`;

  const rows = [
    ['订单状态', o.statusLabel || o.status],
    ['内部订单号', o.internalOrderId || o.id],
    ['下单客人', o.nickname || '—'],
    ['手机号', o.phone || '未绑定'],
    ['会员码', o.inviteCode || '—'],
    ['微信 OpenID', o.openid || o.openidMasked || '—'],
    ['桌位', o.tableName || '—'],
    ['支付方式', payLabel(o.paymentMethod)],
    ['微信交易号', o.wxTransactionId || '—'],
    ['实付金额', `¥${o.totalYuan}`],
    ['赠送积分', String(o.pointsEarned || 0)],
    ['下单时间', `${o.createdAtLabel || formatChinaDateTime(o.createdAt) || '—'}（北京时间）`],
    ['支付时间', `${o.paidAtLabel || formatChinaDateTime(o.paidAt) || '—'}（北京时间）`],
    ['开始制作', `${o.makingAtLabel || formatChinaDateTime(o.makingAt) || '—'}（北京时间）`],
    ['完成时间', `${o.doneAtLabel || formatChinaDateTime(o.doneAt) || '—'}（北京时间）`],
    ['操作员', o.operatorName || '—'],
  ];

  const itemsTable = (o.itemsDetail || o.items || []).map((i) => `
    <tr>
      <td>${esc(i.name)}</td>
      <td>${esc(i.category || '')}</td>
      <td>${i.qty}</td>
      <td>¥${i.unitYuan || i.lineYuan || '—'}</td>
      <td>¥${i.lineYuan || '—'}</td>
    </tr>
  `).join('');

  const payLogs = (paymentLogs || []).length
    ? paymentLogs.map((p) => `<div class="detail-log">${esc(p.channel)} · ${esc(formatChinaDateTime(p.at))}（北京时间）</div>`).join('')
    : '<div class="detail-log muted">无支付流水记录</div>';

  $('order-detail-body').innerHTML = `
    <div class="detail-section">
      <h4>基本信息</h4>
      <div class="detail-grid">
        ${rows.map(([k, v]) => `
          <div class="detail-row">
            <span class="detail-key">${esc(k)}</span>
            <span class="detail-val">${esc(String(v))}</span>
          </div>
        `).join('')}
      </div>
    </div>
    ${o.note ? `<div class="detail-section"><h4>备注</h4><div class="detail-note">${esc(o.note)}</div></div>` : ''}
    <div class="detail-section">
      <h4>商品明细</h4>
      <table class="detail-table">
        <thead><tr><th>商品</th><th>分类</th><th>数量</th><th>单价</th><th>小计</th></tr></thead>
        <tbody>${itemsTable || '<tr><td colspan="5">无商品</td></tr>'}</tbody>
      </table>
    </div>
    <div class="detail-section">
      <h4>支付流水</h4>
      ${payLogs}
    </div>
    <div class="detail-actions">
      ${o.status === 'pending' ? `<button class="btn-cancel" data-id="${o.id}" data-action="cancelled">取消订单</button>` : ''}
      ${o.status === 'paid' ? `<button class="btn-make" data-id="${o.id}" data-action="making">开始制作</button>` : ''}
      ${o.status === 'making' ? `<button class="btn-done" data-id="${o.id}" data-action="done">标记完成</button>` : ''}
      <button type="button" class="btn-ghost-sm" id="order-detail-goto-member" data-uid="${esc(o.userId)}">查该会员</button>
    </div>
  `;

  bindCardActions($('order-detail-body'));
  $('order-detail-goto-member')?.addEventListener('click', () => {
    closeOrderDetail();
    switchPage('members');
    const phone = o.phoneFull || o.phone || '';
    if (phone && !phone.includes('*')) {
      $('member-phone').value = phone;
      lookupMemberByPhone();
    } else if (o.userId) {
      loadMemberDetail(o.userId);
    }
  });
}

function renderHistoryPagination(total, page, pageSize) {
  const bar = $('history-pagination');
  const pages = Math.ceil(total / pageSize);
  if (pages <= 1) {
    bar.classList.add('hidden');
    bar.innerHTML = '';
    return;
  }
  bar.classList.remove('hidden');
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  bar.innerHTML = `
    <span class="pagination-info">第 ${from}–${to} 条，共 ${total} 条</span>
    <div class="pagination-btns">
      <button type="button" class="page-btn" data-page="prev" ${page <= 1 ? 'disabled' : ''}>上一页</button>
      <span class="page-num">${page} / ${pages}</span>
      <button type="button" class="page-btn" data-page="next" ${page >= pages ? 'disabled' : ''}>下一页</button>
    </div>
  `;
  bar.querySelector('[data-page="prev"]')?.addEventListener('click', () => {
    if (historyPage > 1) { historyPage -= 1; renderHistory(); }
  });
  bar.querySelector('[data-page="next"]')?.addEventListener('click', () => {
    if (historyPage < pages) { historyPage += 1; renderHistory(); }
  });
}

function renderHistory() {
  const q = ($('history-search').value || '').trim().toLowerCase();
  const filtered = q
    ? historyOrders.filter((o) =>
      String(o.pickupNo).includes(q)
      || (o.nickname || '').toLowerCase().includes(q)
      || (o.phone || '').includes(q)
      || (o.internalOrderId || o.id || '').toLowerCase().includes(q)
      || (o.wxTransactionId || '').toLowerCase().includes(q))
    : historyOrders;

  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));
  if (historyPage > pages) historyPage = pages;

  const slice = filtered.slice((historyPage - 1) * HISTORY_PAGE_SIZE, historyPage * HISTORY_PAGE_SIZE);

  const el = $('history-list');
  if (!total) {
    el.innerHTML = '<div class="card-stack-empty">暂无订单</div>';
    renderHistoryPagination(0, 1, HISTORY_PAGE_SIZE);
    return;
  }
  el.innerHTML = `
    <table class="order-track-table history-table">
      <thead><tr>
        <th>时间</th><th>取餐号</th><th>客人</th><th>金额</th><th>支付方式</th><th>状态</th><th>操作</th>
      </tr></thead>
      <tbody>${slice.map((o) => `
        <tr data-id="${o.id}">
          <td>${formatChinaDateTime(o.paidAt || o.createdAt)}</td>
          <td><strong>#${esc(o.pickupNo)}</strong></td>
          <td>${esc(o.nickname)}${o.phone ? `<br><span class="muted small">${esc(o.phone)}</span>` : ''}</td>
          <td class="gold">¥${o.totalYuan}</td>
          <td>${payLabel(o.paymentMethod)}</td>
          <td><span class="status-pill status-${o.status}">${esc(o.statusLabel || o.status)}</span></td>
          <td>
            <button type="button" class="btn-link-sm" data-detail="${o.id}">详情</button>
            ${o.userId ? `<button type="button" class="btn-link-sm" data-member="${o.userId}">查会员</button>` : ''}
          </td>
        </tr>
      `).join('')}</tbody>
    </table>`;

  el.querySelectorAll('[data-detail]').forEach((btn) => {
    btn.onclick = (e) => { e.stopPropagation(); openOrderDetail(btn.dataset.detail); };
  });
  el.querySelectorAll('[data-member]').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      switchPage('members');
      loadMemberDetail(btn.dataset.member);
    };
  });
  el.querySelectorAll('tbody tr').forEach((row) => {
    row.onclick = () => openOrderDetail(row.dataset.id);
  });
  renderHistoryPagination(total, historyPage, HISTORY_PAGE_SIZE);
}

function renderStatsPage() {
  if (!statsData) return;
  const s = statsData;

  const label = s.isRange
    ? `${s.dateFrom} 至 ${s.dateTo}（${s.days}天）`
    : (s.isToday ? '今天' : s.dateFrom);
  $('stats-date-hint').textContent = s.isRange
    ? `区间汇总 · 共 ${s.days} 天`
    : (s.isToday ? '查看今天' : `单日数据 · ${s.dateFrom}`);

  $('stats-overview').innerHTML = `
    <div class="stat-tile stat-hero highlight">
      <div class="label">${label} 实收</div>
      <div class="value gold">¥${s.revenueYuan}</div>
      <div class="stat-sub">${s.orderCount} 笔成交 · 客 ${s.totalCustomers} 人</div>
    </div>
    <div class="stat-tile">
      <div class="label">成交订单</div>
      <div class="value">${s.orderCount}</div>
    </div>
    <div class="stat-tile">
      <div class="label">客单价</div>
      <div class="value gold">¥${s.avgOrderYuan || '0.00'}</div>
    </div>
    <div class="stat-tile">
      <div class="label">待支付</div>
      <div class="value brand">${s.pendingPay}</div>
    </div>
    <div class="stat-tile">
      <div class="label">待制作</div>
      <div class="value">${s.queuePaid}</div>
    </div>
    <div class="stat-tile">
      <div class="label">制作中</div>
      <div class="value">${s.queueMaking}</div>
    </div>
    <div class="stat-tile">
      <div class="label">消费客人</div>
      <div class="value">${s.totalCustomers}</div>
    </div>
    <div class="stat-tile">
      <div class="label">复购率</div>
      <div class="value gold">${s.repeatRatePct}%</div>
    </div>
    ${s.peakHour ? `
    <div class="stat-tile">
      <div class="label">高峰时段</div>
      <div class="value">${s.peakHour}</div>
    </div>` : ''}
  `;

  const maxQty = Math.max(...s.topProducts.map((p) => p.qty), 1);
  $('top-products').innerHTML = s.topProducts.length
    ? `<div class="rank-list">${s.topProducts.map((p, i) => `
      <div class="rank-item">
        <span class="rank-no">${i + 1}</span>
        <span class="rank-name" title="${esc(p.name)}">${esc(p.name)}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${(p.qty / maxQty) * 100}%"></div></div>
        <span class="rank-qty">${p.qty}</span>
      </div>
    `).join('')}</div>`
    : '<div class="card-stack-empty">暂无销售数据</div>';

  const trendTitle = $('trend-chart-title');
  const chartEl = $('hourly-chart');
  if (s.isRange) {
    trendTitle.textContent = '每日营收趋势';
    const maxDay = Math.max(...(s.daily || []).map((d) => Number(d.revenueYuan)), 1);
    chartEl.innerHTML = (s.daily || []).length
      ? s.daily.map((d) => `
        <div class="hour-bar-wrap" title="¥${d.revenueYuan}">
          <div class="hour-bar" style="height:${Math.max(4, (Number(d.revenueYuan) / maxDay) * 100)}%"></div>
          <span class="hour-label">${d.date.slice(5)}</span>
        </div>
      `).join('')
      : '<div class="card-stack-empty">该区间暂无数据</div>';
  } else {
    trendTitle.textContent = '时段分布';
    const maxHour = Math.max(...s.hourly.map((h) => h.count), 1);
    chartEl.innerHTML = s.hourly.length
      ? s.hourly.map((h) => `
        <div class="hour-bar-wrap">
          <div class="hour-bar" style="height:${Math.max(4, (h.count / maxHour) * 100)}%"></div>
          <span class="hour-label">${h.hour}</span>
        </div>
      `).join('')
      : '<div class="card-stack-empty">暂无时段数据</div>';
  }

  $('method-breakdown').innerHTML = s.byMethod.length
    ? s.byMethod.map((m) => `
      <div class="method-row">
        <span>${esc(m.label)} · ${m.count}笔</span>
        <strong>¥${m.revenueYuan}</strong>
      </div>
    `).join('')
    : '<div class="card-stack-empty">暂无支付数据</div>';

  $('repeat-stats').innerHTML = `
    <div class="method-row">
      <span>消费客人</span>
      <strong>${s.totalCustomers} 人</strong>
    </div>
    <div class="method-row">
      <span>复购客人（≥2单）</span>
      <strong>${s.repeatCustomers} 人</strong>
    </div>
    <div class="method-row">
      <span>复购率</span>
      <strong class="gold">${s.repeatRatePct}%</strong>
    </div>
    ${s.peakHour ? `
    <div class="method-row">
      <span>高峰时段（${s.peakHour}）</span>
      <strong>${s.peakHourOrders} 单</strong>
    </div>` : ''}
  `;

  const tableEl = $('table-breakdown');
  if (tableEl) {
    tableEl.innerHTML = (s.byTable || []).length
      ? s.byTable.map((t) => `
        <div class="method-row">
          <span>${esc(t.name)} · ${t.count}笔</span>
          <strong>¥${t.revenueYuan}</strong>
        </div>
      `).join('')
      : '<div class="card-stack-empty">暂无桌位数据</div>';
  }

  const channelEl = $('channel-chart');
  if (channelEl && s.byMethod?.length) {
    const totalRev = s.byMethod.reduce((n, m) => n + Number(m.revenueYuan), 0) || 1;
    channelEl.innerHTML = s.byMethod.map((m) => {
      const pct = Math.round((Number(m.revenueYuan) / totalRev) * 100);
      return `
        <div class="channel-bar-row">
          <span>${esc(m.label)}</span>
          <div class="channel-bar-track"><div class="channel-bar-fill" style="width:${pct}%"></div></div>
          <strong>${pct}%</strong>
        </div>`;
    }).join('');
  } else if (channelEl) {
    channelEl.innerHTML = '<div class="card-stack-empty">暂无渠道数据</div>';
  }

  const orderTable = $('recent-orders-table');
  if (orderTable) {
    orderTable.innerHTML = (s.recentOrders || []).length
      ? `<table class="order-track-table">
        <thead><tr>
          <th>时间</th><th>取餐号</th><th>客人</th><th>金额</th><th>支付方式</th><th>状态</th>
        </tr></thead>
        <tbody>${s.recentOrders.map((o) => `
          <tr>
            <td>${formatChinaDateTime(o.paidAt)}</td>
            <td>#${esc(o.pickupNo)}</td>
            <td>${esc(o.nickname)}${o.phone ? `<br><span class="muted small">${esc(o.phone)}</span>` : ''}</td>
            <td class="gold">¥${o.totalYuan}</td>
            <td>${esc(o.paymentLabel)}</td>
            <td>${o.status === 'done' ? '已完成' : o.status === 'making' ? '制作中' : '已支付'}</td>
          </tr>
        `).join('')}</tbody>
      </table>`
      : '<div class="card-stack-empty">该时段暂无成交订单</div>';
  }
}

function switchPage(page) {
  currentPage = page;
  document.querySelectorAll('.nav-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.page === page);
  });
  document.querySelectorAll('.page').forEach((el) => {
    el.classList.toggle('active', el.id === `page-${page}`);
  });
  $('page-title').textContent = PAGE_TITLES[page] || page;

  if (page === 'board') renderBoard();
  else if (page === 'floor') loadFloorPage();
  else if (page === 'history') {
    $('history-from').value = historyFrom;
    $('history-to').value = historyTo;
    loadHistory();
  } else if (page === 'members') {
    $('member-phone')?.focus();
    if (window.Ico) Ico.injectStaticIcons();
    bindMemberTabs();
  } else if (page === 'redeem') {
    loadRedeemPage();
  } else if (page === 'wine') {
    loadWinePage();
  } else if (page === 'audit' && adminRole !== 'owner') {
    showToast('审计日志需老板账号');
    switchPage('board');
  } else if (page === 'audit') {
    $('audit-from').value = auditFrom;
    $('audit-to').value = auditTo;
    loadAuditPage();
  } else if (page === 'products') {
    loadProducts();
  } else if (page === 'inventory') {
    loadInventoryPage();
  } else if (page === 'stats') {
    $('stats-from').value = statsFrom;
    $('stats-to').value = statsTo;
    loadStats(statsFrom, statsTo).then(() => renderStatsPage());
  } else if (page === 'stored' && adminRole !== 'owner') {
    showToast('存分管理需老板账号');
    switchPage('board');
  } else if (page === 'stored') {
    loadStoredPage();
  } else if (page === 'tools' && adminRole !== 'owner') {
    showToast('营运工具需老板账号');
    switchPage('board');
  } else if (page === 'tools') {
    loadToolsPage();
  }
}

function applyRoleNav() {
  document.querySelectorAll('[data-role="owner"]').forEach((el) => {
    el.classList.toggle('hidden', adminRole !== 'owner');
  });
  if ($('btn-purchase-ingredient')) {
    $('btn-purchase-ingredient').classList.toggle('hidden', adminRole !== 'owner');
  }
}

let inventoryData = [];

async function loadInventoryPage() {
  const el = $('inventory-list');
  try {
    const data = await api('/api/admin/inventory');
    inventoryData = data.items || [];
    renderInventoryList();
    bindInventoryFilters();
    loadInventoryExtras();
  } catch (e) {
    if (el) {
      el.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div>${esc(e.message || '加载失败')}</div><button class="btn-accent" onclick="loadInventoryPage()">重试</button></div>`;
    }
  }
}

function renderInventoryList(filtered = null) {
  const el = $('inventory-list');
  const list = filtered || inventoryData;
  if (!list.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">📦</div><div>暂无原料，点击右上角「新增原料」添加</div><button class="btn-accent" id="inv-empty-add">+ 新增原料</button></div>`;
    $('inv-empty-add')?.addEventListener('click', showAddIngredientModal);
    return;
  }
  el.innerHTML = list.map((item) => `
    <div class="product-card inventory-card ${item.lowStock ? 'low' : ''}" data-id="${item.id}">
      ${AdminUI.inventoryThumb(item.name)}
      <div class="product-body">
        <div class="product-name">${esc(item.name)} ${item.lowStock ? '<span class="badge-warn">低库存</span>' : ''}</div>
        <div class="product-meta">
          <span>单位 ${esc(item.unit)}</span>
          <span>预警 ${item.alertQty}</span>
        </div>
        <div class="inventory-qty">
          <input type="number" step="0.1" value="${item.stockQty}" data-field="stock" />
          <button class="btn-accent btn-ghost-sm" data-save="${item.id}">保存</button>
        </div>
      </div>
    </div>
  `).join('');

  el.querySelectorAll('[data-save]').forEach((btn) => {
    btn.onclick = async () => {
      const card = btn.closest('.inventory-card');
      const stockQty = card.querySelector('[data-field="stock"]').value;
      try {
        const res = await api(`/api/admin/inventory/${btn.dataset.save}`, {
          method: 'PATCH',
          body: JSON.stringify({ stockQty: Number(stockQty) }),
        });
        showToast(res.message);
        loadInventoryPage();
        loadInventoryAlerts();
      } catch (e) { showToast(e.message); }
    };
  });
}

function bindInventoryFilters() {
  const search = $('inv-search');
  const lowBtn = $('inv-filter-low');
  const addBtn = $('btn-add-ingredient');

  if (search) {
    search.oninput = () => {
      const kw = search.value.trim().toLowerCase();
      const filtered = inventoryData.filter(i => i.name.toLowerCase().includes(kw));
      renderInventoryList(filtered);
    };
  }

  if (lowBtn) {
    lowBtn.onclick = () => {
      const showLow = lowBtn.classList.toggle('active');
      const filtered = showLow ? inventoryData.filter(i => i.lowStock) : inventoryData;
      renderInventoryList(filtered);
    };
  }

  if (addBtn) {
    addBtn.onclick = () => showAddIngredientModal();
  }
}

function showAddIngredientModal() {
  const mask = $('add-ingredient-mask');
  if (!mask) return;
  mask.classList.remove('hidden');

  // 绑定关闭
  $('add-ingredient-close').onclick = () => mask.classList.add('hidden');
  $('add-ingredient-cancel').onclick = () => mask.classList.add('hidden');

  // 确认新增
  $('add-ingredient-confirm').onclick = async () => {
    const name = $('ing-name').value.trim();
    const unit = $('ing-unit').value.trim() || '片';
    const stockQty = Number($('ing-qty').value) || 0;
    const alertQty = Number($('ing-alert').value) || 10;

    if (!name) {
      showToast('请输入原料名称');
      return;
    }

    try {
      const res = await api('/api/admin/inventory', {
        method: 'POST',
        body: JSON.stringify({ name, unit, stockQty, alertQty }),
      });
      showToast(res.message || '新增成功');
      mask.classList.add('hidden');
      loadInventoryPage();
      loadInventoryAlerts();
    } catch (e) {
      showToast(e.message || '新增失败');
    }
  };
}

function renderStoredHero(u) {
  const hero = $('stored-hero');
  if (!hero) return;
  hero.innerHTML = `
    <div class="fuint-vip-head">
      <div class="fuint-vip-avatar">${esc((u.nickname || '酒')[0])}</div>
      <div>
        <div class="fuint-vip-name">${esc(u.nickname)}</div>
        <span class="fuint-vip-tier">${esc(u.levelName || '会员')}</span>
        <div class="fuint-vip-meta">${esc(u.phone || '未绑定手机')} · ID ${esc(u.id)}</div>
      </div>
    </div>
    <div class="fuint-vip-stats">
      <div class="fuint-stat-tile gold">
        <small>会员积分</small>
        <strong>${u.points ?? 0}</strong>
      </div>
      <div class="fuint-stat-tile accent">
        <small>存分余额</small>
        <strong>${u.storedScore ?? 0}</strong>
      </div>
      <div class="fuint-stat-tile">
        <small>储值余额</small>
        <strong>¥${u.balanceYuan ?? '0.00'}</strong>
      </div>
    </div>
  `;
}

async function loadStoredMember(id, opts = {}) {
  const data = await api(`/api/admin/members/${id}`);
  storedMemberId = data.user.id;
  $('stored-page-user-id').value = data.user.id;
  const codeEl = $('stored-page-code');
  if (codeEl) {
    codeEl.value = data.user.memberCode || data.user.inviteCode || '';
  }
  renderStoredHero(data.user);
  if (!opts.silent) showToast(`已加载 ${data.user.nickname}`);
}

async function gotoStoredWithMember(id) {
  switchPage('stored');
  await loadStoredMember(id, { silent: true });
}

async function lookupStoredByCode() {
  const code = ($('stored-page-code')?.value || '').trim().toUpperCase();
  if (!code) return showToast('请输入会员码');
  try {
    const data = await api(`/api/admin/members/scan/${encodeURIComponent(code)}`);
    await loadStoredMember(data.user.id);
  } catch (e) { showToast(e.message); }
}

function loadStoredPage() {
  if (window.Ico) Ico.injectStaticIcons();
  renderPointsMallGrid('stored-points-mall');
  if (!storedMemberId && $('stored-hero')) {
    $('stored-hero').innerHTML = `
      <div class="fuint-vip-empty">
        <span data-icon="star" data-icon-class="ico ico-xl"></span>
        <p>输入会员码加载，或从「会员查询」带入</p>
      </div>`;
    if (window.Ico) Ico.injectStaticIcons();
  }
}

function renderProductCard(p) {
  const thumb = AdminUI.productThumb(p.name, p.category) || `<div class="product-thumb"><div style="height:100%;background:#222;"></div></div>`;
  return `
    <div class="product-card ${!p.enabled ? 'off' : ''} ${p.soldOut ? 'soldout' : ''}" data-id="${p.id}">
      ${thumb}
      <div class="product-body">
        <div class="product-name">${esc(p.name)}</div>
        <div class="product-meta">
          <span>${esc(p.category)}</span>
          <span class="product-price">¥${p.priceYuan}</span>
          ${p.pointsReward ? `<span class="product-points">+${p.pointsReward} 积分</span>` : ''}
        </div>
        ${adminRole === 'owner' ? `
        <div class="product-inline-edit">
          <label>积分兑换价</label>
          <input type="number" value="${p.pointsRedeemCost ?? ''}" data-redeem-cost placeholder="—" />
          <button class="btn-ghost-sm" data-save-redeem="${p.id}">保存</button>
        </div>` : (p.pointsRedeemCost ? `<div class="product-meta"><span class="product-points">${p.pointsRedeemCost} 积分可兑</span></div>` : '')}
        <div class="product-toggles">
          <button class="toggle-btn warn ${p.soldOut ? 'on' : ''}" data-act="soldOut" data-id="${p.id}">
            ${p.soldOut ? '已估清' : '估清'}
          </button>
          ${adminRole === 'owner' ? `
            <button class="toggle-btn ${p.enabled ? 'on' : ''}" data-act="enabled" data-id="${p.id}">
              ${p.enabled ? '已上架' : '已下架'}
            </button>
          ` : ''}
        </div>
      </div>
    </div>
  `;
}

function renderProductsCatalog() {
  const el = $('products-list');
  const filtered = productFilter === 'all'
    ? allProducts
    : allProducts.filter((p) => AdminUI.productShelf(p.category) === productFilter);

  if (!filtered.length) {
    el.innerHTML = '<div class="card-stack-empty">该分类暂无商品</div>';
    return;
  }

  const groups = { drink: [], food: [], other: [] };
  for (const p of filtered) groups[AdminUI.productShelf(p.category)].push(p);

  const order = productFilter === 'all' ? ['drink', 'food', 'other'] : [productFilter];
  el.innerHTML = order.filter((k) => groups[k].length).map((k) => `
    <section class="catalog-section">
      <h3 class="catalog-section-title">${AdminUI.shelfLabel(k)} <span class="muted">${groups[k].length}</span></h3>
      <div class="catalog-grid">${groups[k].map(renderProductCard).join('')}</div>
    </section>
  `).join('');

  el.querySelectorAll('[data-act]').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.id;
      const act = btn.dataset.act;
      const card = allProducts.find((x) => x.id === id);
      const body = act === 'soldOut'
        ? { soldOut: !card.soldOut }
        : { enabled: !card.enabled };
      try {
        await api(`/api/admin/products/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
        showToast('已更新');
        loadProducts();
        if (currentPage === 'board') loadKitchenSummary();
      } catch (e) { showToast(e.message); }
    };
  });

  el.querySelectorAll('[data-save-redeem]').forEach((btn) => {
    btn.onclick = async () => {
      const card = btn.closest('.product-card');
      const cost = card.querySelector('[data-redeem-cost]').value;
      try {
        await api(`/api/admin/products/${btn.dataset.saveRedeem}`, {
          method: 'PATCH',
          body: JSON.stringify({ pointsRedeemCost: cost === '' ? null : Number(cost) }),
        });
        showToast('积分兑换价已保存');
        loadProducts();
      } catch (e) { showToast(e.message); }
    };
  });
}

async function loadProducts() {
  const data = await api('/api/admin/products');
  allProducts = data.products;
  renderProductsCatalog();
}

async function scanMember() {
  const code = ($('member-scan').value || '').trim().toUpperCase();
  if (!code) return;
  try {
    const data = await api(`/api/admin/members/scan/${encodeURIComponent(code)}`);
    selectedMemberId = data.user.id;
    renderMemberListFromOne(data.user);
    if (data.user.phone && !data.user.phone.includes('*')) {
      $('member-phone').value = data.user.phone;
      await lookupMemberByPhone();
    } else {
      await loadMemberDetail(data.user.id);
    }
    showToast(`已识别：${data.user.nickname}`);
  } catch (e) {
    showToast(e.message);
  }
}

function renderMemberListFromOne(u) {
  if (u.phone) $('member-phone').value = u.phone.replace(/\*/g, '');
  selectedMemberId = u.id;
}

function connectSSE() {
  if (sse) { sse.close(); sse = null; }
  const t = token();
  if (!t) return;

  sse = new EventSource(`${API}/api/admin/events?token=${encodeURIComponent(t)}`);

  sse.onmessage = (ev) => {
    try {
      const event = JSON.parse(ev.data);
      if (event.type === 'order_paid') {
        flashNewOrder(`新订单 #${event.payload?.order?.pickupNo || ''}`);
        loadBoardData();
        if (currentPage === 'floor') loadFloorPage();
      } else if (event.type === 'order_new') {
        loadBoardOrders();
        if (currentPage === 'floor') loadFloorPage();
      } else if (event.type === 'order_updated' || event.type === 'stats_refresh') {
        loadBoardData();
        if (currentPage === 'floor') loadFloorPage();
      }
    } catch (_) { /* ignore */ }
    setConnStatus('live');
  };

  sse.onerror = () => {
    sse?.close();
    sse = null;
    setConnStatus('poll');
    setTimeout(connectSSE, 8000);
  };
}

function updateSoundToggle() {
  const btn = $('sound-toggle');
  if (!btn) return;
  btn.classList.toggle('sound-on', soundEnabled);
  btn.classList.toggle('sound-off', !soundEnabled);
  btn.title = soundEnabled ? '新单铃声：开' : '新单铃声：关';
  const span = btn.querySelector('[data-icon]');
  if (span && window.Ico) {
    span.dataset.icon = soundEnabled ? 'sound' : 'soundOff';
    span.innerHTML = Ico.icon(soundEnabled ? 'sound' : 'soundOff', 'ico ico-btn');
  }
}

function showApp() {
  $('login-view').classList.add('hidden');
  $('app-view').classList.remove('hidden');
  updateSoundToggle();
  if (window.Ico) Ico.injectStaticIcons();
  switchPage('board');
  loadBoardData();
  connectSSE();

  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (currentPage === 'board' || currentPage === 'stats') loadBoardData();
    else if (currentPage === 'floor') loadFloorPage();
  }, 5000);

  if (timerTick) clearInterval(timerTick);
  timerTick = setInterval(tickTimers, 1000);
}

function showLogin() {
  $('app-view').classList.add('hidden');
  $('login-view').classList.remove('hidden');
  if (pollTimer) clearInterval(pollTimer);
  if (timerTick) clearInterval(timerTick);
  if (sse) { sse.close(); sse = null; }
  lastPaidIds = new Set();
}

async function doRedeem(code, resultEl) {
  if (!code) return;
  try {
    const res = await api('/api/admin/redeem/verify', {
      method: 'POST',
      body: JSON.stringify({ pickupCode: code }),
    });
    if (resultEl) {
      resultEl.innerHTML = `<span class="result-line ok">${Ico.icon('check', 'ico ico-tip')}${esc(res.message)}</span>`;
      resultEl.className = 'redeem-result success';
    }
    showToast(res.message);
    loadPendingRedeems();
    return true;
  } catch (e) {
    if (resultEl) {
      resultEl.innerHTML = `<span class="result-line warn">${Ico.icon('close', 'ico ico-tip')}${esc(e.message)}</span>`;
      resultEl.className = 'redeem-result error';
    } else {
      showToast(e.message);
    }
    return false;
  }
}

/* ── 事件绑定 ── */
$('login-btn').onclick = async () => {
  $('login-err').textContent = '';
  try {
    const res = await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({
        username: $('username').value.trim(),
        password: $('password').value,
      }),
    });
    localStorage.setItem(TOKEN_KEY, res.token);
    localStorage.setItem('bar_admin_name', res.admin.displayName || res.admin.username);
    localStorage.setItem('bar_admin_role', res.admin.role || 'staff');
    adminInfo = res.admin;
    adminRole = res.admin.role || 'staff';
    $('admin-name').textContent = `${res.admin.displayName || res.admin.username} · ${adminRole === 'owner' ? '老板' : '员工'}`;
    applyRoleNav();
    showApp();
  } catch (e) {
    $('login-err').textContent = e.message;
  }
};

$('logout-btn').onclick = () => {
  localStorage.removeItem(TOKEN_KEY);
  showLogin();
};

$('refresh-btn').onclick = () => {
  if (currentPage === 'history') loadHistory();
  else if (currentPage === 'floor') loadFloorPage();
  else if (currentPage === 'stats') loadStats(statsFrom, statsTo).then(() => renderStatsPage());
  else if (currentPage === 'members' && $('member-phone').value.trim()) lookupMemberByPhone();
  else if (currentPage === 'redeem') loadPendingRedeems();
  else {
    connectSSE();
    loadBoardData();
  }
  showToast('已刷新');
};

$('fullscreen-btn').onclick = () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.();
  } else {
    document.exitFullscreen?.();
  }
};

document.querySelectorAll('.nav-item').forEach((el) => {
  el.onclick = () => switchPage(el.dataset.page);
});

$('redeem-btn').onclick = async () => {
  const code = $('redeem-code').value.trim();
  const ok = await doRedeem(code, $('redeem-result'));
  if (ok) $('redeem-code').value = '';
};

$('redeem-code').onkeydown = (e) => {
  if (e.key === 'Enter') $('redeem-btn').click();
};


$('sound-toggle')?.addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  localStorage.setItem(SOUND_KEY, soundEnabled ? 'on' : 'off');
  updateSoundToggle();
  showToast(soundEnabled ? '新单铃声已开启' : '新单铃声已关闭');
  if (soundEnabled) playDing();
});

$('stock-alert-bar')?.addEventListener('click', () => switchPage('inventory'));
$('stock-alert-bar')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    switchPage('inventory');
  }
});
$('floor-refresh-btn')?.addEventListener('click', () => {
  loadFloorPage();
  showToast('桌位已刷新');
});

$('history-search').oninput = () => { historyPage = 1; renderHistory(); };

$('order-detail-close').onclick = closeOrderDetail;
$('order-detail-mask').onclick = (e) => {
  if (e.target === $('order-detail-mask')) closeOrderDetail();
};

$('history-from').value = historyFrom;
$('history-to').value = historyTo;
$('history-query-btn').onclick = () => {
  historyFrom = $('history-from').value || todayStr();
  historyTo = $('history-to').value || historyFrom;
  if (historyFrom > historyTo) [historyFrom, historyTo] = [historyTo, historyFrom];
  $('history-from').value = historyFrom;
  $('history-to').value = historyTo;
  loadHistory();
};

function queryStats() {
  statsFrom = $('stats-from').value || todayStr();
  statsTo = $('stats-to').value || statsFrom;
  if (statsFrom > statsTo) [statsFrom, statsTo] = [statsTo, statsFrom];
  if (statsTo > todayStr()) {
    showToast('结束日期不能晚于今天');
    statsTo = todayStr();
  }
  $('stats-from').value = statsFrom;
  $('stats-to').value = statsTo;
  document.querySelectorAll('.preset-btn').forEach((b) => b.classList.remove('active'));
  loadStats(statsFrom, statsTo).then(() => renderStatsPage());
}

$('stats-from').value = statsFrom;
$('stats-to').value = statsTo;
$('stats-query-btn').onclick = queryStats;
$('stats-from').onchange = () => { document.querySelectorAll('.preset-btn').forEach((b) => b.classList.remove('active')); };
$('stats-to').onchange = () => { document.querySelectorAll('.preset-btn').forEach((b) => b.classList.remove('active')); };

document.querySelectorAll('.preset-btn').forEach((btn) => {
  btn.onclick = () => {
    setStatsPreset(btn.dataset.preset);
    loadStats(statsFrom, statsTo).then(() => renderStatsPage());
  };
});

$('member-phone-btn').onclick = lookupMemberByPhone;
$('member-phone').onkeydown = (e) => { if (e.key === 'Enter') lookupMemberByPhone(); };
$('member-tail-btn').onclick = lookupMemberByTail;
$('member-tail').onkeydown = (e) => { if (e.key === 'Enter') lookupMemberByTail(); };

document.querySelectorAll('#product-tabs .cat-tab').forEach((btn) => {
  btn.onclick = () => {
    productFilter = btn.dataset.cat;
    document.querySelectorAll('#product-tabs .cat-tab').forEach((b) => b.classList.toggle('active', b === btn));
    renderProductsCatalog();
  };
});
$('member-scan-btn').onclick = scanMember;
$('member-scan').onkeydown = (e) => { if (e.key === 'Enter') scanMember(); };

let memberTabsBound = false;
function bindMemberTabs() {
  if (memberTabsBound) return;
  document.querySelectorAll('.fuint-tab').forEach((btn) => {
    btn.onclick = () => switchMemberTab(btn.dataset.tab);
  });
  memberTabsBound = true;
}
bindMemberTabs();

$('export-csv-btn').onclick = async () => {
  if (adminRole !== 'owner') return showToast('导出需老板账号');
  try {
    const res = await fetch(`${API}/api/admin/export/orders?from=${statsFrom}&to=${statsTo}`, {
      headers: { Authorization: `Bearer ${token()}` },
    });
    if (!res.ok) throw new Error('导出失败');
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `orders_${statsFrom}_${statsTo}.csv`;
    a.click();
    showToast('CSV 已下载');
  } catch (e) { showToast(e.message); }
};

$('groupon-btn').onclick = async () => {
  try {
    const res = await api('/api/admin/groupon/verify', {
      method: 'POST',
      body: JSON.stringify({
        platform: $('groupon-platform').value,
        code: $('groupon-code').value,
        amountYuan: $('groupon-amount').value,
        productName: $('groupon-product').value,
      }),
    });
    showToast(res.message);
    $('groupon-code').value = '';
  } catch (e) { showToast(e.message); }
};

$('cash-btn').onclick = async () => {
  try {
    const res = await api('/api/admin/orders/cash', {
      method: 'POST',
      body: JSON.stringify({
        amountYuan: $('cash-amount').value,
        productName: $('cash-product').value,
        note: $('cash-note').value,
      }),
    });
    showToast(res.message);
  } catch (e) { showToast(e.message); }
};

$('goto-stored-btn')?.addEventListener('click', () => switchPage('stored'));
$('goto-stored-page')?.addEventListener('click', (e) => {
  if (e.target.closest('#goto-stored-btn')) return;
  switchPage('stored');
});

$('stored-page-load-btn')?.addEventListener('click', lookupStoredByCode);
$('stored-page-code')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') lookupStoredByCode(); });

$('stored-page-adjust-btn')?.addEventListener('click', async () => {
  const id = $('stored-page-user-id')?.value.trim();
  if (!id) return showToast('请先查询会员');
  try {
    const res = await api(`/api/admin/members/${id}/stored-score`, {
      method: 'PATCH',
      body: JSON.stringify({
        delta: Number($('stored-page-delta').value),
        reason: $('stored-page-reason').value,
      }),
    });
    showToast(res.message);
    await loadStoredMember(id);
  } catch (e) { showToast(e.message); }
});

$('stored-page-convert-btn')?.addEventListener('click', async () => {
  const id = $('stored-page-user-id')?.value.trim();
  const points = prompt('转入多少积分？（100积分=10存分）', '100');
  if (!points || !id) return;
  try {
    const res = await api(`/api/admin/members/${id}/points-to-stored`, {
      method: 'POST',
      body: JSON.stringify({ points: Number(points) }),
    });
    showToast(res.message);
    await loadStoredMember(id);
  } catch (e) { showToast(e.message); }
});

if (window.Ico) Ico.injectStaticIcons();

/* ── 积分商城配置 ── */
async function renderPointsMallGrid(targetId = 'points-mall-list') {
  const el = $(targetId);
  if (!el) return;
  try {
    const data = await api('/api/admin/products');
    const items = (data.products || []).filter((p) => p.pointsRedeemCost != null);
    if (!items.length) {
      el.innerHTML = '<div class="stored-mall-empty muted">暂无可积分兑换的商品（需在商品管理设置积分价）</div>';
      return;
    }
    el.innerHTML = `
      <table class="mall-config-table">
        <thead><tr>
          <th>商品</th><th>积分价</th><th>状态</th><th>保存</th><th>上下架</th>
        </tr></thead>
        <tbody>${items.map((p) => `
          <tr class="${!p.enabled ? 'off' : ''}" data-id="${p.id}">
            <td class="mall-name">${esc(p.name)}</td>
            <td>
              <input type="number" class="mall-cost-input" value="${p.pointsRedeemCost}" data-field="cost" min="0" />
            </td>
            <td><span class="${p.enabled ? 'mall-status-on' : 'mall-status-off'}">${p.enabled ? '在售' : '已下架'}</span></td>
            <td><button type="button" class="btn-save-points" data-act="save">保存积分价</button></td>
            <td><button type="button" class="btn-toggle-shelf ${p.enabled ? 'is-on' : 'is-off'}" data-act="toggle">${p.enabled ? '下架' : '上架'}</button></td>
          </tr>
        `).join('')}</tbody>
      </table>`;

    el.querySelectorAll('[data-act]').forEach((btn) => {
      btn.onclick = async () => {
        const row = btn.closest('tr');
        const id = row.dataset.id;
        if (btn.dataset.act === 'save') {
          const cost = Number(row.querySelector('[data-field="cost"]').value);
          if (!cost || cost < 0) return showToast('积分价无效');
          try {
            await api(`/api/admin/products/${id}`, {
              method: 'PATCH',
              body: JSON.stringify({ pointsRedeemCost: cost }),
            });
            showToast('已更新积分价');
            renderPointsMallGrid(targetId);
          } catch (e) { showToast(e.message); }
        } else {
          const p = items.find((x) => x.id === id);
          try {
            await api(`/api/admin/products/${id}`, {
              method: 'PATCH',
              body: JSON.stringify({ enabled: !p.enabled }),
            });
            showToast(p.enabled ? '已下架' : '已上架');
            renderPointsMallGrid(targetId);
          } catch (e) { showToast(e.message); }
        }
      };
    });
  } catch (e) {
    el.innerHTML = `<div class="res-item">加载失败：${esc(e.message || '')}</div>`;
  }
}

$('audit-query-btn')?.addEventListener('click', () => {
  auditFrom = $('audit-from').value || todayStr();
  auditTo = $('audit-to').value || auditFrom;
  loadAuditPage();
});

$('shift-open-btn')?.addEventListener('click', async () => {
  try {
    const res = await api('/api/admin/shift/open', {
      method: 'POST',
      body: JSON.stringify({ openingCashYuan: Number($('shift-opening-cash').value) || 0 }),
    });
    showToast(res.message);
    loadShiftPanel();
  } catch (e) { showToast(e.message); }
});

$('shift-close-btn')?.addEventListener('click', async () => {
  if (!confirm('确认交班？')) return;
  try {
    const res = await api('/api/admin/shift/close', {
      method: 'POST',
      body: JSON.stringify({ closingCashYuan: Number($('shift-closing-cash').value) || 0 }),
    });
    showToast(`${res.message} · 本班现金 ¥${res.cashSalesYuan}`);
    loadShiftPanel();
  } catch (e) { showToast(e.message); }
});

function showPurchaseModal() {
  const mask = $('purchase-mask');
  if (!mask) return;
  const sel = $('purchase-item');
  sel.innerHTML = inventoryData.map((i) => `<option value="${i.id}">${esc(i.name)}</option>`).join('');
  mask.classList.remove('hidden');
}

$('btn-purchase-ingredient')?.addEventListener('click', () => {
  if (adminRole !== 'owner') return showToast('采购入库需老板账号');
  if (!inventoryData.length) return showToast('请先添加原料');
  showPurchaseModal();
});
$('purchase-close')?.addEventListener('click', () => $('purchase-mask')?.classList.add('hidden'));
$('purchase-cancel')?.addEventListener('click', () => $('purchase-mask')?.classList.add('hidden'));
$('purchase-confirm')?.addEventListener('click', async () => {
  try {
    const res = await api('/api/admin/inventory/purchase', {
      method: 'POST',
      body: JSON.stringify({
        itemId: $('purchase-item').value,
        qty: Number($('purchase-qty').value),
        supplierName: $('purchase-supplier').value.trim(),
        note: $('purchase-note').value.trim(),
      }),
    });
    showToast(res.message);
    $('purchase-mask')?.classList.add('hidden');
    loadInventoryPage();
  } catch (e) { showToast(e.message); }
});

if (token()) {
  const name = localStorage.getItem('bar_admin_name');
  adminRole = localStorage.getItem('bar_admin_role') || 'staff';
  if (name) $('admin-name').textContent = `${name} · ${adminRole === 'owner' ? '老板' : '员工'}`;
  applyRoleNav();
  showApp();
} else showLogin();
