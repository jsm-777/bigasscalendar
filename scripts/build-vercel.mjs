// Builds a Vercel deployment with the Build Output API (v3):
//   .vercel/output/static           ← the Vite site (dist/)
//   .vercel/output/functions/api.func ← the Express API bundled into one Node function
//   .vercel/output/config.json      ← routes (+ the reminder cron job)
// Docs: https://vercel.com/docs/build-output-api/v3
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const out = '.vercel/output';
rmSync(out, { recursive: true, force: true });

execSync('npm run build', { stdio: 'inherit' });
mkdirSync(`${out}/static`, { recursive: true });
cpSync('dist', `${out}/static`, { recursive: true });

const fn = `${out}/functions/api.func`;
mkdirSync(fn, { recursive: true });
await build({
  entryPoints: ['server/vercel.ts'],
  outfile: `${fn}/index.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: false,
  // PGlite is only used for local development without DATABASE_URL.
  external: ['@electric-sql/pglite'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});
writeFileSync(`${fn}/.vc-config.json`, JSON.stringify({
  runtime: 'nodejs22.x',
  handler: 'index.mjs',
  launcherType: 'Nodejs',
  shouldAddHelpers: false,
  maxDuration: 60,
}, null, 2));

// Vercel Hobby only allows cron jobs that run once a day; Pro allows every minute.
// Set CRON_SCHEDULE in Vercel (e.g. "* * * * *" on Pro). See README → Deploying to Vercel.
const schedule = process.env.CRON_SCHEDULE || '0 13 * * *';
writeFileSync(`${out}/config.json`, JSON.stringify({
  version: 3,
  routes: [
    { src: '^/api/(.*)$', dest: '/api?__path=$1' },
    { handle: 'filesystem' },
    { src: '^/(?!api(?:/|$)).*$', dest: '/index.html' },
  ],
  crons: [{ path: '/api/cron', schedule }],
}, null, 2));
console.log(`Vercel output ready (cron: ${schedule}).`);
