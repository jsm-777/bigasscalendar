import { createApp, googleConfigured } from './app.ts';

// Local development server (Vite proxies /api here). On Vercel the same app runs as a function.
const port = Number(process.env.PORT || 8787);
createApp().listen(port, () => {
  console.log(`Big Ass Calendar API on http://localhost:${port}`);
  console.log(`  Google sign-in: ${googleConfigured() ? 'configured' : 'NOT configured — demo mode only (see docs/GOOGLE_SETUP.md)'}`);
});
