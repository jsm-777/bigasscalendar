import type { DragEvent } from 'react';
import { useStore } from '../store.tsx';
import type { ISODate, Occurrence } from '../../shared/types.ts';
import { MONTH_NAMES, WEEKDAY_SHORT, addDays, diffDays, formatLongDate, startOfMonth, startOfWeek, weekday } from '../../shared/dates.ts';
import { DRAG_MIME, hiddenCounts, layoutRow } from './layout.ts';
import { Chip } from './Chip.tsx';
import { useEventActions } from '../actions.tsx';
import { moonQuarters, MOON_SYMBOL } from '../../shared/moon.ts';
import { useIsPhone } from '../hooks.ts';

const LANES = 4;

export function MonthView({ occs, showPerson, label }: { occs: Occurrence[]; showPerson?: boolean; label?: string }) {
  const s = useStore();
  const actions = useEventActions();
  const phone = useIsPhone();
  const weekStart = s.me.settings.weekStartsOn ?? 7;
  const first = startOfMonth(s.selected);
  const gridStart = startOfWeek(first, weekStart);
  const weeks = Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(gridStart, w * 7 + d)));
  const month = Number(first.slice(5, 7));
  const showMoon = s.me.settings.showMoon !== false;
  const moon = new Map(showMoon ? moonQuarters(gridStart, addDays(gridStart, 41), s.tz).map((q) => [q.localDate, q]) : []);

  const onDrop = (e: DragEvent, date: ISODate) => {
    const raw = e.dataTransfer.getData(DRAG_MIME);
    if (!raw) return;
    e.preventDefault();
    const { key, grabOffset } = JSON.parse(raw) as { key: string; grabOffset: number };
    const occ = s.allOccurrences.find((o) => o.key === key);
    if (occ) void actions.moveDays(occ, diffDays(addDays(date, -grabOffset), occ.startDate));
  };

  return (
    <div className="month-view" data-pane={label ?? 'main'}>
      <h2 className="view-title">{MONTH_NAMES[month - 1]} {first.slice(0, 4)}{label ? ` · ${label}` : ''}</h2>
      <div className="mv-head">
        {weeks[0].map((d) => <div key={d}>{WEEKDAY_SHORT[weekday(d) - 1]}</div>)}
      </div>
      {weeks.map((days) => {
        const segs = layoutRow(occs, days);
        const hidden = hiddenCounts(segs, 7, LANES);
        return (
          <div key={days[0]} className="mv-week" style={{ gridTemplateRows: `22px repeat(${LANES}, 19px) 16px` }}>
            {days.map((d, i) => {
              const q = moon.get(d);
              return (
                <div
                  key={d}
                  className={`mv-cell ${d.slice(5, 7) !== first.slice(5, 7) ? 'other' : ''} ${weekday(d) >= 6 ? 'weekend' : ''} ${d === s.today ? 'today' : ''} ${d === s.selected ? 'selected' : ''}`}
                  style={{ gridColumn: i + 1, gridRow: '1 / -1' }}
                  data-date={d}
                  data-today={d === s.today || undefined}
                  role="gridcell"
                  tabIndex={d === s.selected ? 0 : -1}
                  aria-label={formatLongDate(d)}
                  onClick={() => {
                    s.setSelected(d);
                    if (phone) s.showDayPanel();
                  }}
                  onDoubleClick={() => s.setDialog({ type: 'event', defaults: { startDate: d } })}
                  onKeyDown={(e) => e.key === 'Enter' && s.setDialog({ type: 'event', defaults: { startDate: d } })}
                  onDragOver={(e) => e.dataTransfer.types.includes(DRAG_MIME) && e.preventDefault()}
                  onDrop={(e) => onDrop(e, d)}
                >
                  <span className="mv-num">{Number(d.slice(8))}</span>
                  {q && <span className="mv-moon" title={`${q.name} · ${q.localTime}`}>{MOON_SYMBOL[q.name]}<span className="sr-only">{q.name}</span></span>}
                </div>
              );
            })}
            {segs.filter((sg) => sg.lane < LANES).map((sg) => (
              <Chip key={sg.occ.key} occ={sg.occ} narrow={phone && sg.end === sg.start} showPerson={showPerson} continuesBefore={sg.continuesBefore} continuesAfter={sg.continuesAfter} segmentStartDate={days[sg.start]} spanDays={sg.end - sg.start + 1} style={{ gridColumn: `${sg.start + 1} / ${sg.end + 2}`, gridRow: sg.lane + 2 }} />
            ))}
            {hidden.map((n, i) => n > 0 && (
              <button key={i} className="mv-more" style={{ gridColumn: i + 1, gridRow: LANES + 2 }} onClick={() => { s.setSelected(days[i]); s.setDialog({ type: 'dayList', date: days[i] }); }}>
                +{n}<span className="mv-more-word"> more</span>
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}
