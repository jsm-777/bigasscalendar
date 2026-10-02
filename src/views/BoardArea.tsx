import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../store.tsx';
import type { Occurrence } from '../../shared/types.ts';
import { addDays, startOfWeek } from '../../shared/dates.ts';
import { YearBoard } from './YearBoard.tsx';
import { MonthView } from './MonthView.tsx';
import { TimeGrid } from './TimeGrid.tsx';

function usePersisted<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = (next: T) => {
    setV(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* per-viewer convenience only */
    }
  };
  return [v, set];
}

export function BoardArea() {
  const s = useStore();
  const [fit, setFit] = usePersisted('bac-fit', true);
  const [notesOpen, setNotesOpen] = usePersisted('bac-notes-col', true);
  const partner = s.me.partner;

  const renderView = (occs: Occurrence[], opts: { label?: string; own: boolean; showPerson?: boolean }) => {
    if (s.view === 'year') return <YearBoard occs={occs} showNotes={opts.own} showPerson={opts.showPerson} fit={fit} notesOpen={notesOpen} label={opts.label} />;
    if (s.view === 'month') return <MonthView occs={occs} showPerson={opts.showPerson} label={opts.label} />;
    const days = s.view === 'day' ? [s.selected] : Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(s.selected, s.me.settings.weekStartsOn ?? 7), i));
    return <TimeGrid days={days} occs={occs} showPerson={opts.showPerson} label={opts.label} />;
  };

  const mine = s.allOccurrences.filter((o) => o.ownerId === s.me.user.id);
  const theirs = partner ? s.allOccurrences.filter((o) => o.ownerId === partner.id) : [];

  let content: ReactNode;
  if (s.workspace === 'together' && partner) {
    content = s.togetherMode === 'overlay'
      ? renderView(s.allOccurrences, { own: true, showPerson: true })
      : (
        <SyncedPanes key={s.view}>
          {renderView(mine, { label: s.me.user.displayName, own: true })}
          {renderView(theirs, { label: partner.displayName, own: false })}
        </SyncedPanes>
      );
  } else if (s.workspace === 'partner' && partner) {
    content = renderView(theirs, { label: partner.displayName, own: false });
  } else {
    content = renderView(mine, { own: true });
  }

  const empty = !s.loading && s.data.calendars.filter((c) => c.access === 'owner').length === 0 && s.workspace === 'me';

  return (
    <section className="board-area" aria-label="Calendar">
      <div className="board-toolbar">
        {s.view === 'year' && (
          <>
            <div className="seg" role="group" aria-label="Board size">
              <button className={fit ? 'on' : ''} aria-pressed={fit} onClick={() => setFit(true)}>Fit year</button>
              <button className={!fit ? 'on' : ''} aria-pressed={!fit} onClick={() => setFit(false)}>Detail</button>
            </div>
            {s.workspace !== 'partner' && (
              <button className="btn small ghost" aria-pressed={notesOpen} onClick={() => setNotesOpen(!notesOpen)}>{notesOpen ? 'Hide notes column' : 'Show notes column'}</button>
            )}
          </>
        )}
        {s.workspace === 'together' && partner && (
          <div className="seg" role="group" aria-label="Together layout">
            <button className={s.togetherMode === 'side' ? 'on' : ''} aria-pressed={s.togetherMode === 'side'} onClick={() => s.setTogetherMode('side')}>Side by side</button>
            <button className={s.togetherMode === 'overlay' ? 'on' : ''} aria-pressed={s.togetherMode === 'overlay'} onClick={() => s.setTogetherMode('overlay')}>Overlay</button>
          </div>
        )}
        <Legend />
      </div>
      {empty && (
        <div className="empty-hint">
          Your board is blank. <button className="link" onClick={() => s.setDialog({ type: 'settings', tab: 'calendars' })}>Add calendars</button> (Personal, Bills, Paydays… are optional templates), then double-click any day to add an event.
        </div>
      )}
      <div className={`board-scroll view-${s.view}`}>{content}</div>
    </section>
  );
}

function Legend() {
  const s = useStore();
  const cals = s.data.calendars.filter((c) => !c.archived && c.visible && s.ownerFilter(c.ownerId));
  if (!cals.length) return null;
  return (
    <ul className="legend" aria-label="Visible calendars">
      {cals.map((c) => (
        <li key={c.id}>
          <span className="dot" style={{ background: c.color }} />
          {c.name}
          {c.access !== 'owner' && <span className="muted"> · {s.personName(c.ownerId)}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Two panes whose scroll positions stay aligned (dates line up across people). */
function SyncedPanes({ children }: { children: ReactNode[] }) {
  const refs = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
  useEffect(() => {
    const els = refs.map((r) => r.current!);
    let syncing = false;
    const handlers = els.map((el, i) => () => {
      if (syncing) return;
      syncing = true;
      const other = els[1 - i];
      // Sync every scrollable descendant by position (board grid and time-grid bodies).
      const src = [el, ...el.querySelectorAll<HTMLElement>('.year-wrap, .tg-body')];
      const dst = [other, ...other.querySelectorAll<HTMLElement>('.year-wrap, .tg-body')];
      src.forEach((n, k) => {
        if (dst[k]) {
          dst[k].scrollTop = n.scrollTop;
          dst[k].scrollLeft = n.scrollLeft;
        }
      });
      requestAnimationFrame(() => (syncing = false));
    });
    els.forEach((el, i) => el.addEventListener('scroll', handlers[i], { capture: true, passive: true }));
    return () => els.forEach((el, i) => el.removeEventListener('scroll', handlers[i], { capture: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="panes">
      <div className="pane" ref={refs[0]}>{children[0]}</div>
      <div className="pane" ref={refs[1]}>{children[1]}</div>
    </div>
  );
}
