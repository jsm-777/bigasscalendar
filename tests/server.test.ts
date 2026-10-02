import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { openDb, all, get, run } from '../server/db.ts';
import { createApp } from '../server/app.ts';
import { reconcileUser, tick } from '../server/notify.ts';
import { addDays, todayIn } from '../shared/dates.ts';
import type { CalEvent } from '../shared/types.ts';

// Integration tests run against an in-memory database; nothing touches the real data file.
process.env.ALLOW_OPEN_SIGNUP = 'true';
const db = openDb(':memory:');
let server: Server;
let base = '';

class Client {
  cookie = '';
  async req(method: string, path: string, body?: unknown) {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', 'x-bac': '1', cookie: this.cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const json = await res.json().catch(() => null);
    return { status: res.status, body: json };
  }
}

const TZ = 'America/Los_Angeles';
const today = todayIn(TZ);
const tomorrow = addDays(today, 1);
const jasmin = new Client();
const tehron = new Client();
let jasminId = '';
let tehronId = '';

function ev(over: Partial<CalEvent>): CalEvent {
  return {
    id: crypto.randomUUID(), ownerId: '', calendarId: '', title: 'Test', allDay: false,
    startDate: tomorrow, endDate: tomorrow, startLocal: `${tomorrow}T10:00`, endLocal: `${tomorrow}T11:00`, tz: TZ,
    location: '', notes: '', recurrence: null, exceptions: [], alerts: [], taskId: null, goalId: null, version: 0,
    updatedAt: '', ...over,
  };
}

beforeAll(async () => {
  server = createApp(db).listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  expect((await jasmin.req('POST', '/api/auth/signup', { email: 'j@example.test', password: 'correct horse battery', displayName: 'Jasmin', tz: TZ })).status).toBe(200);
  jasminId = (await jasmin.req('GET', '/api/me')).body.user.id;
});
afterAll(() => server.close());

describe('accounts', () => {
  it('a fresh account has zero personal records', async () => {
    const { body } = await jasmin.req('GET', `/api/data?from=2026-09-01&to=2027-08-31`);
    expect(body.calendars).toEqual([]);
    expect(body.events).toEqual([]);
    expect(body.tasks).toEqual([]);
    expect(body.notes).toEqual([]);
    expect(body.goals).toEqual([]);
    expect(body.checkIns).toEqual([]);
  });

  it('rejects requests without a session or without the CSRF header', async () => {
    expect((await new Client().req('GET', '/api/me')).status).toBe(401);
    const res = await fetch(`${base}/api/calendars`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: jasmin.cookie }, body: '{}' });
    expect(res.status).toBe(403);
  });

  it('partner joins through an invitation only', async () => {
    process.env.ALLOW_OPEN_SIGNUP = 'false';
    expect((await tehron.req('POST', '/api/auth/signup', { email: 't@example.test', password: 'another long password', displayName: 'Tehron', tz: 'America/New_York' })).status).toBe(403);
    const inv = await jasmin.req('POST', '/api/invitations', {});
    const token = new URL(inv.body.link).searchParams.get('invite');
    const res = await tehron.req('POST', '/api/auth/signup', { email: 't@example.test', password: 'another long password', displayName: 'Tehron', tz: 'America/New_York', inviteToken: token });
    expect(res.status).toBe(200);
    tehronId = (await tehron.req('GET', '/api/me')).body.user.id;
    expect((await jasmin.req('GET', '/api/me')).body.partner.displayName).toBe('Tehron');
    // tokens are single use
    expect((await new Client().req('GET', `/api/invitations/preview/${token}`)).status).toBe(404);
  });
});

describe('sharing permissions', () => {
  const cal = (name: string, shareLevel: string) => ({ id: crypto.randomUUID(), name, color: '#3b82f6', archived: false, shareLevel, version: 0 });
  const cals: Record<string, string> = {};

  it('enforces private / free-busy / details / edit', async () => {
    for (const level of ['private', 'freebusy', 'details', 'edit']) {
      const c = cal(level, level);
      cals[level] = c.id;
      await jasmin.req('POST', '/api/calendars', c);
      await jasmin.req('POST', '/api/events/batch', { upserts: [ev({ calendarId: c.id, title: `secret ${level}`, notes: 'private notes' })], deletes: [] });
    }
    await jasmin.req('PUT', `/api/notes/${crypto.randomUUID()}`, { scope: 'day', key: tomorrow, title: '', body: 'journal entry', version: 0 });

    const { body } = await tehron.req('GET', `/api/data?from=${today}&to=${addDays(today, 7)}`);
    const titles = body.events.map((e: CalEvent) => e.title).sort();
    expect(titles).toEqual(['Busy', 'secret details', 'secret edit']);
    const busy = body.events.find((e: CalEvent) => e.title === 'Busy');
    expect(busy.notes).toBe('');
    expect(busy.redacted).toBe(true);
    expect(body.calendars.map((c: { id: string }) => c.id)).not.toContain(cals.private);
    expect(body.notes).toEqual([]); // notes never cross accounts

    // details = read-only; edit = writable
    const detailsEv = body.events.find((e: CalEvent) => e.title === 'secret details');
    expect((await tehron.req('POST', '/api/events/batch', { upserts: [{ ...detailsEv, title: 'hacked' }], deletes: [] })).status).toBe(403);
    expect((await tehron.req('POST', '/api/events/batch', { upserts: [ev({ calendarId: cals.private, title: 'x' })], deletes: [] })).status).toBe(403);
    const editEv = body.events.find((e: CalEvent) => e.title === 'secret edit');
    const ok = await tehron.req('POST', '/api/events/batch', { upserts: [{ ...editEv, title: 'edited by Tehron' }], deletes: [] });
    expect(ok.status).toBe(200);
    expect(ok.body.events[0].ownerId).toBe(jasminId);
  });

  it('stale versions are rejected instead of overwriting', async () => {
    const { body } = await jasmin.req('GET', `/api/data?from=${today}&to=${addDays(today, 7)}`);
    const e = body.events.find((x: CalEvent) => x.title === 'edited by Tehron');
    expect((await jasmin.req('POST', '/api/events/batch', { upserts: [{ ...e, version: e.version - 1 }], deletes: [] })).status).toBe(409);
  });

  it('plans cannot bypass permissions', async () => {
    const { body } = await jasmin.req('GET', `/api/data?from=${today}&to=${addDays(today, 7)}`);
    const priv = body.events.find((x: CalEvent) => x.title === 'secret private');
    const res = await tehron.req('POST', '/api/plan/apply', { plan: { version: 1, operations: [{ op: 'delete_event', eventId: priv.id }] } });
    expect(res.status).toBe(400);
    expect(get(db, 'SELECT 1 AS x FROM events WHERE id = ?', priv.id)).toBeTruthy();
  });

  it('partner reminders are never planned for the other person', () => {
    run(db, 'INSERT OR REPLACE INTO notification_prefs (user_id, prefs) VALUES (?, ?)', tehronId, JSON.stringify({ enabled: true }));
    reconcileUser(db, tehronId);
    expect(all(db, "SELECT * FROM notification_jobs WHERE user_id = ? AND status = 'pending'", tehronId)).toEqual([]);
  });
});

describe('reminders', () => {
  let calId = '';
  const pending = () => all<{ dedupe_key: string; fire_at: string; kind: string }>(db, "SELECT dedupe_key, fire_at, kind FROM notification_jobs WHERE user_id = ? AND status = 'pending' AND kind IN ('event','task')", jasminId);

  beforeAll(async () => {
    calId = crypto.randomUUID();
    await jasmin.req('POST', '/api/calendars', { id: calId, name: 'Reminders', color: '#16a34a', archived: false, shareLevel: 'private', version: 0 });
    await jasmin.req('PUT', '/api/notification-prefs', {
      enabled: true, eventLeadMinutes: 15, taskLeadMinutes: 0, dateOnlyTaskTime: '09:00', dailyAgenda: false, dailyAgendaTime: '07:30',
      quietStart: null, quietEnd: null, showTitlesOnLockScreen: false, pushTarget: 'latest', snoozeMinutes: 10,
    });
  });

  it('schedules, reschedules and cancels event reminders', async () => {
    const e = ev({ calendarId: calId, title: 'Dentist', alerts: [{ minutesBefore: 30 }] });
    const created = (await jasmin.req('POST', '/api/events/batch', { upserts: [e], deletes: [] })).body.events[0];
    let jobs = pending().filter((j) => j.dedupe_key.includes(e.id));
    expect(jobs).toHaveLength(1);
    const firstKey = jobs[0].dedupe_key;
    // re-planning an unchanged event is a no-op (no duplicates)
    reconcileUser(db, jasminId);
    expect(pending().filter((j) => j.dedupe_key.includes(e.id))).toHaveLength(1);
    // move an hour later → old job cancelled, new job pending
    const moved = (await jasmin.req('POST', '/api/events/batch', { upserts: [{ ...created, startLocal: `${tomorrow}T11:00`, endLocal: `${tomorrow}T12:00` }], deletes: [] })).body.events[0];
    jobs = pending().filter((j) => j.dedupe_key.includes(e.id));
    expect(jobs).toHaveLength(1);
    expect(jobs[0].dedupe_key).not.toBe(firstKey);
    expect(get<{ status: string }>(db, 'SELECT status FROM notification_jobs WHERE dedupe_key = ?', firstKey)!.status).toBe('cancelled');
    // delete → cancelled
    await jasmin.req('POST', '/api/events/batch', { upserts: [], deletes: [{ id: e.id, version: moved.version }] });
    expect(pending().filter((j) => j.dedupe_key.includes(e.id))).toHaveLength(0);
  });

  it('recurring occurrences each get a job; cancelling one occurrence removes only its job', async () => {
    const e = ev({ calendarId: calId, title: 'Standup', alerts: [{ minutesBefore: 5 }], recurrence: { freq: 'daily', interval: 1, count: 3 } });
    const saved = (await jasmin.req('POST', '/api/events/batch', { upserts: [e], deletes: [] })).body.events[0];
    expect(pending().filter((j) => j.dedupe_key.includes(e.id))).toHaveLength(3);
    const second = addDays(tomorrow, 1);
    await jasmin.req('POST', '/api/events/batch', { upserts: [{ ...saved, exceptions: [{ originalDate: second, cancelled: true, override: null }] }], deletes: [] });
    const keys = pending().filter((j) => j.dedupe_key.includes(e.id)).map((j) => j.dedupe_key);
    expect(keys).toHaveLength(2);
    expect(keys.some((k) => k.includes(`:${second}:`))).toBe(false);
  });

  it('task completion cancels, reopening restores, and goal check-in is recorded once', async () => {
    const goalId = crypto.randomUUID();
    await jasmin.req('PUT', `/api/goals/${goalId}`, { title: 'Practice', color: '#f59e0b', mode: 'weekly', weeklyTarget: 3, restDays: [], unit: '', archived: false, version: 0 });
    const lists = (await jasmin.req('GET', `/api/data?from=${today}&to=${today}`)).body.taskLists;
    const id = crypto.randomUUID();
    let t = { id, listId: lists[0].id, title: 'Pay bill', notes: '', priority: 2, dueDate: tomorrow, dueTime: null, tz: TZ, recurrence: null, completedAt: null, alerts: [{ minutesBefore: 0 }], goalId, version: 0 };
    t = (await jasmin.req('PUT', `/api/tasks/${id}`, t)).body.task;
    expect(pending().filter((j) => j.dedupe_key.startsWith(`task:${id}`))).toHaveLength(1);
    // date-only task fires at the configured default time (09:00 local)
    const fire = pending().find((j) => j.dedupe_key.startsWith(`task:${id}`))!.fire_at;
    expect(new Date(fire).toLocaleTimeString('en-US', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })).toBe('09:00');

    const done = await jasmin.req('PUT', `/api/tasks/${id}`, { ...t, completedAt: new Date().toISOString() });
    expect(pending().filter((j) => j.dedupe_key.startsWith(`task:${id}`))).toHaveLength(0);
    expect(done.body.checkIns.filter((c: { goalId: string }) => c.goalId === goalId)).toHaveLength(1);
    // submitting the same completed state again does not double count
    const again = await jasmin.req('PUT', `/api/tasks/${id}`, { ...done.body.task, notes: 'paid' });
    expect(again.body.checkIns.filter((c: { goalId: string }) => c.goalId === goalId)).toHaveLength(1);
    const reopened = await jasmin.req('PUT', `/api/tasks/${id}`, { ...again.body.task, completedAt: null });
    expect(reopened.body.checkIns.filter((c: { goalId: string }) => c.goalId === goalId)).toHaveLength(0);
    expect(pending().filter((j) => j.dedupe_key.startsWith(`task:${id}`))).toHaveLength(1);
  });

  it('check-ins are idempotent by client key', async () => {
    const goalId = crypto.randomUUID();
    await jasmin.req('PUT', `/api/goals/${goalId}`, { title: 'Workout', color: '#8b5cf6', mode: 'daily', weeklyTarget: 3, restDays: [7], unit: 'min', archived: false, version: 0 });
    const c = { id: crypto.randomUUID(), goalId, date: today, quantity: 30, reflection: '', clientKey: 'k1' };
    await jasmin.req('POST', '/api/check-ins', c);
    const res = await jasmin.req('POST', '/api/check-ins', { ...c, id: crypto.randomUUID(), quantity: 45 });
    const mine = res.body.filter((x: { goalId: string }) => x.goalId === goalId);
    expect(mine).toHaveLength(1);
    expect(mine[0].quantity).toBe(45);
  });
});

describe('delivery', () => {
  const sent: string[] = [];
  let mode: 'ok' | 'gone' | 'error' = 'ok';
  const sender = async (sub: { endpoint: string }, payload: string) => {
    if (mode === 'gone') throw Object.assign(new Error('gone'), { statusCode: 410 });
    if (mode === 'error') throw Object.assign(new Error('server'), { statusCode: 503 });
    sent.push(`${sub.endpoint} ${payload}`);
    return { statusCode: 201 };
  };
  const job = (fireAt: Date, expiresAt: Date, key: string) => {
    const id = crypto.randomUUID();
    run(db, `INSERT INTO notification_jobs (id, user_id, kind, dedupe_key, fire_at, expires_at, status, payload, created_at, updated_at)
      VALUES (?,?,?,?,?,?,'pending',?,?,?)`, id, tehronId, 'event', key, fireAt.toISOString(), expiresAt.toISOString(),
      JSON.stringify({ title: 'Private title', body: 'b', url: '/' }), new Date().toISOString(), new Date().toISOString());
    return id;
  };

  it('delivers once in-app and once per target push subscription, hiding titles by default', async () => {
    await tehron.req('POST', '/api/push/subscribe', { endpoint: 'https://push.example.test/a', keys: { p256dh: 'p', auth: 'a' } });
    const now = new Date();
    const id = job(new Date(now.getTime() - 1000), new Date(now.getTime() + 600_000), 'd1');
    await tick(db, sender, now);
    await tick(db, sender, now); // second tick must not duplicate
    expect(all(db, 'SELECT * FROM inapp_notifications WHERE job_id = ?', id)).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).not.toContain('Private title');
  });

  it('drops stale jobs instead of flooding', async () => {
    const now = new Date();
    const id = job(new Date(now.getTime() - 3600_000), new Date(now.getTime() - 60_000), 'd2');
    await tick(db, sender, now);
    expect(get<{ status: string }>(db, 'SELECT status FROM notification_jobs WHERE id = ?', id)!.status).toBe('expired');
    expect(all(db, 'SELECT * FROM inapp_notifications WHERE job_id = ?', id)).toHaveLength(0);
  });

  it('suppresses push (not in-app) during quiet hours', async () => {
    run(db, 'UPDATE notification_prefs SET prefs = ? WHERE user_id = ?', JSON.stringify({ enabled: true, quietStart: '00:00', quietEnd: '23:59' }), tehronId);
    const now = new Date();
    const id = job(new Date(now.getTime() - 1000), new Date(now.getTime() + 600_000), 'd3');
    const before = sent.length;
    await tick(db, sender, now);
    expect(sent.length).toBe(before);
    expect(all(db, 'SELECT * FROM inapp_notifications WHERE job_id = ?', id)).toHaveLength(1);
    expect(get<{ status: string }>(db, 'SELECT status FROM notification_deliveries WHERE job_id = ?', id)!.status).toBe('suppressed');
    run(db, 'UPDATE notification_prefs SET prefs = ? WHERE user_id = ?', JSON.stringify({ enabled: true }), tehronId);
  });

  it('retries transient failures a bounded number of times', async () => {
    mode = 'error';
    let now = new Date();
    const id = job(new Date(now.getTime() - 1000), new Date(now.getTime() + 3 * 3600_000), 'd4');
    for (let i = 0; i < 6; i++) {
      await tick(db, sender, now);
      now = new Date(now.getTime() + 10 * 60_000);
    }
    const d = get<{ status: string; attempts: number }>(db, 'SELECT status, attempts FROM notification_deliveries WHERE job_id = ?', id)!;
    expect(d.status).toBe('failed');
    expect(d.attempts).toBe(3);
  });

  it('removes revoked subscriptions (410)', async () => {
    mode = 'gone';
    const now = new Date();
    job(new Date(now.getTime() - 1000), new Date(now.getTime() + 600_000), 'd5');
    await tick(db, sender, now);
    expect(all(db, 'SELECT * FROM push_subscriptions WHERE user_id = ?', tehronId)).toHaveLength(0);
  });
});

describe('plans', () => {
  it('previews without writing, applies, and undoes', async () => {
    const calId = crypto.randomUUID();
    await jasmin.req('POST', '/api/calendars', { id: calId, name: 'Workouts', color: '#8b5cf6', archived: false, shareLevel: 'private', version: 0 });
    const plan = { version: 1, operations: [{ op: 'create_event', calendar: 'Workouts', title: 'Run', date: tomorrow, start: '06:00', end: '07:00' }] };
    const count = () => get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM events WHERE title = 'Run'")!.n;
    const preview = await jasmin.req('POST', '/api/plan/preview', { plan });
    expect(preview.body.items[0].error).toBeNull();
    expect(count()).toBe(0);
    const applied = await jasmin.req('POST', '/api/plan/apply', { plan });
    expect(count()).toBe(1);
    const undo = await jasmin.req('POST', `/api/plan/${applied.body.proposalId}/undo`, {});
    expect(undo.body.conflicts).toEqual([]);
    expect(count()).toBe(0);
  });

  it('undo leaves records edited afterwards alone', async () => {
    const plan = { version: 1, operations: [{ op: 'create_event', calendar: 'Workouts', title: 'Swim', date: tomorrow, start: '08:00' }] };
    const applied = await jasmin.req('POST', '/api/plan/apply', { plan });
    const e = (await jasmin.req('GET', `/api/data?from=${tomorrow}&to=${tomorrow}`)).body.events.find((x: CalEvent) => x.title === 'Swim');
    await jasmin.req('POST', '/api/events/batch', { upserts: [{ ...e, title: 'Swim (edited)' }], deletes: [] });
    const undo = await jasmin.req('POST', `/api/plan/${applied.body.proposalId}/undo`, {});
    expect(undo.body.conflicts).toHaveLength(1);
    expect(get(db, "SELECT 1 AS x FROM events WHERE title = 'Swim (edited)'")).toBeTruthy();
  });

  it('rejects malformed plans', async () => {
    const res = await jasmin.req('POST', '/api/plan/preview', { plan: { version: 1, operations: [{ op: 'drop_database' }] } });
    expect(res.status).toBe(400);
  });
});
