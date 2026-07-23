/** 周末赛入场商品（唯一 SKU） */
export const WEEKEND_ENTRY_PRODUCT_NAME = '78元酒券套餐';
export const WEEKEND_ENTRY_CATEGORY = '酒券套餐';

/** 中国时区当前日期 */
export function getChinaDate(date = new Date()) {
  const utc = date.getTime() + date.getTimezoneOffset() * 60000;
  return new Date(utc + 8 * 3600000);
}

export function isWeekend(date = new Date()) {
  const day = getChinaDate(date).getDay();
  return day === 0 || day === 6;
}

/**
 * 周末订单校验
 * - tournamentEntry=true：购物车只能含 78元酒券套餐
 * - 普通订单：若含酒券套餐类商品，也只能是 78元酒券套餐
 */
export function validateWeekendOrder(lineItems, { tournamentEntry = false } = {}) {
  if (!lineItems?.length) return '订单为空';

  const names = lineItems.map(({ product }) => product.name);
  const categories = lineItems.map(({ product }) => product.category);

  if (tournamentEntry) {
    const invalid = lineItems.filter(({ product }) => product.name !== WEEKEND_ENTRY_PRODUCT_NAME);
    if (invalid.length) {
      return `周末赛入场仅可购买「${WEEKEND_ENTRY_PRODUCT_NAME}」，不可添加其他商品`;
    }
    return null;
  }

  const hasWineCoupon = categories.some((c) => c === WEEKEND_ENTRY_CATEGORY);
  if (hasWineCoupon) {
    const bad = lineItems.filter(
      ({ product }) => product.category === WEEKEND_ENTRY_CATEGORY
        && product.name !== WEEKEND_ENTRY_PRODUCT_NAME,
    );
    if (bad.length) {
      return `周末仅可使用「${WEEKEND_ENTRY_PRODUCT_NAME}」作为赛事实物套餐`;
    }
  }

  return null;
}

export const GAME_RULES_SUMMARY = {
  threeTypes: [
    { name: '会员积分', desc: '买酒赠送，用于商城兑换、周中存分' },
    { name: '存分余额', desc: '仅周中可用，会员积分按 10% 存入' },
    { name: '比赛记分', desc: '当晚桌上筹码，无现金价值，周末赛结束清零' },
  ],
  weekend: {
    blinds: '盲注 10/20 起，每 1.5 小时涨盲',
    entry: '¥78 = 特调鸡尾酒 1 杯 + 3000 比赛记分（唯一入场）',
    rebuy: '再买 ¥78 = 再得 3000 分，次数不限，须当场购买',
    noCarryIn: true,
    noEarlyBird: true,
    top3Only: true,
  },
  weekday: {
    storeRate: '10%',
    carryIn: '存分余额可全部带入',
    redeem: '积分可兑换酒水寄店',
  },
  compliance: [
    '积分不可提现、不可转让、不可回购',
    '比赛记分无现金价值，散场作废',
    '奖品限店内酒水、餐食、低价值纪念品',
    '储值余额用于店内消费，非参赛筹码',
  ],
};
