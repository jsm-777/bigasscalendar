import Anthropic from '@anthropic-ai/sdk';
import type { DB } from './db.ts';
import { get } from './db.ts';
import { listCalendars, listEvents, listTaskLists, listTasks, userProfile } from './repo.ts';
import { planSchema, type Plan } from '../shared/schemas.ts';
import { addDays, nowLocal, todayIn, WEEKDAY_SHORT, weekday } from '../shared/dates.ts';
import { expandAll } from '../shared/recurrence.ts';

// Optional in-app planning assistant. The API key stays on the server; the browser only ever
// receives a proposed plan, which goes through the same validation, preview and Apply flow as
// an imported plan. Nothing is written by this module.

export function assistantConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

const SYSTEM = `You are the planning assistant inside "Big Ass Calendar", a personal planner.
Turn the user's request into a JSON plan of typed operations. You never change data yourself; the user reviews and applies the plan.

Return ONLY a JSON object (no prose, no code fences) matching:
{
  "version": 1,
  "summary": string,              // one or two sentences describing the plan
  "questions": string[],          // ask when ambiguity materially affects dates or data; then keep operations minimal or empty
  "operations": Operation[]
}
Operation is one of:
- {"op":"create_event","calendar":<calendar name>,"title":string,"date":"YYYY-MM-DD","start"?:"HH:mm","end"?:"HH:mm","endDate"?:"YYYY-MM-DD","allDay"?:boolean,"location"?:string,"notes"?:string,"recurrence"?:{"freq":"daily"|"weekly"|"monthly"|"yearly","interval":number,"byWeekday"?:number[] (1=Mon..7=Sun),"count"?:number,"until"?:"YYYY-MM-DD"},"alertMinutesBefore"?:number[]}
- {"op":"move_event","eventId":string,"occurrenceDate"?:"YYYY-MM-DD","scope"?:"this"|"following"|"all","newDate"?:"YYYY-MM-DD","newStart"?:"HH:mm"}
- {"op":"resize_event","eventId":string,"occurrenceDate"?:"YYYY-MM-DD","scope"?:...,"newEnd":"HH:mm"}
- {"op":"delete_event","eventId":string,"occurrenceDate"?:"YYYY-MM-DD","scope"?:...}
- {"op":"set_event_alert","eventId":string,"minutesBefore":number[]}
- {"op":"create_task","list"?:<list name>,"title":string,"dueDate"?:"YYYY-MM-DD","dueTime"?:"HH:mm","priority"?:0-3,"notes"?:string,"remind"?:boolean}
- {"op":"complete_task","taskId":string}
- {"op":"set_task_due","taskId":string,"dueDate":"YYYY-MM-DD"|null,"dueTime"?:"HH:mm"|null}

Rules:
- All dates and times are the user's local time zone given below. Resolve relative dates ("next week", "Saturday") from the current local date.
- Recurring events need occurrenceDate (the occurrence's original date) and a scope when moving/resizing/deleting. Default to "this".
- Never move or delete existing commitments unless the user asked for that specific change.
- Respect the user's planning constraints and avoid overlapping existing events unless asked.
- Only use calendar and list names that exist. If none fits, ask a question instead of inventing one.
- "A reminder the day before" means alertMinutesBefore [1440] on an event, or a task with remind true due the day before.
- Trading items are practice/learning sessions only. Never give financial advice.`;

export async function draftPlan(db: DB, userId: string, message: string, history: { role: 'user' | 'assistant'; content: string }[]) {
  if (!assistantConfigured()) throw new Error('Assistant is not configured');
  const me = userProfile(db, userId);
  const today = todayIn(me.tz);
  const calendars = listCalendars(db, userId).filter((c) => !c.archived && (c.access === 'owner' || c.access === 'edit'));
  const lists = listTaskLists(db, userId);
  const events = listEvents(db, userId, addDays(today, -7), addDays(today, 45));
  const occ = expandAll(events, addDays(today, -7), addDays(today, 45)).slice(0, 300);
  const tasks = listTasks(db, userId).filter((t) => !t.completedAt).slice(0, 200);
  const settings = get<{ settings: string }>(db, 'SELECT settings FROM user_settings WHERE user_id = ?', userId);
  const constraints = settings ? (JSON.parse(settings.settings).planningConstraints ?? '') : '';

  const context = [
    `Current local date/time: ${nowLocal(me.tz)} (${WEEKDAY_SHORT[weekday(today) - 1]}), time zone ${me.tz}.`,
    `Planning constraints from the user: ${constraints || '(none set)'}`,
    `Calendars you may write to: ${calendars.map((c) => c.name).join(', ') || '(none — ask the user to create one)'}`,
    `Task lists: ${lists.map((l) => l.name).join(', ') || '(none)'}`,
    'Existing schedule (next ~6 weeks):',
    ...occ.map((o) => `- id=${o.eventId} date=${o.originalDate}${o.recurring ? ' (recurring)' : ''} ${o.allDay ? 'all-day' : `${o.startLocal?.slice(11)}-${o.endLocal?.slice(11)}`} "${o.title}" [${calendars.find((c) => c.id === o.calendarId)?.name ?? (o.ownerId === userId ? 'calendar' : 'partner')}]`),
    'Open tasks:',
    ...tasks.map((t) => `- id=${t.id} "${t.title}"${t.dueDate ? ` due ${t.dueDate}${t.dueTime ? ` ${t.dueTime}` : ''}` : ''}`),
  ].join('\n');

  const client = new Anthropic();
  // Server-side refusal fallback: if the model declines, the API retries on a fallback model.
  const response = await client.beta.messages.create({
    model: process.env.ANTHROPIC_MODEL || 'claude-opus-5-5',
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    max_tokens: 16000,
    output_config: { effort: 'medium' },
    system: SYSTEM,
    messages: [
      { role: 'user', content: `<context>\n${context}\n</context>` },
      { role: 'assistant', content: 'Understood. What would you like to plan?' },
      ...history.slice(-8),
      { role: 'user', content: message },
    ],
  } as Anthropic.Beta.MessageCreateParamsNonStreaming);

  if (response.stop_reason === 'refusal') throw new Error('The assistant declined this request.');
  const text = response.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
  const json = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('The assistant did not return a valid plan. Try rephrasing.');
  }
  const result = planSchema.safeParse(parsed);
  if (!result.success) throw new Error(`The assistant's plan failed validation: ${result.error.issues[0]?.message}`);
  return { plan: result.data as Plan, raw: text };
}
