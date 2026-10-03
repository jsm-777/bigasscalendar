import { MONTH_NAMES, WEEKDAY_SHORT, diffDays, weekday } from '../../shared/dates.ts';
import type { ISODate } from '../../shared/types.ts';

export const WEEKDAY_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export const monthShort = (d: ISODate) => MONTH_NAMES[Number(d.slice(5, 7)) - 1].slice(0, 3);
export const dayNum = (d: ISODate) => Number(d.slice(8, 10));
export const shortDate = (d: ISODate) => `${monthShort(d)} ${dayNum(d)}`;
export const weekdayShort = (d: ISODate) => WEEKDAY_SHORT[weekday(d) - 1];
export const weekdayLong = (d: ISODate) => WEEKDAY_LONG[weekday(d) - 1];

/** "6:30" + "am" pieces for big time labels. */
export function timeParts(local: string): [string, string] {
  const [h, m] = local.slice(11, 16).split(':').map(Number);
  return [`${h % 12 === 0 ? 12 : h % 12}${m ? `:${String(m).padStart(2, '0')}` : ''}`, h < 12 ? 'am' : 'pm'];
}
export const time12 = (local: string) => timeParts(local).join('');

export function relativeDay(d: ISODate, today: ISODate): string {
  const n = diffDays(d, today);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  return n > 0 ? `In ${n} days` : `${-n} days ago`;
}

export function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Readable text color (ink or white) on a background color. */
export function onColor(hex: string): string {
  const m = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m.length === 3 ? m[i / 2] + m[i / 2] : m.slice(i, i + 2), 16) / 255);
  const lum = [r, g, b].map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const L = 0.2126 * lum[0] + 0.7152 * lum[1] + 0.0722 * lum[2];
  return L > 0.45 ? '#16131c' : '#ffffff';
}
