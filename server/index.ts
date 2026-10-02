import { openDb } from './db.ts';
import { createApp } from './app.ts';
import { pushConfigured, startScheduler } from './notify.ts';
import { assistantConfigured } from './assistant.ts';

// Long-running server (local development or any always-on Node host).
// On Vercel the same app runs as a function (see api/handler.ts) and /api/cron drives reminders.
const db = await openDb();
const app = createApp(async () => db);
const port = Number(process.env.PORT || 8787);
app.listen(port, () => {
  console.log(`Big Ass Calendar API on http://localhost:${port}`);
  console.log(`  Database: ${process.env.DATABASE_URL || process.env.POSTGRES_URL ? 'Postgres (DATABASE_URL)' : `embedded PGlite at ${process.env.PGLITE_DIR || './data/pglite'}`}`);
  console.log(`  Web push: ${pushConfigured() ? 'configured' : 'NOT configured (set VAPID_* in .env; in-app notifications still work)'}`);
  console.log(`  Planning assistant: ${assistantConfigured() ? 'configured' : 'not configured (JSON plan import still works)'}`);
});
startScheduler(db);
