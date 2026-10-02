import { useState } from 'react';
import { useStore } from '../store.tsx';
import { api, newId } from '../api.ts';
import type { CheckIn, Goal, Weekday } from '../../shared/types.ts';
import { goalProgress, STREAK_RULES } from '../../shared/streaks.ts';
import { WEEKDAY_SHORT } from '../../shared/dates.ts';
import { Modal } from './Modal.tsx';

export function GoalsSection() {
  const s = useStore();
  const goals = s.data.goals.filter((g) => !g.archived);
  const d = s.selected;
  const checkIn = async (g: Goal, extra = false) => {
    const prev = s.data.checkIns;
    const c: CheckIn = { id: newId(), goalId: g.id, date: d, quantity: null, reflection: '', clientKey: extra ? newId() : `${g.id}:${d}:quick`, createdAt: '' };
    try {
      const list = await api<CheckIn[]>('POST', '/api/check-ins', c);
      s.patchData((x) => ({ ...x, checkIns: list }));
    } catch (e) {
      s.patchData((x) => ({ ...x, checkIns: prev }));
      s.toast(`Check-in failed: ${(e as Error).message}`, 'error');
    }
  };
  return (
    <section className="sb-section">
      <div className="sb-title-row">
        <h3>Goals</h3>
        <button className="link small" onClick={() => s.setDialog({ type: 'goal' })}>+ Goal</button>
      </div>
      {goals.length === 0 ? (
        <p className="quiet">Track practice like workouts, trading study or creating — with weekly targets and streaks.</p>
      ) : (
        <ul className="goal-list">
          {goals.map((g) => {
            const p = goalProgress(g, s.data.checkIns, s.today);
            const onDay = s.data.checkIns.filter((c) => c.goalId === g.id && c.date === d);
            const planned = s.occurrences.filter((o) => o.startDate === d && s.data.events.find((e) => e.id === o.eventId)?.goalId === g.id).length;
            return (
              <li key={g.id} className="goal">
                <div className="goal-top">
                  <button className="goal-name" onClick={() => s.setDialog({ type: 'goal', goal: g })}>
                    <span className="dot" style={{ background: g.color }} />{g.title}
                  </button>
                  <span className="streak" title={g.mode === 'weekly' ? STREAK_RULES.weekly : STREAK_RULES.daily}>
                    {p.streak > 0 ? `🔥 ${p.streak} ${g.mode === 'weekly' ? 'wk' : 'day'}${p.streak === 1 ? '' : 's'}` : 'No streak yet'}
                  </span>
                </div>
                <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={p.target} aria-valuenow={p.thisWeek} aria-label={`${p.thisWeek} of ${p.target} this week`}>
                  <div style={{ width: `${Math.min(100, (p.thisWeek / p.target) * 100)}%`, background: g.color }} />
                </div>
                <div className="goal-bottom">
                  <span className="muted small">{p.thisWeek}/{p.target} this week{planned ? ` · ${planned} planned ${d === s.today ? 'today' : 'this day'}` : ''}</span>
                  {onDay.length === 0 ? (
                    <button className="btn small" onClick={() => void checkIn(g)} disabled={d > s.today}>Check in</button>
                  ) : (
                    <span className="small">
                      ✓ Done{onDay.length > 1 ? ` ×${onDay.length}` : ''} <button className="link small" onClick={() => void checkIn(g, true)}>+ another</button>
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function GoalDialog({ goal, onClose }: { goal?: Goal; onClose: () => void }) {
  const s = useStore();
  const [g, setG] = useState<Goal>(goal ?? { id: newId(), ownerId: s.me.user.id, title: '', color: '#8b5cf6', mode: 'weekly', weeklyTarget: 3, restDays: [], unit: '', archived: false, version: 0 });
  const [error, setError] = useState<string | null>(null);
  const checkIns = goal ? s.data.checkIns.filter((c) => c.goalId === goal.id).slice(-20).reverse() : [];

  const save = async () => {
    try {
      const saved = await api<Goal>('PUT', `/api/goals/${g.id}`, g);
      s.patchData((d) => ({ ...d, goals: [...d.goals.filter((x) => x.id !== g.id), saved] }));
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const removeCheckIn = async (c: CheckIn) => {
    const list = await api<CheckIn[]>('DELETE', `/api/check-ins/${c.id}`);
    s.patchData((d) => ({ ...d, checkIns: list }));
  };
  const saveReflection = async (c: CheckIn, reflection: string, quantity: number | null) => {
    const list = await api<CheckIn[]>('POST', '/api/check-ins', { ...c, reflection, quantity });
    s.patchData((d) => ({ ...d, checkIns: list }));
  };

  return (
    <Modal title={goal ? 'Edit goal' : 'New goal'} onClose={onClose} footer={
      <>
        {goal && <button className="btn danger ghost" onClick={async () => { await api('DELETE', `/api/goals/${g.id}`); s.patchData((d) => ({ ...d, goals: d.goals.filter((x) => x.id !== g.id) })); onClose(); }}>Delete goal</button>}
        <span className="grow" />
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save} disabled={!g.title.trim()}>Save</button>
      </>
    }>
      <label>Goal<input value={g.title} onChange={(e) => setG({ ...g, title: e.target.value })} placeholder="e.g. Trading practice, Workouts, Creating" autoFocus /></label>
      <div className="row">
        <label>Color<input type="color" value={g.color} onChange={(e) => setG({ ...g, color: e.target.value })} /></label>
        <label>Quantity unit (optional)<input value={g.unit} onChange={(e) => setG({ ...g, unit: e.target.value })} placeholder="minutes, pages…" /></label>
      </div>
      <fieldset>
        <legend>Target</legend>
        <label className="inline"><input type="radio" checked={g.mode === 'weekly'} onChange={() => setG({ ...g, mode: 'weekly' })} /> Flexible weekly target</label>
        {g.mode === 'weekly' && (
          <label className="inline indent">
            <input type="number" min={1} max={50} value={g.weeklyTarget} onChange={(e) => setG({ ...g, weeklyTarget: Math.max(1, Number(e.target.value)) })} style={{ width: 64 }} /> sessions per week
          </label>
        )}
        <label className="inline"><input type="radio" checked={g.mode === 'daily'} onChange={() => setG({ ...g, mode: 'daily' })} /> Daily, with planned rest days</label>
        {g.mode === 'daily' && (
          <div className="weekday-picks indent">
            {WEEKDAY_SHORT.map((w, i) => {
              const wd = (i + 1) as Weekday;
              const on = g.restDays.includes(wd);
              return (
                <label key={w} className="chip-check">
                  <input type="checkbox" checked={on} onChange={() => setG({ ...g, restDays: on ? g.restDays.filter((x) => x !== wd) : [...g.restDays, wd] })} />
                  {w}
                </label>
              );
            })}
            <span className="muted small">← rest days</span>
          </div>
        )}
        <p className="hint">Streak rule: {g.mode === 'weekly' ? STREAK_RULES.weekly : STREAK_RULES.daily} Calculated in {s.tz}.</p>
      </fieldset>
      <p className="hint">Planned sessions are calendar events linked to this goal (choose the goal when editing an event). Check-ins record what you actually did — they are counted separately, and repeated submissions never double count.</p>
      {checkIns.length > 0 && (
        <fieldset>
          <legend>Recent check-ins</legend>
          <ul className="checkin-list">
            {checkIns.map((c) => (
              <li key={c.id}>
                <span className="small">{c.date}</span>
                <input type="number" min={0} placeholder={g.unit || 'qty'} defaultValue={c.quantity ?? ''} onBlur={(e) => void saveReflection(c, c.reflection, e.target.value === '' ? null : Number(e.target.value))} aria-label="Quantity" style={{ width: 70 }} />
                <input defaultValue={c.reflection} placeholder="Short reflection" onBlur={(e) => e.target.value !== c.reflection && void saveReflection(c, e.target.value, c.quantity)} aria-label="Reflection" />
                <button className="link small" onClick={() => void removeCheckIn(c)}>Remove</button>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      {error && <p className="error-text">{error}</p>}
    </Modal>
  );
}
