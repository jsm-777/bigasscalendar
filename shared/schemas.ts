import { z } from 'zod';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const local = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Expected YYYY-MM-DDTHH:mm');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:mm');
const weekday = z.number().int().min(1).max(7);

export const tzSchema = z.string().min(1).refine((tz) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, 'Unknown IANA time zone');

export const recurrenceSchema = z.object({
  freq: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
  interval: z.number().int().min(1).max(366),
  byWeekday: z.array(weekday).max(7).optional(),
  byMonthDay: z.number().int().min(1).max(31).optional(),
  count: z.number().int().min(1).max(5000).optional(),
  until: date.optional(),
});

export const alertSchema = z.object({ minutesBefore: z.number().int().min(0).max(60 * 24 * 14) });

export const overrideSchema = z.object({
  title: z.string().max(300).optional(),
  allDay: z.boolean().optional(),
  startDate: date.optional(),
  endDate: date.optional(),
  startLocal: local.nullable().optional(),
  endLocal: local.nullable().optional(),
  location: z.string().max(500).optional(),
  notes: z.string().max(20000).optional(),
  calendarId: z.string().optional(),
});

export const eventSchema = z
  .object({
    id: z.string().min(1).max(64),
    calendarId: z.string().min(1),
    title: z.string().trim().min(1, 'Title is required').max(300),
    allDay: z.boolean(),
    startDate: date,
    endDate: date,
    startLocal: local.nullable(),
    endLocal: local.nullable(),
    tz: tzSchema,
    location: z.string().max(500).default(''),
    notes: z.string().max(20000).default(''),
    recurrence: recurrenceSchema.nullable(),
    exceptions: z
      .array(z.object({ originalDate: date, cancelled: z.boolean(), override: overrideSchema.nullable() }))
      .max(2000)
      .default([]),
    alerts: z.array(alertSchema).max(10).default([]),
    taskId: z.string().nullable().default(null),
    goalId: z.string().nullable().default(null),
    version: z.number().int().min(0),
  })
  .superRefine((e, ctx) => {
    if (e.endDate < e.startDate) ctx.addIssue({ code: 'custom', message: 'End date is before start date' });
    if (!e.allDay) {
      if (!e.startLocal || !e.endLocal) ctx.addIssue({ code: 'custom', message: 'Timed events need start and end' });
      else if (e.endLocal < e.startLocal) ctx.addIssue({ code: 'custom', message: 'End is before start' });
      else if (e.startLocal.slice(0, 10) !== e.startDate || e.endLocal.slice(0, 10) !== e.endDate)
        ctx.addIssue({ code: 'custom', message: 'Dates do not match times' });
    }
  });

export const eventBatchSchema = z.object({
  upserts: z.array(eventSchema).max(200),
  deletes: z.array(z.object({ id: z.string(), version: z.number().int() })).max(200),
});

export const taskSchema = z.object({
  id: z.string().min(1).max(64),
  listId: z.string().min(1),
  title: z.string().trim().min(1, 'Title is required').max(300),
  notes: z.string().max(20000).default(''),
  priority: z.number().int().min(0).max(3),
  dueDate: date.nullable(),
  dueTime: time.nullable(),
  tz: tzSchema,
  recurrence: recurrenceSchema.nullable(),
  completedAt: z.string().nullable(),
  alerts: z.array(alertSchema).max(10).default([]),
  goalId: z.string().nullable().default(null),
  version: z.number().int().min(0),
});

export const noteSchema = z.object({
  id: z.string().min(1).max(64),
  scope: z.enum(['day', 'month', 'loose']),
  key: z.string().max(10),
  title: z.string().max(300).default(''),
  body: z.string().max(100000),
  version: z.number().int().min(0),
});

export const goalSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().trim().min(1).max(200),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  mode: z.enum(['weekly', 'daily']),
  weeklyTarget: z.number().int().min(1).max(50),
  restDays: z.array(weekday).max(6),
  unit: z.string().max(40).default(''),
  archived: z.boolean().default(false),
  version: z.number().int().min(0),
});

export const checkInSchema = z.object({
  id: z.string().min(1).max(64),
  goalId: z.string(),
  date,
  quantity: z.number().min(0).max(100000).nullable(),
  reflection: z.string().max(5000).default(''),
  clientKey: z.string().min(1).max(120),
});

export const calendarSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  archived: z.boolean().default(false),
  shareLevel: z.enum(['private', 'freebusy', 'details', 'edit']),
  version: z.number().int().min(0),
});

export const prefsSchema = z.object({
  enabled: z.boolean(),
  eventLeadMinutes: z.number().int().min(0).max(10080),
  taskLeadMinutes: z.number().int().min(0).max(10080),
  dateOnlyTaskTime: time,
  dailyAgenda: z.boolean(),
  dailyAgendaTime: time,
  quietStart: time.nullable(),
  quietEnd: time.nullable(),
  showTitlesOnLockScreen: z.boolean(),
  pushTarget: z.enum(['latest', 'all']),
  snoozeMinutes: z.number().int().min(1).max(1440),
});

// ---- Plan import (chat-assisted planning) ----
// A plan is a list of typed operations. Nothing changes until the user previews and applies.

const target = z.object({
  eventId: z.string(),
  /** For recurring events: the original date of the occurrence to change. */
  occurrenceDate: date.optional(),
  scope: z.enum(['this', 'following', 'all']).optional(),
});

export const planOpSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('create_event'),
    calendar: z.string().min(1).describe('Calendar name or id'),
    title: z.string().min(1).max(300),
    date: date,
    endDate: date.optional(),
    start: time.optional(),
    end: time.optional(),
    allDay: z.boolean().optional(),
    location: z.string().max(500).optional(),
    notes: z.string().max(5000).optional(),
    recurrence: recurrenceSchema.optional(),
    alertMinutesBefore: z.array(z.number().int().min(0).max(20160)).max(5).optional(),
  }),
  target.extend({ op: z.literal('move_event'), newDate: date.optional(), newStart: time.optional() }),
  target.extend({ op: z.literal('resize_event'), newEnd: time }),
  target.extend({ op: z.literal('delete_event') }),
  target.extend({ op: z.literal('set_event_alert'), minutesBefore: z.array(z.number().int().min(0).max(20160)).max(5) }),
  z.object({
    op: z.literal('create_task'),
    list: z.string().optional(),
    title: z.string().min(1).max(300),
    dueDate: date.optional(),
    dueTime: time.optional(),
    priority: z.number().int().min(0).max(3).optional(),
    notes: z.string().max(5000).optional(),
    remind: z.boolean().optional(),
  }),
  z.object({ op: z.literal('complete_task'), taskId: z.string() }),
  z.object({ op: z.literal('set_task_due'), taskId: z.string(), dueDate: date.nullable(), dueTime: time.nullable().optional() }),
]);

export const planSchema = z.object({
  version: z.literal(1),
  summary: z.string().max(1000).optional(),
  /** Questions the planner needs answered before the plan can be trusted. */
  questions: z.array(z.string().max(500)).max(10).optional(),
  operations: z.array(planOpSchema).max(100),
});

export type Plan = z.infer<typeof planSchema>;
export type PlanOp = z.infer<typeof planOpSchema>;
