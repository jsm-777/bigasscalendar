# Handoff: Big Ass Calendar

Read this first when you open the project in your local folder. It's written for you and for any AI assistant you work with.

**Last updated:** 2026-10-03 · **Branch:** `main` · **Version:** 2.0.0 (Google-based)

---

## 1. Where things stand

| Area | Status |
| --- | --- |
| Code | ✅ v2 complete and pushed to `main` (also on `claude/eloquent-gates-dp7qmt`) |
| Automated checks | ✅ type check, 26 tests, production Vercel build all pass |
| Demo mode | ✅ checked in a headless browser at phone (390px) and desktop (1440px) sizes |
| Vercel deploy | ⏳ waiting on you: set Production Branch to `main`, add env vars, redeploy |
| Google sign-in | ⏳ waiting on you: create the Google Cloud project and OAuth client (`docs/GOOGLE_SETUP.md`) |
| Real Google end-to-end | ❌ **not yet tested**: needs real keys. First thing to verify once step 3 of NEXT_STEPS is done |
| Phone testing on the live link | ❌ not yet done |

**Your to-do list:** [`NEXT_STEPS.md`](NEXT_STEPS.md) (checklist). **Google walkthrough:** [`docs/GOOGLE_SETUP.md`](docs/GOOGLE_SETUP.md).

---

## 2. Get it running locally

You need Node.js 22+ (check with `node -v`) and git.

```bash
git clone https://github.com/jsm-777/bigasscalendar.git   # skip if you already have the folder
cd bigasscalendar
git pull                      # get the latest
npm install
cp .env.example .env          # fill in Google values, or leave blank and use the demo
npm run dev                   # opens on http://localhost:5173
```

- **No Google keys yet?** Click **Try the demo**. Sample data stays in your browser's storage.
- **To sign in with Google locally:**
  1. Add `http://localhost:5173/api/auth/callback` as a redirect URI on the Google OAuth client.
  2. In `.env`, set `APP_ORIGIN=http://localhost:5173` plus the `GOOGLE_*`, `SESSION_SECRET` and `ALLOWED_EMAILS` values.

| Command | What it does |
| --- | --- |
| `npm run dev` | Web app on :5173 + API on :8787 (Vite proxies `/api`) |
| `npm test` | 26 tests (Vitest) |
| `npm run typecheck` | TypeScript check |
| `npm run build:vercel` | Exactly what Vercel runs; writes `.vercel/output/` |

Never commit `.env`; it's in `.gitignore`.

---

## 3. What the app is

A bold, phone-first planner on top of **Google Calendar + Google Tasks**. It opens on a swipeable carousel: **Day → Week → Year**.

- **Day:** colored date hero; schedule as color blocks with a "now" line; to-dos (overdue / due / no date); goal tiles with streaks and Check in; a daily note.
- **Week:** 7 day cards (phone) or 7 columns (desktop).
- **Year:** the signature 12-month × 31-day board, modeled on the physical tri-fold board. Events show as colored bars. Tap a day → Day view; tap a month → month notes. Range starts in September (Sep 2026 – Aug 2027 by default).
- **+ button:** add an event, to-do, goal, or month note.

**Where data lives:**

| Data | Stored in |
| --- | --- |
| Events | The user's real Google Calendars (read/write) |
| To-dos | Google Tasks (due dates are date-only, an API limit) |
| Goals, check-ins, day/month notes, hidden calendars, week-start preference | One JSON file (`big-ass-calendar.json`) in the Google Drive **appDataFolder**, private to this app |
| Reminders | Set on Google events; delivered by the Google Calendar app |
| Server | Stores **nothing**. The Google refresh token sits in an encrypted httpOnly cookie. |

**Users:** Jasmin and Tehron, on personal Gmail accounts. Sharing happens through Google Calendar's own sharing, and shared calendars appear automatically. `ALLOWED_EMAILS` restricts who can sign in.

---

## 4. How the code is organized

```
src/                    React 19 + Vite (browser)
  App.tsx               Landing page, demo/Google choice, shell with carousel + tabs + FAB
  store.tsx             App state + actions (loads calendars, events, tasks, Drive data)
  lib/backend.ts        Backend interface (what the UI needs)
  lib/google.ts         Real implementation: direct REST calls to Calendar/Tasks/Drive
  lib/demo.ts           In-memory implementation with sample data (same interface)
  lib/auth.ts           Gets short-lived access tokens from /api/auth/token
  lib/format.ts         Date/time display helpers
  views/                DayPanel, WeekPanel, YearPanel
  components/           Sheet (bottom sheet), EventSheet, Sheets (add/task/goal/notes/calendars/menu)
  styles.css            Whole design system (tokens on :root)
server/                 Express, sign-in only
  app.ts                /api/config, /api/health, /api/auth/{login,callback,token,logout}
  session.ts            AES-256-GCM cookie seal/unseal
  index.ts              Local dev server
  vercel.ts             Vercel function entry (restores the original /api path)
shared/                 Used by both sides
  dates.ts, rrule.ts, streaks.ts, types.ts
scripts/build-vercel.mjs  Vercel Build Output API: static site + one Node function + routes
tests/                  Vitest
```

**Key flows**

- **Sign-in:**
  1. `/api/auth/login` redirects to Google (offline access, consent prompt, state cookie).
  2. `/callback` exchanges the code, checks scopes and `ALLOWED_EMAILS`, and seals `{refreshToken, email, name}` into the `bac_s` cookie (180 days).
  3. The browser calls `POST /api/auth/token` (header `x-bac: 1`) for a 1-hour access token, then talks to Google directly.
- **Scopes:** `openid email profile`, `calendar`, `tasks`, `drive.appdata`.
- **Repeating events** (`google.ts → updateEvent / deleteEvent`):
  - *this*: patch or delete the instance.
  - *all*: patch the master, shifting its start by the same number of days.
  - *following*: set `UNTIL` on the master just before the occurrence, then insert a new series.
- **Time zones:** display uses the user's Google Calendar time zone (`users/me/settings/timezone`), via Luxon. All-day end dates from Google are exclusive and get converted to inclusive.
- **Saving Drive data:** debounced 700ms; status shown as "Saving… / Saved to Drive / Not saved · Retry".
- **Vercel routing:** `/api/(.*)` → `/api?__path=$1` → `server/vercel.ts` restores `req.url`.

**Design tokens** (in `styles.css`):
- Colors: coral `#ff4f5e`, blue `#2d6bff`, violet `#7b3ff2`, sun `#ffc531`, mint `#0fb88a`, pink `#ff5fa2`, ink `#16131c`, paper `#fff8ef`.
- Look: 2px ink borders with 4px offset "pop" shadows; heavy rounded system font.
- A dark set exists under `[data-theme="dark"]` but isn't switched on anywhere.

---

## 5. Decisions already made (don't re-ask)

- **Foundation:** Google Calendar + Tasks + Drive appdata. No database (Supabase was dropped).
- **Accounts:** personal Gmail, with Google app status **published** (unverified) to avoid 7-day sign-outs. `ALLOWED_EMAILS` restricts access.
- **Reminders:** Google's own. The app sends no push notifications.
- **Look:** bold & colorful. **Home:** a carousel that starts on Day, then Week, then Year.
- **Kept:** goals & streaks, notes. **Dropped:** moon phases, daily quote, AI "plan by typing", app push/cron, drag-and-drop.
- **Hosting:** Vercel Hobby (free), Production Branch = `main`.
- **Cost target:** $0. No Google billing account, no paid tiers.

---

## 6. Known gaps and ideas for next time

**Verify first (once Google keys exist):**
1. Sign in on a phone; events, tasks and goals load; creating, editing and deleting reflects in the Google apps.
2. Repeating-event edits (this / following / all) against real Google data. Only the demo has exercised these.
3. A calendar Tehron shares with Jasmin appears, and view-only calendars open read-only.

**Known limitations:**
- "This and following" doesn't carry one-off changes on later occurrences into the new series.
- Task due times aren't possible (Google Tasks API).
- Events load per 12-month board range (plus or minus a week). Very busy calendars could be slow on first load.
- Moving an event between calendars isn't supported for single occurrences (scope "this").
- No offline mode; Drive save errors show a Retry.
- No drag-and-drop, by decision, but it could come back.

**Possible next features:**
- Drag-and-drop on the Week and Year views.
- Dark mode toggle (tokens already exist).
- Swipe left/right inside the Day hero to change dates.
- A month view in the carousel.
- Quick-add parsing ("Dentist Tue 3pm").
- Showing calendar owner initials on the Year board for Tehron's events.

---

## 7. History

| When | What |
| --- | --- |
| v1 (`3e93817` → `b8e6d12`, tag **`v1-supabase`**) | Full custom app: own accounts, SQLite → Supabase Postgres, recurrence engine, web push and cron reminders, moon phases, AI planner. Superseded. |
| v2 (`1e18b7a`) | Rebuilt on Google Calendar/Tasks/Drive with the new bold carousel UI and demo mode. |
| `b6bde58` | Added `NEXT_STEPS.md`. |

To look at the old version: `git checkout v1-supabase` (then `git checkout main` to come back).

---

## 8. Working conventions

- Develop on a branch and merge or push to `main` to deploy. Vercel builds `main`.
- Before pushing, run `npm run typecheck && npm test && npm run build:vercel`.
- Never commit secrets. Keys live only in `.env` (local) and Vercel env vars.
- Keep the year board's look: 12 rows × 31 day columns, weekday letter in each cell, hatched invalid dates, color bars.
