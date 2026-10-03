import type { AppData, Cal, Ev, ISODate, Reminders, Task, TaskList, UserInfo } from '../../shared/types.ts';
import type { Rule } from '../../shared/rrule.ts';

export type Scope = 'this' | 'following' | 'all';

/** What the event editor produces, expressed in the user's time zone. */
export interface EventInput {
  calendarId: string;
  title: string;
  allDay: boolean;
  startDate: ISODate;
  /** Inclusive. */
  endDate: ISODate;
  startTime: string; // HH:mm (timed only)
  endTime: string;
  location: string;
  description: string;
  rule: Rule | null;
  reminders: Reminders;
}

export interface Backend {
  kind: 'google' | 'demo';
  user(): Promise<UserInfo>;
  timeZone(): Promise<string>;
  calendars(): Promise<Cal[]>;
  events(cals: Cal[], from: ISODate, to: ISODate, tz: string): Promise<{ events: Ev[]; failed: string[] }>;
  /** Recurrence of the series an instance belongs to. */
  series(ev: Ev): Promise<Rule | null>;
  createEvent(input: EventInput, tz: string): Promise<void>;
  updateEvent(ev: Ev, input: EventInput, scope: Scope, tz: string): Promise<void>;
  deleteEvent(ev: Ev, scope: Scope): Promise<void>;
  taskLists(): Promise<TaskList[]>;
  tasks(lists: TaskList[]): Promise<Task[]>;
  createTask(t: Omit<Task, 'id' | 'completed'>): Promise<void>;
  updateTask(t: Task): Promise<void>;
  deleteTask(t: Task): Promise<void>;
  loadAppData(): Promise<AppData>;
  saveAppData(d: AppData): Promise<void>;
}
