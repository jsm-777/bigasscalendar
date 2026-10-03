export type ISODate = string; // YYYY-MM-DD
export type LocalDateTime = string; // YYYY-MM-DDTHH:mm
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7; // ISO: 1 = Monday … 7 = Sunday

/** A Google calendar visible to the signed-in user. */
export interface Cal {
  id: string;
  summary: string;
  color: string;
  textColor: string;
  accessRole: 'owner' | 'writer' | 'reader' | 'freeBusyReader';
  primary: boolean;
}

export interface Reminders {
  useDefault: boolean;
  overrides: { method: 'popup' | 'email'; minutes: number }[];
}

/** One event instance (recurring series are expanded by Google). */
export interface Ev {
  id: string;
  calendarId: string;
  title: string;
  allDay: boolean;
  /** Local dates in the user's zone; endDate is inclusive. */
  startDate: ISODate;
  endDate: ISODate;
  /** Timed events only: YYYY-MM-DDTHH:mm in the user's zone. */
  startLocal: string | null;
  endLocal: string | null;
  location: string;
  description: string;
  /** Set on instances of a recurring series. */
  recurringEventId: string | null;
  /** Instances: the occurrence's original start (Google's originalStartTime). */
  originalStart: string | null;
  reminders: Reminders;
  /** True for calendars shared as free/busy only (no details). */
  busyOnly: boolean;
  colorOverride: string | null;
  htmlLink: string;
}

export interface TaskList {
  id: string;
  title: string;
}

export interface Task {
  id: string;
  listId: string;
  title: string;
  notes: string;
  /** Google Tasks due dates are date-only. */
  due: ISODate | null;
  completed: boolean;
}

export interface Goal {
  id: string;
  title: string;
  color: string;
  mode: 'weekly' | 'daily';
  weeklyTarget: number;
  restDays: Weekday[];
  archived: boolean;
}

export interface CheckIn {
  id: string;
  goalId: string;
  date: ISODate;
  note: string;
  /** Idempotency key: the same key never counts twice. */
  clientKey: string;
}

/** Private app data stored as one JSON file in the user's Google Drive app folder. */
export interface AppData {
  version: 1;
  goals: Goal[];
  checkIns: CheckIn[];
  dayNotes: Record<ISODate, string>;
  monthNotes: Record<string, string>;
  hiddenCalendars: string[];
  weekStartsOn: 1 | 7;
}

export const EMPTY_APP_DATA: AppData = {
  version: 1,
  goals: [],
  checkIns: [],
  dayNotes: {},
  monthNotes: {},
  hiddenCalendars: [],
  weekStartsOn: 7,
};

export interface UserInfo {
  email: string;
  name: string;
  picture: string | null;
}
