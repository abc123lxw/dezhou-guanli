/**
 * QA 扩展测试 — 预约/充值/赛事/边界场景
 */
const BASE = process.env.API_BASE || 'http://127.0.0.1:3001';
let passed = 0;
let failed = 0;
const issues = [];

function ok(name, detail = '') {
  passed++;
  console.log(`✓ ${name}${detail ? ` — ${detail}` : ''}`);
}
function fail(name, detail = '') {
  failed++;
  issues.push({ name, detail });
  console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
}

async function req(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  return { status: res.status, body, ok: res.ok };
}

async function loginUser(code) {
  const r = await req('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ code, nickname: 'QA测试' }),
  });
  return r.body;
}

async function main() {
  console.log('\n=== QA 扩展测试 ===\n');

  const admin = await req('/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'bar', password: 'dybar2026' }),
  });
  const AH = { Authorization: `Bearer ${admin.body.token}` };

  // ── 预约：同桌多座位 ──
  const u1 = await loginUser(`qa_multi_${Date.now()}`);
  const H1 = { Authorization: `Bearer ${u1.token}` };
  const b1 = await req('/api/reservations/seat', {
    method: 'POST', headers: H1,
    body: JSON.stringify({ tableId: 'table-1', seatNumber: 8 }),
  });
  const b2 = await req('/api/reservations/seat', {
    method: 'POST', headers: H1,
    body: JSON.stringify({ tableId: 'table-1', seatNumber: 9 }),
  });
  if (b1.ok && b2.status === 409) ok('同用户同时段第二座位应拦截', b2.body?.code || b2.body?.error);
  else fail('同用户同时段第二座位应拦截', `b1=${b1.status} b2=${b2.status}`);

  // ── 预约：改约 ──
  const b3 = await req('/api/reservations/seat', {
    method: 'POST', headers: H1,
    body: JSON.stringify({ tableId: 'table-2', seatNumber: 4, replaceExisting: true }),
  });
  if (b3.ok && b3.body?.message?.includes('改约')) ok('改约到2号桌');
  else fail('改约到2号桌', JSON.stringify(b3.body));

  // ── 预约：取消 ──
  const mine = await req('/api/reservations/mine?active=1', { headers: H1 });
  const rid = mine.body?.reservations?.[0]?.id;
  if (rid) {
    const cancel = await req(`/api/reservations/${rid}/cancel`, { method: 'POST', headers: H1 });
    if (cancel.ok) ok('取消预约');
    else fail('取消预约', JSON.stringify(cancel.body));
  } else fail('取消预约', '无活跃预约');

  // ── 预约：取消后可再约 ──
  let rebookOk = false;
  for (let seat = 1; seat <= 9; seat++) {
    const b4 = await req('/api/reservations/seat', {
      method: 'POST', headers: H1,
      body: JSON.stringify({ tableId: 'table-3', seatNumber: seat }),
    });
    if (b4.ok) { rebookOk = true; ok('取消后再预约', `3号桌${seat}号位`); break; }
  }
  if (!rebookOk) fail('取消后再预约', '无空位可测');

  // ── 桌位公开接口无需登录 ──
  const tables = await req('/api/reservations/tables');
  const floor = await req('/api/reservations/floor-overview');
  const status = await req('/api/reservations/table-status?tableId=table-1');
  if (tables.ok && floor.ok && status.ok && tables.body.tables?.length === 3) {
    ok('桌位公开接口', '3桌');
  } else fail('桌位公开接口');

  // ── 商品缓存/积分商城 ──
  const u2 = await loginUser(`qa_pts_${Date.now()}`);
  const H2 = { Authorization: `Bearer ${u2.token}` };
  const mall = await req('/api/points/mall', { headers: H2 });
  if (mall.ok && mall.body.products?.length > 0) ok('积分商城', `${mall.body.products.length} 商品`);
  else fail('积分商城');

  // ── 会员资料/邀请/社区 ──
  const profile = await req('/api/member/profile', { headers: H2 });
  const invite = await req('/api/member/invite', { headers: H2 });
  const community = await req('/api/member/community', { headers: H2 });
  const rules = await req('/api/member/game-rules', { headers: H2 });
  if (profile.ok && profile.body.user?.memberCode) ok('会员资料', profile.body.user.memberCode);
  else fail('会员资料');
  if (invite.ok && community.ok && rules.ok) ok('邀请/社区/规则接口');
  else fail('邀请/社区/规则接口');

  const sign1 = await req('/api/member/daily-sign', { method: 'POST', headers: H2 });
  const sign2 = await req('/api/member/daily-sign', { method: 'POST', headers: H2 });
  if (sign1.ok && sign2.status === 409) ok('每日签到/重复拦截');
  else fail('每日签到', `s1=${sign1.status} s2=${sign2.status}`);

  // ── 储值套餐 ──
  const pkgs = await req('/api/member/recharge-packages', { headers: H2 });
  if (pkgs.ok && pkgs.body.packages?.length > 0) ok('储值套餐', `${pkgs.body.packages.length} 个`);
  else fail('储值套餐', JSON.stringify(pkgs.body));

  // ── 赛事列表需登录 ──
  const tourNoAuth = await req('/api/tournament/events');
  if (tourNoAuth.status === 401) ok('赛事接口需登录');
  else fail('赛事接口应需登录', `status=${tourNoAuth.status}`);

  const tour = await req('/api/tournament/events?days=7', { headers: H2 });
  if (tour.ok && tour.body.events?.length === 7) ok('赛事7天列表');
  else fail('赛事7天列表');

  // ── 后台员工权限 ──
  const staff = await req('/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'staff', password: 'dybar2026' }),
  });
  const SH = { Authorization: `Bearer ${staff.body.token}` };
  const staffStats = await req('/api/admin/stats/today', { headers: SH });
  const staffAudit = await req('/api/admin/audit-logs', { headers: SH });
  if (staffStats.ok) ok('员工账号可看统计');
  else fail('员工账号可看统计');
  if (staffAudit.status === 403 || staffAudit.status === 401) ok('员工账号不可看审计');
  else fail('员工账号审计权限', `status=${staffAudit.status}`);

  // ── 核销错误码 ──
  const badRedeem = await req('/api/admin/redeem/verify', {
    method: 'POST', headers: AH,
    body: JSON.stringify({ pickupCode: '000000' }),
  });
  if (badRedeem.status === 404) ok('错误核销码返回404');
  else fail('错误核销码', `status=${badRedeem.status}`);

  // ── 空订单拦截 ──
  const emptyOrder = await req('/api/orders', {
    method: 'POST', headers: H2,
    body: JSON.stringify({ items: [] }),
  });
  if (emptyOrder.status === 400) ok('空订单拦截');
  else fail('空订单拦截', `status=${emptyOrder.status}`);

  console.log(`\n=== QA: ${passed} 通过 / ${failed} 失败 ===`);
  if (failed) {
    console.log('\n问题清单:');
    issues.forEach((i) => console.log(` - ${i.name}: ${i.detail}`));
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
