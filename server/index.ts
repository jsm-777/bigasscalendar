import { openDb } from './db.ts';
import { createApp } from './app.ts';
import { pushConfigured, startScheduler } from './notify.ts';
import { assistantConfigured } from './assistant.ts';

const db = openDb();
const app = createApp(db);
const port = Number(process.env.PORT || 8787);
app.listen(port, () => {
  console.log(`Big Ass Calendar API on http://localhost:${port}`);
  console.log(`  Web push: ${pushConfigured() ? 'configured' : 'NOT configured (set VAPID_* in .env; in-app notifications still work)'}`);
  console.log(`  Planning assistant: ${assistantConfigured() ? 'configured' : 'not configured (JSON plan import still works)'}`);
});
startScheduler(db);
