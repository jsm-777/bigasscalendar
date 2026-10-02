import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { useStore } from '../store.tsx';
import type { ISODate, Occurrence } from '../../shared/types.ts';
import { MONTH_NAMES, WEEKDAY_SHORT, addDays, daysInMonth, diffDays, formatLongDate, makeDate, weekday } from '../../shared/dates.ts';
import { moonQuarters, MOON_SYMBOL, type MoonQuarter } from '../../shared/moon.ts';
import { DRAG_MIME, hiddenCounts, layoutRow } from './layout.ts';
import { Chip } from './Chip.tsx';
import { useEventActions } from '../actions.tsx';

const MONTH_COL = 92;
const LANE_H = 17;

interface Props {
  occs: Occurrence[];
  /** Show the private monthly notes column (only for the signed-in user's own board). */
  showNotes: boolean;
  showPerson?: boolean;
  fit: boolean;
  notesOpen: boolean;
  label?: string;
}

export function YearBoard({ occs, showNotes, showPerson, fit, notesOpen, label }: Props) {
  const s = useStore();
  const actions = useEventActions();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const notesW = showNotes ? (notesOpen ? 168 : 30) : 0;
  // Fit mode divides the available width; it never goes below a legible minimum and scrolls instead.
  const dayW = fit ? Math.max(30, Math.floor((width - MONTH_COL - notesW - 2) / 31)) : 76;
  const maxLanes = fit ? 3 : 5;

  const showMoon = s.me.settings.showMoon !== false;
  const moon = useMemo(() => {
    const m = new Map<ISODate, MoonQuarter>();
    if (!showMoon) return m;
    try {
      for (const q of moonQuarters(s.range.from, s.range.to, s.tz)) m.set(q.localDate, q);
    } catch {
      /* calculation failure → no markers rather than invented data */
    }
    return m;
  }, [s.range.from, s.range.to, s.tz, showMoon]);

  const monthNotes = useMemo(() => new Map(s.data.notes.filter((n) => n.scope === 'month').map((n) => [n.key, n])), [s.data.notes]);

  const onDrop = (e: DragEvent, date: ISODate) => {
    const raw = e.dataTransfer.getData(DRAG_MIME);
    if (!raw) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).classList.remove('drop-target');
    const { key, grabOffset } = JSON.parse(raw) as { key: string; grabOffset: number };
    const occ = s.occurrences.find((o) => o.key === key) ?? s.allOccurrences.find((o) => o.key === key);
    if (!occ) return;
    const newStart = addDays(date, -grabOffset);
    void actions.moveDays(occ, diffDays(newStart, occ.startDate));
  };

  // Arrow-key navigation between day cells (roving focus follows the selected date).
  const onCellKey = (e: KeyboardEvent, date: ISODate) => {
    const [y, m, d] = date.split('-').map(Number);
    let next: ISODate | null = null;
    if (e.key === 'ArrowRight') next = addDays(date, 1);
    else if (e.key === 'ArrowLeft') next = addDays(date, -1);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const dm = e.key === 'ArrowDown' ? 1 : -1;
      const ny = m + dm > 12 ? y + 1 : m + dm < 1 ? y - 1 : y;
      const nm = ((m + dm + 11) % 12) + 1;
      next = makeDate(ny, nm, Math.min(d, daysInMonth(ny, nm)));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      s.setDialog({ type: 'event', defaults: { startDate: date } });
      return;
    }
    if (next) {
      e.preventDefault();
      s.setSelected(next);
      requestAnimationFrame(() => (document.querySelector(`[data-pane="${label ?? 'main'}"] [data-date="${next}"]`) as HTMLElement | null)?.focus());
    }
  };

  const gridCols = `${MONTH_COL}px repeat(31, ${dayW}px)${showNotes ? ` ${notesW}px` : ''}`;
  const rowH = 16 + maxLanes * LANE_H + 14;

  return (
    <div className="year-wrap" ref={wrapRef} data-pane={label ?? 'main'}>
      <div className="year-board" role="grid" aria-label={`Year board ${MONTH_NAMES[Number(s.range.months[0].slice(5)) - 1]} ${s.range.months[0].slice(0, 4)} to ${MONTH_NAMES[Number(s.range.months[11].slice(5)) - 1]} ${s.range.months[11].slice(0, 4)}${label ? `, ${label}` : ''}`} style={{ ['--day-w' as string]: `${dayW}px`, width: MONTH_COL + 31 * dayW + notesW }}>
        <div className="yb-head" role="row" style={{ gridTemplateColumns: gridCols }}>
          <div className="yb-corner" role="columnheader">{label ?? ''}</div>
          {Array.from({ length: 31 }, (_, i) => (
            <div key={i} className={`yb-daynum ${(i + 1) % 7 === 0 ? 'group-line' : ''}`} role="columnheader">{i + 1}</div>
          ))}
          {showNotes && <div className="yb-notes-head" role="columnheader">{notesOpen ? 'Notes' : '✎'}</div>}
        </div>
        {s.range.months.map((mk, rowIndex) => {
          const [y, m] = mk.split('-').map(Number);
          const dim = daysInMonth(y, m);
          const dates = Array.from({ length: dim }, (_, i) => makeDate(y, m, i + 1));
          const segs = layoutRow(occs, dates);
          const hidden = hiddenCounts(segs, dim, maxLanes);
          const note = monthNotes.get(mk);
          const quarterRow = rowIndex % 3 === 2;
          return (
            <div key={mk} className={`yb-row ${quarterRow ? 'quarter-end' : ''} ${m === 1 ? 'year-start' : ''}`} role="row" style={{ gridTemplateColumns: gridCols, gridTemplateRows: `16px repeat(${maxLanes}, ${LANE_H}px) 14px`, height: rowH }}>
              <div className="yb-month" role="rowheader" style={{ gridRow: '1 / -1' }}>
                <span className="yb-month-name">{MONTH_NAMES[m - 1]}</span>
                {(m === 1 || rowIndex === 0) && <span className="yb-year">{y}</span>}
              </div>
              {Array.from({ length: 31 }, (_, i) => {
                const day = i + 1;
                const col = i + 2;
                if (day > dim) {
                  return <div key={i} className="yb-cell invalid" style={{ gridColumn: col, gridRow: '1 / -1' }} aria-hidden="true" />;
                }
                const date = dates[i];
                const wd = weekday(date);
                const isToday = date === s.today;
                const isSel = date === s.selected;
                const q = moon.get(date);
                const count = segs.filter((sg) => sg.start <= i && sg.end >= i).length;
                return (
                  <div
                    key={i}
                    role="gridcell"
                    tabIndex={isSel ? 0 : -1}
                    data-date={date}
                    data-today={isToday || undefined}
                    aria-selected={isSel}
                    aria-label={`${formatLongDate(date)}${isToday ? ', today' : ''}${count ? `, ${count} event${count === 1 ? '' : 's'}` : ''}${q ? `, ${q.name} at ${q.localTime}` : ''}`}
                    className={`yb-cell ${wd >= 6 ? 'weekend' : ''} ${isToday ? 'today' : ''} ${isSel ? 'selected' : ''} ${wd === 7 ? 'week-end-line' : ''}`}
                    style={{ gridColumn: col, gridRow: '1 / -1' }}
                    onClick={() => s.setSelected(date)}
                    onDoubleClick={() => s.setDialog({ type: 'event', defaults: { startDate: date } })}
                    onKeyDown={(e) => onCellKey(e, date)}
                    onDragOver={(e) => {
                      if (e.dataTransfer.types.includes(DRAG_MIME)) {
                        e.preventDefault();
                        e.currentTarget.classList.add('drop-target');
                      }
                    }}
                    onDragLeave={(e) => e.currentTarget.classList.remove('drop-target')}
                    onDrop={(e) => onDrop(e, date)}
                  >
                    <span className="yb-wd">{WEEKDAY_SHORT[wd - 1].slice(0, 2)}</span>
                    {q && <span className={`yb-moon q${q.quarter}`} title={`${q.name} · ${q.localTime}`} aria-hidden>{MOON_SYMBOL[q.name]}</span>}
                  </div>
                );
              })}
              {segs.filter((sg) => sg.lane < maxLanes).map((sg) => (
                <Chip
                  key={sg.occ.key + mk}
                  occ={sg.occ}
                  compact
                  showPerson={showPerson}
                  continuesBefore={sg.continuesBefore}
                  continuesAfter={sg.continuesAfter}
                  spanDays={sg.end - sg.start + 1}
                  segmentStartDate={dates[sg.start]}
                  verticalStep={7}
                  style={{ gridColumn: `${sg.start + 2} / ${sg.end + 3}`, gridRow: sg.lane + 2 }}
                />
              ))}
              {hidden.map((n, i) => n > 0 && (
                <button key={`more${i}`} className="yb-more" style={{ gridColumn: i + 2, gridRow: maxLanes + 2 }} onClick={(e) => { e.stopPropagation(); s.setSelected(dates[i]); s.setDialog({ type: 'dayList', date: dates[i] }); }} aria-label={`${n} more on ${formatLongDate(dates[i])}`}>
                  +{n}
                </button>
              ))}
              {showNotes && (
                <button className={`yb-note ${notesOpen ? '' : 'collapsed'}`} style={{ gridColumn: 33, gridRow: '1 / -1' }} onClick={() => s.setDialog({ type: 'monthNotes', month: mk })} aria-label={`${MONTH_NAMES[m - 1]} notes${note?.body ? `: ${note.body.slice(0, 80)}` : ', empty'}`}>
                  {notesOpen ? (note?.body ? <span className="yb-note-text">{note.body}</span> : <span className="yb-note-empty">Add note</span>) : note?.body ? '•' : ''}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
