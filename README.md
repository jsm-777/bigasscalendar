# Big Ass Calendar

A bold, phone-first planner built on **Google Calendar + Google Tasks**. Swipe between **Day → Week → Year**: the year view is the signature 12-month × 31-day board.

- **Events** are your real Google Calendar events, so they show up in the Google Calendar app too, and Google sends the reminders.
- **To-dos** are Google Tasks.
- **Goals, streaks and notes** are saved privately in a hidden app folder in your Google Drive.
- **Sharing:** calendars shared with you in Google (for example Tehron's) appear automatically.

**Try it without signing in:** open the site and tap **Try the demo**. Sample data stays in your browser.

## Set up Google sign-in

Follow **[docs/GOOGLE_SETUP.md](docs/GOOGLE_SETUP.md)**. It's a one-time, ~10-minute setup in Google Cloud, plus five environment variables in Vercel.

## How it works

| Part | What it does |
| --- | --- |
| `src/` (React + Vite) | The UI: swipeable Day/Week/Year carousel, sheets for events, to-dos, goals and notes. Calls Google's APIs directly from the browser with a short-lived access token. |
| `server/` (Express) | Sign-in only: the Google OAuth code flow, plus `/api/auth/token`, which turns the stored refresh token into a short-lived access token. The refresh token lives in an AES-256-GCM-encrypted, httpOnly cookie, so there is **no database**. |
| `shared/` | Date helpers, repeat-rule (RRULE) helpers, streak rules, types. |
| `scripts/build-vercel.mjs` | Builds the Vercel deployment: the static site plus one small Node function for `/api/*`. |

**Repeating events:** edits ask "only this event / this and following / all".
- *This* edits that single occurrence in Google.
- *All* edits the whole series.
- *This and following* ends the old series the day before and starts a new one.

**Google scopes:** `calendar`, `tasks`, and `drive.appdata` (a private folder only this app can see), plus basic profile/email.

## Local development

```bash
npm install
cp .env.example .env     # fill in the Google values, or leave empty to use the demo only
npm run dev              # http://localhost:5173 (API on :8787)
```

- `npm test`: unit and API tests. They cover the session cookie, OAuth flow and allow-list, Google event mapping (time zones, all-day ranges, free/busy privacy), repeat rules, streaks and dates.
- `npm run build:vercel`: the production build Vercel runs.

## Deploying

Vercel runs `npm run build:vercel` (configured in `vercel.json`).
- The production branch should be **`main`**: Vercel → Settings → Git → Production Branch.
- After adding the environment variables, redeploy.

The previous Supabase-based version is preserved in git as tag `v1-supabase`.
