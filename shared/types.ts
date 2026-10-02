// Shared record shapes used by the server API and the client.

export type ISODate = string; // YYYY-MM-DD (date-only, never time-zone shifted)
export type LocalDateTime = string; // YYYY-MM-DDTHH:mm (wall-clock time in `tz`)

export type ShareLevel = 'private' | 'freebusy' | 'details' | 'edit';

export interface Calendar {
  id: string;
  ownerId: string;
  name: string;
  color: string;
  archived: boolean;
  /** Visibility is a per-viewer preference, independent of ownership/sharing. */
  visible: boolean;
  /** Sharing level granted to the owner's partner (only meaningful to the owner). */
  shareLevel: ShareLevel;
  /** Access level the current viewer has. */
  access: 'owner' | ShareLevel;
  version: number;
}

export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7; // ISO: 1 = Monday … 7 = Sunday

export interface Recurrence {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  byWeekday?: Weekday[];
  byMonthDay?: number;
  count?: number;
  until?: ISODate;
}

export interface Alert {
  /** Minutes before start (events) or before due (tasks). */
  minutesBefore: number;
}

export interface EventOverride {
  title?: string;
  allDay?: boolean;
  startDate?: ISODate;
  endDate?: ISODate;
  startLocal?: LocalDateTime | null;
  endLocal?: LocalDateTime | null;
  location?: string;
  notes?: string;
  calendarId?: string;
}

export interface EventException {
  originalDate: ISODate;
  cancelled: boolean;
  override: EventOverride | null;
}

export interface CalEvent {
  id: string;
  ownerId: string;
  calendarId: string;
  title: string;
  allDay: boolean;
  /** Local start date (all-day: first day). */
  startDate: ISODate;
  /** Local end date, inclusive (all-day: last day). */
  endDate: ISODate;
  /** Timed events only. */
  startLocal: LocalDateTime | null;
  endLocal: LocalDateTime | null;
  tz: string;
  location: string;
  notes: string;
  recurrence: Recurrence | null;
  exceptions: EventException[];
  alerts: Alert[];
  taskId: string | null;
  goalId: string | null;
  /** True when shared as free/busy: details were removed by the server. */
  redacted?: boolean;
  version: number;
  updatedAt: string;
}

/** One concrete instance of an event (recurring or not) for display. */
export interface Occurrence {
  key: string; // `${eventId}:${originalDate}`
  eventId: string;
  originalDate: ISODate;
  title: string;
  calendarId: string;
  ownerId: string;
  allDay: boolean;
  startDate: ISODate;
  endDate: ISODate;
  startLocal: LocalDateTime | null;
  endLocal: LocalDateTime | null;
  tz: string;
  location: string;
  notes: string;
  recurring: boolean;
  isException: boolean;
  redacted?: boolean;
  taskId: string | null;
}

export interface TaskList {
  id: string;
  ownerId: string;
  name: string;
  color: string;
}

export type Priority = 0 | 1 | 2 | 3; // none, low, medium, high

export interface Task {
  id: string;
  ownerId: string;
  listId: string;
  title: string;
  notes: string;
  priority: Priority;
  dueDate: ISODate | null;
  /** HH:mm; null means a date-only task. */
  dueTime: string | null;
  tz: string;
  recurrence: Recurrence | null;
  completedAt: string | null;
  /** Alerts for timed tasks; date-only tasks use the preference default time. */
  alerts: Alert[];
  goalId: string | null;
  version: number;
  updatedAt: string;
}

export type NoteScope = 'day' | 'month' | 'loose';

export interface Note {
  id: string;
  ownerId: string;
  scope: NoteScope;
  /** day: YYYY-MM-DD; month: YYYY-MM; loose: '' */
  key: string;
  title: string;
  body: string;
  version: number;
  updatedAt: string;
}

export interface Goal {
  id: string;
  ownerId: string;
  title: string;
  color: string;
  mode: 'weekly' | 'daily';
  /** weekly mode: sessions per week. */
  weeklyTarget: number;
  /** daily mode: planned rest weekdays that never break the streak. */
  restDays: Weekday[];
  unit: string; // e.g. "minutes" (optional quantity label)
  archived: boolean;
  version: number;
}

export interface CheckIn {
  id: string;
  goalId: string;
  date: ISODate;
  quantity: number | null;
  reflection: string;
  /** Idempotency key; a repeated submission with the same key never double counts. */
  clientKey: string;
  createdAt: string;
}

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  tz: string;
}

export interface Partner {
  id: string;
  displayName: string;
  tz: string;
}

export interface NotificationPrefs {
  enabled: boolean;
  eventLeadMinutes: number;
  taskLeadMinutes: number;
  dateOnlyTaskTime: string; // HH:mm
  dailyAgenda: boolean;
  dailyAgendaTime: string; // HH:mm
  quietStart: string | null; // HH:mm
  quietEnd: string | null; // HH:mm
  showTitlesOnLockScreen: boolean;
  pushTarget: 'latest' | 'all';
  snoozeMinutes: number;
}

export interface InAppNotification {
  id: string;
  title: string;
  body: string;
  url: string;
  createdAt: string;
  readAt: string | null;
  jobId: string;
}
