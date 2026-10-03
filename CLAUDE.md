# Big Ass Calendar

Start by reading `HANDOFF.md`; it holds current status, architecture, decisions already made, and known gaps. The user's setup checklist is `NEXT_STEPS.md`.

- Stack: React 19 + Vite (`src/`), Express sign-in server (`server/`), shared TS (`shared/`). Data lives in Google Calendar/Tasks/Drive appdata; there is no database.
- Before pushing: `npm run typecheck && npm test && npm run build:vercel`.
- Vercel deploys `main`. Never commit `.env` or any keys.
- Don't re-litigate decisions in HANDOFF.md §5 (Google foundation, bold carousel UI, Google-delivered reminders, $0 cost).
