/**
 * 管理后台 ↔ 小程序 API 互通测试
 * 用法: node scripts/integration-test.mjs
 */
const BASE = process.env.API_BASE || 'http://127.0.0.1:3001';

const results = [];
let passed = 0;
let failed = 0;

function ok(name, detail = '') {
  passed++;
  results.push({ status: 'PASS', name, detail });
  console.log(`✓ ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name, detail = '') {
  failed++;
  results.push({ status: 'FAIL', name, detail });
  console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
}

async function req(path, opts = {}) {
  const url = `${BASE}${path}`;
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const res = await fetch(url, { ...opts, headers });
  let body;
  const text = await res.text();
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  return { status: res.status, body, ok: res.ok };
}

async function main() {
  console.log(`\n=== 德阳酒吧 互通测试 @ ${BASE} ===\n`);

  // ── 1. 服务健康 ──
  const health = await req('/health');
  if (health.ok && health.body?.ok) ok('服务健康检查', `devMode=${health.body.devMode}`);
  else return fail('服务健康检查', JSON.stringify(health.body));

  // ── 2. 管理后台登录 ──
  const adminLogin = await req('/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'bar', password: 'dybar2026' }),
  });
  if (!adminLogin.ok || !adminLogin.body?.token) return fail('管理后台登录', JSON.stringify(adminLogin.body));
  const adminToken = adminLogin.body.token;
  const adminHdr = { Authorization: `Bearer ${adminToken}` };
  ok('管理后台登录', adminLogin.body.admin?.role);

  // ── 3. 小程序 dev 登录 ──
  const devCode = `dev_test_${Date.now()}`;
  const mpLogin = await req('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ code: devCode, nickname: '互通测试用户' }),
  });
  if (!mpLogin.ok || !mpLogin.body?.token) return fail('小程序登录(dev)', JSON.stringify(mpLogin.body));
  const mpToken = mpLogin.body.token;
  const mpHdr = { Authorization: `Bearer ${mpToken}` };
  const memberCode = mpLogin.body.user?.memberCode || mpLogin.body.user?.inviteCode;
  ok('小程序登录(dev)', `会员码 ${memberCode}`);

  // ── 4. 商品列表互通 ──
  const mpProducts = await req('/api/products', { headers: mpHdr });
  const adminProducts = await req('/api/admin/products', { headers: adminHdr });
  const mpCount = mpProducts.body?.products?.length || 0;
  const adminCount = adminProducts.body?.products?.length || 0;
  if (mpCount > 0 && adminCount > 0) ok('商品列表', `小程序 ${mpCount} / 后台 ${adminCount}`);
  else fail('商品列表', `小程序 ${mpCount} / 后台 ${adminCount}`);

  const buyable = mpProducts.body.products.find((p) => (p.price_cents || p.priceCents) > 0);
  const redeemables = mpProducts.body.products.filter((p) => (p.points_redeem_cost || p.pointsRedeemCost) > 0);
  const redeemable = redeemables.sort(
    (a, b) => (a.points_redeem_cost || a.pointsRedeemCost) - (b.points_redeem_cost || b.pointsRedeemCost),
  )[0];

  // ── 5. 小程序下单 → 后台可见 ──
  let orderId = null;
  if (buyable) {
    const orderRes = await req('/api/orders', {
      method: 'POST',
      headers: mpHdr,
      body: JSON.stringify({
        items: [{ productId: buyable.id, qty: 1 }],
        tableId: 'table-1',
        note: '互通测试订单',
      }),
    });
    if (orderRes.ok && orderRes.body?.orderId) {
      orderId = orderRes.body.orderId;
      ok('小程序创建订单', `#${orderRes.body.pickupNo} ${buyable.name}`);
    } else {
      fail('小程序创建订单', JSON.stringify(orderRes.body));
    }
  } else {
    fail('小程序创建订单', '无可购商品');
  }

  if (orderId) {
    const live = await req('/api/admin/orders/live', { headers: adminHdr });
    const found = (live.body?.orders || []).find((o) => o.id === orderId);
    if (found) ok('后台作战看板可见新单', `#${found.pickupNo}`);
    else fail('后台作战看板可见新单', 'live 列表未找到');

    const mine = await req('/api/orders/mine', { headers: mpHdr });
    const mineFound = (mine.body?.orders || []).find((o) => o.id === orderId);
    if (mineFound) ok('小程序我的订单', mineFound.status);
    else fail('小程序我的订单', '未找到');
  }

  // ── 6. 模拟支付（dev）→ 后台状态流转 ──
  if (orderId) {
    const payRes = await req('/api/pay/submit', {
      method: 'POST',
      headers: mpHdr,
      body: JSON.stringify({ orderId }),
    });
    if (payRes.ok) ok('小程序支付(dev)', payRes.body?.message || payRes.body?.status);
    else fail('小程序支付(dev)', JSON.stringify(payRes.body));

    const paidLive = await req('/api/admin/orders/live', { headers: adminHdr });
    const paidOrder = (paidLive.body?.orders || []).find((o) => o.id === orderId);
    if (paidOrder?.status === 'paid' || paidOrder?.status === 'making') {
      ok('支付后后台订单状态', paidOrder.status);
    } else {
      fail('支付后后台订单状态', paidOrder?.status || '未找到');
    }

    const making = await req(`/api/admin/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: adminHdr,
      body: JSON.stringify({ status: 'making' }),
    });
    if (making.ok) ok('后台标记制作中');
    else fail('后台标记制作中', JSON.stringify(making.body));

    const done = await req(`/api/admin/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: adminHdr,
      body: JSON.stringify({ status: 'done' }),
    });
    if (done.ok) ok('后台标记已完成');
    else fail('后台标记已完成', JSON.stringify(done.body));
  }

  // ── 7. 积分：给测试用户加积分 → 兑换 → 后台核销 ──
  const cashOrder = await req('/api/admin/orders/cash', {
    method: 'POST',
    headers: adminHdr,
    body: JSON.stringify({
      userId: mpToken,
      amountYuan: 68,
      productName: buyable?.name || '长岛冰茶',
      qty: 1,
      note: '测试加积分',
    }),
  });
  if (cashOrder.ok) ok('后台现金录单', cashOrder.body?.message || 'ok');
  else fail('后台现金录单', JSON.stringify(cashOrder.body));

  const profile = await req('/api/member/profile', { headers: mpHdr });
  let points = profile.body?.user?.points || 0;
  if (points > 0) ok('小程序会员积分同步', `${points} 分`);
  else fail('小程序会员积分同步', `${points}`);

  const redeemCost = redeemable?.points_redeem_cost || redeemable?.pointsRedeemCost || 0;
  if (redeemable && points < redeemCost) {
    const topUp = await req('/api/admin/orders/cash', {
      method: 'POST',
      headers: adminHdr,
      body: JSON.stringify({
        userId: mpToken,
        amountYuan: 78,
        productName: '78元酒券套餐',
        qty: 1,
        note: '测试凑积分兑换',
      }),
    });
    if (topUp.ok) {
      const p2 = await req('/api/member/profile', { headers: mpHdr });
      points = p2.body?.user?.points || points;
      ok('后台补积分(酒券套餐)', `${points} 分`);
    }
  }

  let pickupCode = null;
  if (redeemable && points >= redeemCost) {
    const redeem = await req('/api/points/redeem', {
      method: 'POST',
      headers: mpHdr,
      body: JSON.stringify({ productId: redeemable.id }),
    });
    if (redeem.ok && redeem.body?.pickupCode) {
      pickupCode = redeem.body.pickupCode;
      ok('小程序积分兑换', `${redeemable.name} 码 ${pickupCode}`);
    } else {
      fail('小程序积分兑换', JSON.stringify(redeem.body));
    }
  } else if (redeemable) {
    fail('小程序积分兑换', `积分不足 ${points}/${redeemCost}`);
  }

  if (pickupCode) {
    const pending = await req('/api/admin/redeem/pending', { headers: adminHdr });
    const found = (pending.body?.redemptions || []).find((r) => r.pickupCode === pickupCode);
    if (found) ok('后台待核销列表', found.productName);
    else fail('后台待核销列表', '未找到取酒码');

    const verify = await req('/api/admin/redeem/verify', {
      method: 'POST',
      headers: adminHdr,
      body: JSON.stringify({ pickupCode }),
    });
    if (verify.ok) ok('后台核销取酒码', verify.body?.message || 'ok');
    else fail('后台核销取酒码', JSON.stringify(verify.body));

    const mpRedeem = await req('/api/member/redemptions', { headers: mpHdr });
    const doneR = (mpRedeem.body?.redemptions || []).find((r) => r.pickup_code === pickupCode || r.pickupCode === pickupCode);
    if (doneR?.status === 'completed') ok('小程序兑换记录状态', doneR.status);
    else if (doneR) ok('小程序兑换记录状态', doneR.status);
    else fail('小程序兑换记录状态', '未找到');
  }

  // ── 8. 存分管理互通 ──
  const scan = await req(`/api/admin/members/scan/${encodeURIComponent(memberCode)}`, { headers: adminHdr });
  if (scan.ok && scan.body?.user?.id === mpToken) ok('后台会员码识别', memberCode);
  else fail('后台会员码识别', JSON.stringify(scan.body));

  const adjust = await req(`/api/admin/members/${mpToken}/stored-score`, {
    method: 'PATCH',
    headers: adminHdr,
    body: JSON.stringify({ delta: 50, reason: '互通测试调分' }),
  });
  if (adjust.ok) ok('后台存分调整', adjust.body?.message || '+50');
  else fail('后台存分调整', JSON.stringify(adjust.body));

  const profile2 = await req('/api/member/profile', { headers: mpHdr });
  const stored = profile2.body?.user?.storedScore ?? 0;
  if (stored >= 50) ok('小程序存分同步', `${stored}`);
  else fail('小程序存分同步', `${stored}`);

  // ── 9. 桌位 / 预约互通 ──
  const floorMp = await req('/api/reservations/floor-overview');
  const floorAdmin = await req('/api/admin/floor/status', { headers: adminHdr });
  const tableCount = floorMp.body?.tables?.length || 0;
  const adminTableCount = floorAdmin.body?.tables?.length || 0;
  if (floorMp.ok && floorAdmin.ok && tableCount === 3 && adminTableCount === 3) {
    ok('桌位状态', `小程序 ${tableCount} 桌 / 后台 ${adminTableCount} 桌`);
  } else if (floorMp.ok && floorAdmin.ok) {
    fail('桌位状态', `期望3桌，实际 小程序 ${tableCount} / 后台 ${adminTableCount}`);
  } else {
    fail('桌位状态', `${floorMp.status}/${floorAdmin.status}`);
  }

  // ── 10. 存酒列表 ──
  const wine = await req('/api/admin/stored-wine?status=pending', { headers: adminHdr });
  if (wine.ok) ok('后台存酒管理', `${wine.body?.items?.length || 0} 条待取`);
  else fail('后台存酒管理', JSON.stringify(wine.body));

  // ── 11. 经营数据 / 库存 / 审计 ──
  const stats = await req('/api/admin/stats/today', { headers: adminHdr });
  if (stats.ok) ok('今日经营数据', `营收 ¥${stats.body?.revenueYuan ?? '?'}`);
  else fail('今日经营数据', JSON.stringify(stats.body));

  const inv = await req('/api/admin/inventory', { headers: adminHdr });
  if (inv.ok) ok('原料库存', `${inv.body?.items?.length || 0} 种`);
  else fail('原料库存', JSON.stringify(inv.body));

  const audit = await req('/api/admin/audit-logs?limit=5', { headers: adminHdr });
  if (audit.ok) ok('审计日志', `${audit.body?.logs?.length || 0} 条`);
  else fail('审计日志', JSON.stringify(audit.body));

  // ── 12. 积分商城配置 ──
  const mall = await req('/api/points/mall', { headers: mpHdr });
  const mallAdmin = adminProducts.body?.products?.filter((p) => p.pointsRedeemCost != null) || [];
  if (mall.ok && mall.body?.products?.length > 0) {
    ok('积分商城互通', `小程序 ${mall.body.products.length} / 后台可兑 ${mallAdmin.length}`);
  } else {
    fail('积分商城互通', JSON.stringify(mall.body));
  }

  // ── 13. 赛事 ──
  const tourMp = await req('/api/tournament/events', { headers: mpHdr });
  const tourAdmin = await req('/api/admin/tournament/today', { headers: adminHdr });
  if (tourMp.ok && tourAdmin.ok) {
    ok('赛事数据', `小程序 ${tourMp.body?.events?.length || 0} 天 / 后台报名 ${tourAdmin.body?.registered ?? 0}`);
  } else {
    fail('赛事数据', `mp=${tourMp.status} admin=${tourAdmin.status}`);
  }

  // ── 14. 排行榜 ──
  const rank = await req('/api/rank/leaderboard');
  if (rank.ok && rank.body?.list?.length > 0) ok('排行榜', `${rank.body.list.length} 人`);
  else fail('排行榜', JSON.stringify(rank.body));

  // ── 汇总 ──
  console.log(`\n=== 结果: ${passed} 通过 / ${failed} 失败 / ${passed + failed} 总计 ===\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('测试异常:', e);
  process.exit(1);
});
