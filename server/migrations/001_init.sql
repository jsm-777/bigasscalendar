-- Big Ass Calendar initial schema (SQLite). Times: *_at columns are UTC ISO strings;
-- *_date columns are local calendar dates; *_local columns are wall-clock times in `tz`.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  tz TEXT NOT NULL DEFAULT 'America/Los_Angeles',
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

-- Two people who have connected through an accepted invitation (WorkspaceMembership).
CREATE TABLE partnerships (
  user_a TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_a, user_b)
);

CREATE TABLE invitations (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  inviter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  accepted_at TEXT,
  revoked_at TEXT
);

CREATE TABLE calendars (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  -- CalendarPermission for the owner's partner: private | freebusy | details | edit
  share_level TEXT NOT NULL DEFAULT 'private',
  sort INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX calendars_owner ON calendars(owner_id);

-- Per-viewer visibility, independent of ownership and sharing.
CREATE TABLE calendar_visibility (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  visible INTEGER NOT NULL,
  PRIMARY KEY (user_id, calendar_id)
);

CREATE TABLE task_lists (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE goals (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  color TEXT NOT NULL,
  mode TEXT NOT NULL,
  weekly_target INTEGER NOT NULL DEFAULT 3,
  rest_days TEXT NOT NULL DEFAULT '[]',
  unit TEXT NOT NULL DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  list_id TEXT NOT NULL REFERENCES task_lists(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  priority INTEGER NOT NULL DEFAULT 0,
  due_date TEXT,
  due_time TEXT,
  tz TEXT NOT NULL,
  recurrence TEXT,
  completed_at TEXT,
  alerts TEXT NOT NULL DEFAULT '[]',
  goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX tasks_owner ON tasks(owner_id);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  all_day INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  start_local TEXT,
  end_local TEXT,
  tz TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  recurrence TEXT,
  alerts TEXT NOT NULL DEFAULT '[]',
  -- TaskTimeBlockLink: a time block scheduled for a task.
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX events_cal ON events(calendar_id, start_date);
CREATE INDEX events_owner ON events(owner_id, start_date);

CREATE TABLE event_exceptions (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  original_date TEXT NOT NULL,
  cancelled INTEGER NOT NULL DEFAULT 0,
  override TEXT,
  PRIMARY KEY (event_id, original_date)
);

CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope TEXT NOT NULL, -- day | month | loose
  key TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX notes_day_month ON notes(owner_id, scope, key) WHERE scope IN ('day', 'month');

CREATE TABLE check_ins (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  quantity REAL,
  reflection TEXT NOT NULL DEFAULT '',
  client_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (goal_id, client_key)
);

CREATE TABLE notification_prefs (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  prefs TEXT NOT NULL
);

CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  last_success_at TEXT,
  last_error TEXT
);

-- Durable notification jobs. dedupe_key makes planning idempotent.
CREATE TABLE notification_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, -- event | task | agenda | snooze | test
  source_type TEXT,
  source_id TEXT,
  dedupe_key TEXT NOT NULL,
  fire_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL, -- pending | sent | cancelled | expired
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, dedupe_key)
);
CREATE INDEX jobs_due ON notification_jobs(status, fire_at);

CREATE TABLE inapp_notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL UNIQUE REFERENCES notification_jobs(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read_at TEXT
);
CREATE INDEX inapp_user ON inapp_notifications(user_id, created_at);

CREATE TABLE notification_deliveries (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES notification_jobs(id) ON DELETE CASCADE,
  subscription_id TEXT NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  status TEXT NOT NULL, -- pending | sent | failed | suppressed
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  error TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (job_id, subscription_id)
);

CREATE TABLE plan_proposals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL, -- import | assistant
  plan TEXT NOT NULL,
  status TEXT NOT NULL, -- applied | undone
  undo TEXT,
  created_at TEXT NOT NULL,
  applied_at TEXT
);

-- Free-form per-user settings (planning constraints, display options).
CREATE TABLE user_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  settings TEXT NOT NULL
);
