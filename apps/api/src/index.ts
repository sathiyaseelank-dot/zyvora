import { createApp } from './app.js';
import { env } from './config/env.js';

async function start(): Promise<void> {
  const app = createApp();

  const server = app.listen(env.PORT, () => {
    console.log(
      `[api] zyvora-api listening on http://localhost:${env.PORT} (${env.NODE_ENV})`,
    );
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[api] ${signal} received — draining connections`);
    server.close((err) => {
      if (err) {
        console.error('[api] error while closing server:', err);
        process.exit(1);
      }
      console.log('[api] shutdown complete');
      process.exit(0);
    });
    // Hard stop if connections refuse to drain.
    setTimeout(() => {
      console.error('[api] forced shutdown after 10s drain timeout');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch((err) => {
  console.error('[api] failed to start:', err);
  process.exit(1);
});
