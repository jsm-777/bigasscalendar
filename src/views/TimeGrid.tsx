import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { useStore, canEdit } from '../store.tsx';
import type { ISODate, Occurrence } from '../../shared/types.ts';
import { WEEKDAY_SHORT, addDays, addWallMinutes, formatTime12, hhmm, localTime, minutesOfDay, nowLocal, weekday, formatLongDate } from '../../shared/dates.ts';
import { layoutRow, TASK_MIME } from './layout.ts';
import { Chip } from './Chip.tsx';
import { useEventActions } from '../actions.tsx';

const HOUR_H = 48;
const SNAP = 15;

interface Placed {
  occ: Occurrence;
  day: number; // column index
  top: number; // minutes from midnight
  bottom: number;
  col: number;
  cols: number;
  startsBefore: boolean;
  endsAfter: boolean;
}

/** Split timed occurrences into per-day pieces and assign side-by-side columns for overlaps. */
function place(occs: Occurrence[], days: ISODate[]): Placed[] {
  const out: Placed[] = [];
  days.forEach((d, di) => {
    const pieces: Placed[] = [];
    for (const o of occs) {
      if (o.allDay || !o.startLocal || !o.endLocal) continue;
      if (o.startDate > d || o.endDate < d) continue;
      const top = o.startDate < d ? 0 : minutesOfDay(localTime(o.startLocal));
      const bottom = o.endDate > d ? 1440 : Math.max(top + 15, minutesOfDay(localTime(o.endLocal)));
      if (o.endDate > d && o.startDate === d && top === 1440) continue;
      if (o.endDate === d && o.startDate < d && minutesOfDay(localTime(o.endLocal)) === 0) continue;
      pieces.push({ occ: o, day: di, top, bottom, col: 0, cols: 1, startsBefore: o.startDate < d, endsAfter: o.endDate > d });
    }
    pieces.sort((a, b) => a.top - b.top || b.bottom - a.bottom);
    let cluster: Placed[] = [];
    let clusterEnd = -1;
    const flush = () => {
      const colEnds: number[] = [];
      for (const p of cluster) {
        let c = colEnds.findIndex((e) => e <= p.top);
        if (c === -1) { c = colEnds.length; colEnds.push(p.bottom); } else colEnds[c] = p.bottom;
        p.col = c;
      }
      for (const p of cluster) p.cols = colEnds.length;
      out.push(...cluster);
      cluster = [];
    };
    for (const p of pieces) {
      if (p.top >= clusterEnd && cluster.length) flush();
      cluster.push(p);
      clusterEnd = Math.max(clusterEnd, p.bottom);
    }
    flush();
  });
  return out;
}

interface Drag {
  key: string;
  mode: 'move' | 'resize';
  startX: number;
  startY: number;
  dayDelta: number;
  minDelta: number;
  moved: boolean;
}

export function TimeGrid({ days, occs, showPerson, label }: { days: ISODate[]; occs: Occurrence[]; showPerson?: boolean; label?: string }) {
  const s = useStore();
  const actions = useEventActions();
  const bodyRef = useRef<HTMLDivElement>(null);
  const colsRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [create, setCreate] = useState<{ day: number; from: number; to: number } | null>(null);
  const [now, setNow] = useState(() => nowLocal(s.tz));

  useEffect(() => {
    const t = setInterval(() => setNow(nowLocal(s.tz)), 60_000);
    return () => clearInterval(t);
  }, [s.tz]);

  useEffect(() => {
    // Start scrolled to the morning (or just before the current time on today).
    const el = bodyRef.current;
    if (!el) return;
    const showsToday = days.includes(s.today);
    // Otherwise start at 7am, or earlier if a visible event starts earlier.
    const earliest = Math.min(7 * 60, ...occs.filter((o) => !o.allDay && o.startLocal && days.includes(o.startDate)).map((o) => minutesOfDay(localTime(o.startLocal!)) - 30));
    const m = showsToday ? Math.max(0, minutesOfDay(localTime(nowLocal(s.tz))) - 120) : Math.max(0, earliest);
    el.scrollTop = (m / 60) * HOUR_H;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days[0], days.length]);

  const allDaySegs = layoutRow(occs.filter((o) => o.allDay), days);
  const lanes = Math.max(1, ...allDaySegs.map((sg) => sg.lane + 1));
  const placed = place(occs, days);

  const colWidth = () => (colsRef.current ? colsRef.current.getBoundingClientRect().width / days.length : 100);
  const minutesAt = (clientY: number) => {
    const rect = colsRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1439, Math.floor(((clientY - rect.top) / HOUR_H) * 60)));
  };
  const snap = (m: number) => Math.round(m / SNAP) * SNAP;

  const onEventPointerDown = (e: RPointerEvent, p: Placed, mode: 'move' | 'resize') => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const cal = s.calendarsById.get(p.occ.calendarId);
    if (!canEdit(cal) || p.occ.redacted) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ key: p.occ.key, mode, startX: e.clientX, startY: e.clientY, dayDelta: 0, minDelta: 0, moved: false });
  };

  const onPointerMove = (e: RPointerEvent) => {
    if (drag) {
      const minDelta = snap(((e.clientY - drag.startY) / HOUR_H) * 60);
      const dayDelta = drag.mode === 'move' ? Math.round((e.clientX - drag.startX) / colWidth()) : 0;
      const moved = drag.moved || Math.abs(e.clientY - drag.startY) > 4 || Math.abs(e.clientX - drag.startX) > 4;
      if (minDelta !== drag.minDelta || dayDelta !== drag.dayDelta || moved !== drag.moved) setDrag({ ...drag, minDelta, dayDelta, moved });
    } else if (create) {
      setCreate({ ...create, to: snap(minutesAt(e.clientY)) });
    }
  };

  const onPointerUp = async (e: RPointerEvent) => {
    if (drag) {
      const occ = occs.find((o) => o.key === drag.key);
      const d = drag;
      setDrag(null);
      if (!occ) return;
      if (!d.moved) {
        const ev = s.data.events.find((x) => x.id === occ.eventId);
        if (ev) s.setDialog({ type: 'event', event: ev, occurrence: occ });
        return;
      }
      if (d.mode === 'move' && (d.minDelta || d.dayDelta)) {
        const start = addWallMinutes(`${addDays(occ.startDate, d.dayDelta)}T${localTime(occ.startLocal!)}`, d.minDelta);
        await actions.moveTo(occ, start);
      } else if (d.mode === 'resize' && d.minDelta) {
        const end = addWallMinutes(occ.endLocal!, d.minDelta);
        if (end > addWallMinutes(occ.startLocal!, 14)) await actions.resizeTo(occ, end);
      }
      return;
    }
    if (create) {
      const c = create;
      setCreate(null);
      const from = Math.min(c.from, c.to);
      let to = Math.max(c.from, c.to);
      if (to - from < SNAP) to = from + 60;
      const date = days[c.day];
      s.setSelected(date);
      s.setDialog({ type: 'event', defaults: { startDate: date, endDate: date, allDay: false, startLocal: `${date}T${hhmm(from)}`, endLocal: addWallMinutes(`${date}T00:00`, Math.min(to, 1440)) } });
      e.preventDefault();
    }
  };

  const onColumnPointerDown = (e: RPointerEvent, dayIndex: number) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.tg-event')) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const m = snap(minutesAt(e.clientY));
    setCreate({ day: dayIndex, from: m, to: m + 60 });
  };

  const onTaskDrop = (e: React.DragEvent, dayIndex: number) => {
    const raw = e.dataTransfer.getData(TASK_MIME);
    if (!raw) return;
    e.preventDefault();
    const task = s.data.tasks.find((t) => t.id === raw);
    if (!task) return;
    const m = snap(minutesAt(e.clientY));
    void actions.scheduleTask(task, `${days[dayIndex]}T${hhmm(Math.min(m, 1380))}`);
  };

  const nowDate = now.slice(0, 10);
  const nowMin = minutesOfDay(localTime(now));

  return (
    <div className="time-grid" data-pane={label ?? 'main'} style={{ ['--days' as string]: days.length }}>
      {label && <div className="tg-label">{label}</div>}
      <div className="tg-head">
        <div className="tg-gutter" />
        {days.map((d) => (
          <button key={d} className={`tg-dayhead ${d === s.today ? 'today' : ''} ${d === s.selected ? 'selected' : ''}`} onClick={() => s.setSelected(d)} aria-label={formatLongDate(d)}>
            <span className="tg-wd">{WEEKDAY_SHORT[weekday(d) - 1]}</span>
            <span className="tg-dn">{Number(d.slice(8))}</span>
          </button>
        ))}
      </div>
      <div className="tg-allday" style={{ gridTemplateRows: `repeat(${lanes}, 20px)` }}>
        <div className="tg-gutter small" style={{ gridRow: `1 / -1` }}>all-day</div>
        {days.map((d, i) => (
          <div key={d} className="tg-allday-cell" style={{ gridColumn: i + 2, gridRow: '1 / -1' }} onDoubleClick={() => s.setDialog({ type: 'event', defaults: { startDate: d, allDay: true } })} />
        ))}
        {allDaySegs.map((sg) => (
          <Chip key={sg.occ.key} occ={sg.occ} showPerson={showPerson} continuesBefore={sg.continuesBefore} continuesAfter={sg.continuesAfter} segmentStartDate={days[sg.start]} spanDays={sg.end - sg.start + 1} verticalStep={days.length === 1 ? 1 : 7} style={{ gridColumn: `${sg.start + 2} / ${sg.end + 3}`, gridRow: sg.lane + 1 }} />
        ))}
      </div>
      <div className="tg-body" ref={bodyRef} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => { setDrag(null); setCreate(null); }}>
        <div className="tg-hours">
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="tg-hour" style={{ height: HOUR_H }}><span>{h === 0 ? '' : formatTime12(hhmm(h * 60))}</span></div>
          ))}
        </div>
        <div className="tg-cols" ref={colsRef} style={{ height: HOUR_H * 24 }}>
          {days.map((d, di) => (
            <div
              key={d}
              className={`tg-col ${weekday(d) >= 6 ? 'weekend' : ''}`}
              onPointerDown={(e) => onColumnPointerDown(e, di)}
              onDragOver={(e) => e.dataTransfer.types.includes(TASK_MIME) && e.preventDefault()}
              onDrop={(e) => onTaskDrop(e, di)}
              aria-label={`${formatLongDate(d)} time grid. Drag to create an event, or drop a task to schedule it.`}
            >
              {d === nowDate && <div className="tg-now" style={{ top: (nowMin / 60) * HOUR_H }} aria-label={`Current time ${formatTime12(hhmm(nowMin))}`} />}
              {create && create.day === di && (
                <div className="tg-create" style={{ top: (Math.min(create.from, create.to) / 60) * HOUR_H, height: Math.max(SNAP, Math.abs(create.to - create.from)) / 60 * HOUR_H }} />
              )}
            </div>
          ))}
          {placed.map((p) => {
            const cal = s.calendarsById.get(p.occ.calendarId);
            const isDrag = drag?.key === p.occ.key && drag.moved;
            const top = p.top + (isDrag && drag.mode === 'move' ? drag.minDelta : 0);
            const bottom = p.bottom + (isDrag ? drag.minDelta : 0);
            const dayIdx = p.day + (isDrag && drag.mode === 'move' ? drag.dayDelta : 0);
            const editable = canEdit(cal) && !p.occ.redacted;
            const person = showPerson ? s.personName(p.occ.ownerId) : '';
            return (
              <div
                key={p.occ.key + p.day}
                className={`tg-event ${isDrag ? 'dragging' : ''} ${p.occ.redacted ? 'busy' : ''} ${editable ? 'editable' : ''}`}
                style={{
                  ['--c' as string]: cal?.color ?? '#94a3b8',
                  top: (top / 60) * HOUR_H,
                  height: Math.max(18, ((bottom - top) / 60) * HOUR_H - 2),
                  left: `calc(${(dayIdx / days.length) * 100}% + ${(p.col / p.cols) * (100 / days.length)}% + 2px)`,
                  width: `calc(${100 / days.length / p.cols}% - 4px)`,
                }}
                onPointerDown={(e) => onEventPointerDown(e, p, 'move')}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!editable) {
                    const ev = s.data.events.find((x) => x.id === p.occ.eventId);
                    if (ev) s.setDialog({ type: 'event', event: ev, occurrence: p.occ });
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const ev = s.data.events.find((x) => x.id === p.occ.eventId);
                    if (ev) s.setDialog({ type: 'event', event: ev, occurrence: p.occ });
                  } else if (e.altKey && editable && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                    e.preventDefault();
                    void actions.moveTo(p.occ, addWallMinutes(p.occ.startLocal!, e.key === 'ArrowUp' ? -SNAP : SNAP));
                  } else if (e.altKey && editable && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
                    e.preventDefault();
                    void actions.moveDays(p.occ, e.key === 'ArrowLeft' ? -1 : 1);
                  }
                }}
                tabIndex={0}
                role="button"
                aria-label={`${p.occ.title}${person ? `, ${person}` : ''}, ${formatTime12(localTime(p.occ.startLocal!))} to ${formatTime12(localTime(p.occ.endLocal!))}${editable ? '. Alt+arrows move it.' : ''}`}
              >
                <div className="tg-ev-title">{person && <span className="person-tag">{person.slice(0, 1)}</span>}{p.occ.title}{p.occ.recurring ? ' ↻' : ''}</div>
                <div className="tg-ev-time">
                  {formatTime12(hhmm(top))}–{formatTime12(hhmm(Math.min(bottom, 1440)))}
                  {p.occ.location ? ` · ${p.occ.location}` : ''}
                </div>
                {editable && !p.endsAfter && <div className="tg-resize" onPointerDown={(e) => onEventPointerDown(e, p, 'resize')} aria-hidden />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
