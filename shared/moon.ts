import * as Astronomy from 'astronomy-engine';
import { DateTime } from 'luxon';
import type { ISODate } from './types.ts';

// Lunar phases are computed locally with astronomy-engine (MIT, based on VSOP87/NOVAS
// models; quarter instants accurate to within a few minutes). Instants are UTC and only
// converted to a local date/time for display.

export type QuarterName = 'New moon' | 'First quarter' | 'Full moon' | 'Last quarter';
const QUARTERS: QuarterName[] = ['New moon', 'First quarter', 'Full moon', 'Last quarter'];

export interface MoonQuarter {
  name: QuarterName;
  quarter: 0 | 1 | 2 | 3;
  /** UTC instant (ISO string). */
  instant: string;
  /** Local date in the requested zone. */
  localDate: ISODate;
  localTime: string; // HH:mm
}

export function moonQuarters(from: ISODate, to: ISODate, tz: string): MoonQuarter[] {
  // Search from a day earlier in UTC so local dates at the edges are not missed.
  const start = DateTime.fromISO(from, { zone: tz }).minus({ days: 1 }).toJSDate();
  const end = DateTime.fromISO(to, { zone: tz }).plus({ days: 2 }).toJSDate();
  const out: MoonQuarter[] = [];
  let mq = Astronomy.SearchMoonQuarter(start);
  for (let i = 0; i < 200 && mq.time.date < end; i++) {
    const local = DateTime.fromJSDate(mq.time.date).setZone(tz);
    const d = local.toISODate()!;
    if (d >= from && d <= to) {
      out.push({
        name: QUARTERS[mq.quarter],
        quarter: mq.quarter as MoonQuarter['quarter'],
        instant: mq.time.date.toISOString(),
        localDate: d,
        localTime: local.toFormat('HH:mm'),
      });
    }
    mq = Astronomy.NextMoonQuarter(mq);
  }
  return out;
}

export type PhaseName =
  | 'New moon' | 'Waxing crescent' | 'First quarter' | 'Waxing gibbous'
  | 'Full moon' | 'Waning gibbous' | 'Last quarter' | 'Waning crescent';

export interface MoonInfo {
  /** Phase angle in degrees, 0 = new, 180 = full. */
  angle: number;
  /** Illuminated fraction 0–1. */
  illumination: number;
  phase: PhaseName;
  /** Quarter instant falling on this local date, if any. */
  quarterToday: MoonQuarter | null;
  nextQuarter: MoonQuarter;
}

/** Moon details for a local date, evaluated at local noon. */
export function moonForDate(date: ISODate, tz: string): MoonInfo {
  const noon = DateTime.fromISO(`${date}T12:00`, { zone: tz }).toJSDate();
  const angle = Astronomy.MoonPhase(noon);
  const illum = Astronomy.Illumination(Astronomy.Body.Moon, noon).phase_fraction;
  const quarterToday = moonQuarters(date, date, tz)[0] ?? null;
  let phase: PhaseName;
  if (quarterToday) phase = quarterToday.name;
  else if (angle < 90) phase = 'Waxing crescent';
  else if (angle < 180) phase = 'Waxing gibbous';
  else if (angle < 270) phase = 'Waning gibbous';
  else phase = 'Waning crescent';
  const nextMq = Astronomy.SearchMoonQuarter(DateTime.fromISO(date, { zone: tz }).plus({ days: 1 }).toJSDate());
  const nl = DateTime.fromJSDate(nextMq.time.date).setZone(tz);
  return {
    angle,
    illumination: illum,
    phase,
    quarterToday,
    nextQuarter: {
      name: QUARTERS[nextMq.quarter],
      quarter: nextMq.quarter as MoonQuarter['quarter'],
      instant: nextMq.time.date.toISOString(),
      localDate: nl.toISODate()!,
      localTime: nl.toFormat('HH:mm'),
    },
  };
}

export const MOON_SYMBOL: Record<QuarterName, string> = {
  'New moon': '●',
  'First quarter': '◐',
  'Full moon': '○',
  'Last quarter': '◑',
};

// Reflection prompts are original writing, offered as optional journaling cues. They are a
// reflective interpretation only — the moon does not determine mood, health or outcomes.
export const REFLECTIONS: Record<PhaseName, string> = {
  'New moon': 'A blank page. What is one thing you would like to begin this cycle?',
  'Waxing crescent': 'What small step would keep a new intention moving today?',
  'First quarter': 'Where did you meet resistance this week, and what would make it easier?',
  'Waxing gibbous': 'What could you refine or adjust before it is finished?',
  'Full moon': 'What has come together lately? Notice what you are proud of.',
  'Waning gibbous': 'What did you learn recently that is worth writing down?',
  'Last quarter': 'What could you set down or simplify to make room?',
  'Waning crescent': 'Where could you rest, tidy up, or close a loop before the next start?',
};
