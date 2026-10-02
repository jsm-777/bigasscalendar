import type { DragEvent, KeyboardEvent } from 'react';
import { useStore, canEdit } from '../store.tsx';
import type { Occurrence } from '../../shared/types.ts';
import { formatTime12, localTime } from '../../shared/dates.ts';
import { DRAG_MIME } from './layout.ts';
import { useEventActions } from '../actions.tsx';

interface ChipProps {
  occ: Occurrence;
  style?: React.CSSProperties;
  continuesBefore?: boolean;
  continuesAfter?: boolean;
  /** Date column (relative to the chip's first visible day) grabbed during drag. */
  spanDays?: number;
  segmentStartDate?: string;
  compact?: boolean;
  showPerson?: boolean;
  /** Days to move per Alt+Arrow (Up/Down). */
  verticalStep?: number;
}

export function Chip({ occ, style, continuesBefore, continuesAfter, spanDays, segmentStartDate, compact, showPerson, verticalStep = 7 }: ChipProps) {
  const s = useStore();
  const actions = useEventActions();
  const cal = s.calendarsById.get(occ.calendarId);
  const editable = canEdit(cal) && !occ.redacted;
  const color = cal?.color ?? '#94a3b8';
  const time = !occ.allDay && occ.startLocal && !continuesBefore ? formatTime12(localTime(occ.startLocal)) : '';
  const person = showPerson ? s.personName(occ.ownerId) : '';

  const onDragStart = (e: DragEvent) => {
    if (!editable) return e.preventDefault();
    let grabOffset = 0;
    if (spanDays && segmentStartDate) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const dayWidth = rect.width / spanDays;
      const col = Math.floor((e.clientX - rect.left) / dayWidth);
      const segOffset = Math.round((Date.parse(segmentStartDate) - Date.parse(occ.startDate)) / 86400000);
      grabOffset = segOffset + col;
    }
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ key: occ.key, grabOffset }));
    e.dataTransfer.effectAllowed = 'move';
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      open();
      return;
    }
    if (!e.altKey || !editable) return;
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -verticalStep, ArrowDown: verticalStep }[e.key];
    if (step) {
      e.preventDefault();
      e.stopPropagation();
      void actions.moveDays(occ, step);
    }
  };

  const open = () => {
    const ev = s.data.events.find((x) => x.id === occ.eventId);
    s.setSelected(occ.startDate < s.selected && occ.endDate >= s.selected ? s.selected : occ.startDate);
    if (ev) s.setDialog({ type: 'event', event: ev, occurrence: occ });
  };

  const label = `${occ.title}${person ? `, ${person}` : ''}, ${occ.allDay ? 'all day' : time}${occ.recurring ? ', repeats' : ''}${cal ? `, ${cal.name}` : ''}${editable ? '. Alt+arrow keys move it.' : ''}`;
  return (
    <div
      className={`chip ${occ.allDay || occ.startDate !== occ.endDate ? 'span' : 'timed'} ${continuesBefore ? 'cont-before' : ''} ${continuesAfter ? 'cont-after' : ''} ${compact ? 'compact' : ''} ${occ.redacted ? 'busy' : ''}`}
      style={{ ...style, ['--c' as string]: color }}
      draggable={editable}
      onDragStart={onDragStart}
      onClick={(e) => {
        e.stopPropagation();
        open();
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={onKeyDown}
      tabIndex={0}
      role="button"
      aria-label={label}
      title={label}
    >
      {continuesBefore && <span className="cont-mark" aria-hidden>‹</span>}
      {person && <span className="person-tag" aria-hidden>{person.slice(0, 1)}</span>}
      {time && <span className="chip-time">{time}</span>}
      <span className="chip-title">{occ.title}</span>
      {occ.recurring && <span className="chip-icon" aria-hidden>↻</span>}
      {continuesAfter && <span className="cont-mark right" aria-hidden>›</span>}
    </div>
  );
}
