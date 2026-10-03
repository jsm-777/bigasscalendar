import { useEffect, useMemo, useRef, useState } from 'react';
import { boardStartFor, useStore } from '../store.tsx';
import type { Ev } from '../../shared/types.ts';
import { MONTH_NAMES, WEEKDAY_LETTER, addMonths, daysInMonth, makeDate, monthKey, weekday } from '../../shared/dates.ts';
import { shortDate } from '../lib/format.ts';

const MAX_BARS = 3;

/** The signature board: twelve month rows × day columns 1–31, events as bold color bars. */
export function YearPanel() {
  const s = useStore();
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const MONTH_W = width < 700 ? 52 : 108;
  // Fit the year on wide screens; on phones keep tappable cells and scroll sideways.
  const cellW = Math.max(30, Math.floor((width - MONTH_W) / 31));

  const byDay = useMemo(() => {
    const m = new Map<string, Ev[]>();
    for (const e of s.events) {
      for (let d = e.startDate; d <= e.endDate; d = nextDay(d)) {
        const list = m.get(d) ?? [];
        list.push(e);
        m.set(d, list);
        if (list.length > 40) break;
      }
    }
    return m;
  }, [s.events]);

  const [a, b] = [s.months[0], s.months[11]];
  const shift = (n: number) => {
    const next = monthKey(addMonths(`${s.boardStart}-01`, 12 * n));
    s.setBoardStart(next);
    s.setSelected(`${next}-01`);
  };
  const open = (d: string) => {
    s.setSelected(d);
    s.setPanel(0);
  };

  // Bring today into view horizontally on phones.
  useEffect(() => {
    const el = wrap.current?.querySelector<HTMLElement>('.yc.today');
    if (el && wrap.current) wrap.current.scrollLeft = Math.max(0, el.offsetLeft - MONTH_W - 60);
  }, [s.boardStart, MONTH_W]);

  return (
    <section className="panel year-panel" aria-label="Year board">
      <header className="hero hero-violet">
        <div className="hero-nav">
          <button className="round-btn light" onClick={() => shift(-1)} aria-label="Previous 12 months">‹</button>
          <div className="hero-kicker">{s.boardStart === boardStartFor(s.today) ? 'This year' : 'Year'}</div>
          <button className="round-btn light" onClick={() => shift(1)} aria-label="Next 12 months">›</button>
        </div>
        <div className="hero-title">
          <span className="hero-weekday hide-phone">The big board</span>
          <span className="hero-big">{MONTH_NAMES[Number(a.slice(5)) - 1].slice(0, 3)} ’{a.slice(2, 4)} – {MONTH_NAMES[Number(b.slice(5)) - 1].slice(0, 3)} ’{b.slice(2, 4)}</span>
        </div>
        <div className="hero-stats legend">
          {s.visibleCals.slice(0, 8).map((c) => (
            <span key={c.id} className="stat legend-item"><i style={{ background: c.color }} />{c.summary}</span>
          ))}
        </div>
      </header>
      <div className="panel-body year-body">
        <div className="board-wrap" ref={wrap}>
          <div className="board" style={{ gridTemplateColumns: `${MONTH_W}px repeat(31, ${cellW}px)`, width: MONTH_W + 31 * cellW }} role="grid" aria-label="Year board">
            <div className="bh corner" />
            {Array.from({ length: 31 }, (_, i) => <div key={i} className="bh">{i + 1}</div>)}
            {s.months.map((mk) => {
              const [y, m] = mk.split('-').map(Number);
              const dim = daysInMonth(y, m);
              const hasNote = !!s.app.monthNotes[mk]?.trim();
              return [
                <button key={`${mk}-m`} className={`bm ${m === 1 ? 'new-year' : ''}`} onClick={() => s.setSheet({ type: 'monthNote', month: mk })} aria-label={`${MONTH_NAMES[m - 1]} ${y} notes${hasNote ? '' : ', empty'}`}>
                  <span className="bm-name">{width < 700 ? MONTH_NAMES[m - 1].slice(0, 3) : MONTH_NAMES[m - 1]}</span>
                  {(m === 1 || mk === s.months[0]) && <span className="bm-year">{y}</span>}
                  {hasNote && <span className="bm-note" aria-hidden>✎</span>}
                </button>,
                ...Array.from({ length: 31 }, (_, i) => {
                  if (i >= dim) return <div key={`${mk}-${i}`} className="yc invalid" aria-hidden />;
                  const d = makeDate(y, m, i + 1);
                  const evs = byDay.get(d) ?? [];
                  const wd = weekday(d);
                  return (
                    <button
                      key={d}
                      className={`yc ${wd >= 6 ? 'weekend' : ''} ${d === s.today ? 'today' : ''} ${d === s.selected ? 'selected' : ''}`}
                      onClick={() => open(d)}
                      aria-label={`${shortDate(d)}${d === s.today ? ', today' : ''}${evs.length ? `, ${evs.length} event${evs.length === 1 ? '' : 's'}: ${evs.slice(0, 3).map((e) => e.title).join(', ')}` : ''}`}
                    >
                      <span className="yc-wd">{WEEKDAY_LETTER[wd - 1]}</span>
                      <span className="yc-bars">
                        {evs.slice(0, MAX_BARS).map((e) => (
                          <i key={e.id} style={{ background: s.colorOf(e) }} className={`${e.startDate < d ? 'cont-l' : ''} ${e.endDate > d ? 'cont-r' : ''}`} />
                        ))}
                      </span>
                      {evs.length > MAX_BARS && <span className="yc-more">+{evs.length - MAX_BARS}</span>}
                    </button>
                  );
                }),
              ];
            })}
          </div>
        </div>
        <p className="hint board-hint">Tap a day to open it · tap a month for its notes</p>
      </div>
    </section>
  );
}

function nextDay(d: string): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}
