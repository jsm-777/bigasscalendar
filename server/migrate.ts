import { openDb, migrate } from './db.ts';
const db = openDb();
const ran = migrate(db);
console.log(ran.length ? `Applied: ${ran.join(', ')}` : 'Database is up to date.');
