/** 订单时间展示（北京时间） */

import {
  formatChinaDateTime,
  formatChinaDateTimeCN,
  formatChinaDateTimeShort,
  formatChinaTime,
  parseDbTime,
} from './chinaTime.js';

export { parseDbTime as parseSqliteDate };

export const formatDateTime = formatChinaDateTime;
export const formatDateTimeShort = formatChinaDateTimeShort;
export const formatTime = formatChinaTime;

export function formatWaitDuration(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}小时${m % 60}分`;
  }
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

export function buildOrderTimeline(order) {
  const defs = [
    { key: 'created', label: '下单', at: order.created_at },
    { key: 'paid', label: '支付', at: order.paid_at },
    { key: 'making', label: '制作', at: order.making_at },
    { key: 'done', label: '完成', at: order.done_at },
  ];
  return defs.map((step) => ({
    ...step,
    time: formatTime(step.at),
    dateTime: formatDateTimeShort(step.at),
    done: !!step.at,
  }));
}

export function buildTimeSummary(order) {
  const parts = [];
  if (order.created_at) parts.push(`下单 ${formatTime(order.created_at)}`);
  if (order.paid_at) parts.push(`支付 ${formatTime(order.paid_at)}`);
  if (order.making_at) parts.push(`制作 ${formatTime(order.making_at)}`);
  if (order.done_at) parts.push(`完成 ${formatTime(order.done_at)}`);
  return parts.join(' · ');
}

export { formatChinaDateTimeCN };
