export const LEVELS = [
  { level: 1, name: 'V1 普通会员', min: 0, max: 499 },
  { level: 2, name: 'V2 银卡会员', min: 500, max: 1999 },
  { level: 3, name: 'V3 金卡会员', min: 2000, max: Infinity },
];

export function calcLevel(growthValue) {
  const g = Number(growthValue) || 0;
  const current = [...LEVELS].reverse().find((l) => g >= l.min) || LEVELS[0];
  const next = LEVELS.find((l) => l.min > g);
  return {
    level: current.level,
    levelName: current.name,
    growthValue: g,
    nextLevelName: next?.name || null,
    nextLevelMin: next?.min || null,
    toNext: next ? next.min - g : 0,
  };
}

export function genInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export function maskNickname(name) {
  if (!name || name.length <= 1) return '酒***';
  return `${name[0]}***${name[name.length - 1]}`;
}
