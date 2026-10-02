import { openDb } from './db.ts';
const db = await openDb();
console.log('Database is up to date.');
await db.close?.();
