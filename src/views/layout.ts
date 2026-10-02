import type { ISODate, Occurrence } from '../../shared/types.ts';

export interface Segment {
  occ: Occurrence;
  /** First and last visible column (inclusive) within the row. */
  start: number;
  end: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
  lane: number;
}

/**
 * Clip occurrences to a row of consecutive dates and assign lanes so segments never overlap.
 * `dates[i]` is the date of column i.
 */
export function layoutRow(occs: Occurrence[], dates: ISODate[]): Segment[] {
  const first = dates[0];
  const last = dates[dates.length - 1];
  const index = new Map(dates.map((d, i) => [d, i]));
  const segs: Segment[] = [];
  for (const occ of occs) {
    if (occ.endDate < first || occ.startDate > last) continue;
    const s = occ.startDate < first ? first : occ.startDate;
    const e = occ.endDate > last ? last : occ.endDate;
    segs.push({
      occ,
      start: index.get(s)!,
      end: index.get(e)!,
      continuesBefore: occ.startDate < first,
      continuesAfter: occ.endDate > last,
      lane: 0,
    });
  }
  // Longer spans first, then earlier starts, all-day before timed, then by time.
  segs.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start) || Number(b.occ.allDay) - Number(a.occ.allDay) || (a.occ.startLocal ?? '').localeCompare(b.occ.startLocal ?? ''));
  const laneEnds: number[] = [];
  for (const seg of segs) {
    let lane = laneEnds.findIndex((end) => end < seg.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(seg.end);
    } else laneEnds[lane] = seg.end;
    seg.lane = lane;
  }
  return segs;
}

/** Count of segments per column hidden beyond `maxLanes`. */
export function hiddenCounts(segs: Segment[], columns: number, maxLanes: number): number[] {
  const counts = new Array(columns).fill(0);
  for (const s of segs) {
    if (s.lane < maxLanes) continue;
    for (let c = s.start; c <= s.end; c++) counts[c]++;
  }
  return counts;
}

export const DRAG_MIME = 'application/x-bac-occurrence';
export const TASK_MIME = 'application/x-bac-task';
