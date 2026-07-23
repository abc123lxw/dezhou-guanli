/** 全系统统一：数据库存 UTC，展示用北京时间 (Asia/Shanghai) */

export const CHINA_TZ = 'Asia/Shanghai';

/** SQLite datetime('now') 等为 UTC 无时区字符串 */
export function parseDbTime(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (/[zZ]$/.test(s)) return new Date(s);
  if (/[+-]\d{2}:?\d{2}$/.test(s)) return new Date(s);
  const d = new Date(`${s.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function partsFromInstant(instant) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: CHINA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const map = Object.fromEntries(fmt.formatToParts(instant).map((p) => [p.type, p.value]));
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour,
    minute: map.minute,
    second: map.second,
  };
}

export function formatChinaDateTime(value) {
  const d = parseDbTime(value);
  if (!d) return '';
  const p = partsFromInstant(d);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

export function formatChinaDateTimeShort(value) {
  const d = parseDbTime(value);
  if (!d) return '';
  const p = partsFromInstant(d);
  return `${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

export function formatChinaTime(value) {
  const d = parseDbTime(value);
  if (!d) return '';
  const p = partsFromInstant(d);
  return `${p.hour}:${p.minute}`;
}

export function formatChinaDateTimeCN(value) {
  const d = parseDbTime(value);
  if (!d) return '';
  const p = partsFromInstant(d);
  return `${Number(p.month)}月${Number(p.day)}日 ${p.hour}:${p.minute}`;
}

/** 当前北京时间日期 YYYY-MM-DD */
export function chinaTodayStr(instant = new Date()) {
  const p = partsFromInstant(instant);
  return `${p.year}-${p.month}-${p.day}`;
}

/** 当前北京时间完整字符串（写入数据库，仍存 UTC instant 对应的...）

   实际写入：统一用 UTC now，读取时转北京。此处提供展示用 now。 */
export function formatChinaNow() {
  return formatChinaDateTime(new Date().toISOString());
}

export function formatChinaClock(instant = new Date()) {
  const p = partsFromInstant(instant);
  return `${p.hour}:${p.minute}:${p.second}`;
}
