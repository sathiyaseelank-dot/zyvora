import { createApp } from './app.js';
import { env } from './config/env.js';
import { db } from './db/client.js';
import { logger } from './http/logger.js';
import { warmupPasswordHasher } from './auth/password.js';

/**
 * Server lifecycle — Story ZYV-28.
 *
 * Config is validated at boot (config/env.ts throws before this file runs past
 * its import), SIGTERM/SIGINT drain in-flight work, and a hard timeout stops a
 * wedged connection from blocking a deploy forever.
 */

/** Hard cap on how long a graceful shutdown may take before we force exit. */
const DRAIN_TIMEOUT_MS = 10_000;

async function start(): Promise<void> {
  // Equalise login timing before the first request, so an unknown account
  // never costs more than a real one on a cold process.
  await warmupPasswordHasher();

  const app = createApp();

  const server = app.listen(env.PORT, () => {
    logger.info('server listening', {
      port: env.PORT,
      env: env.NODE_ENV,
      pid: process.pid,
    });
  });

  // Without this a keep-alive connection can hold the process open past the
  // platform's SIGKILL, so the deploy races the next release.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      logger.warn('shutdown already in progress', { signal });
      return;
    }
    shuttingDown = true;
    logger.info('shutdown started', { signal });

    // Backstop: if the drain below hangs, exit anyway rather than being killed
    // mid-write.
    const hardStop = setTimeout(() => {
      logger.error('forced shutdown after drain timeout', {
        timeoutMs: DRAIN_TIMEOUT_MS,
      });
      process.exit(1);
    }, DRAIN_TIMEOUT_MS);
    hardStop.unref();

    // 1. Stop accepting connections and let in-flight requests finish.
    await new Promise<void>((resolve) => {
      server.close((err) => {
        if (err)
          logger.error('error while closing server', { error: err.message });
        resolve();
      });
    });

    // 2. Release database handles, or the pool keeps the event loop alive.
    try {
      await db.destroy();
      logger.info('database pool closed');
    } catch (err) {
      logger.error('error while closing database pool', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    clearTimeout(hardStop);
    logger.info('shutdown complete', { signal });
    process.exit(0);
  };

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      void shutdown(signal);
    });
  }

  // An unhandled rejection means an async path lost its .catch. Log it; do not
  // silently continue in a possibly-corrupt state.
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled promise rejection', {
      reason: reason instanceof Error ? reason.message : String(reason),
    });
  });
}

start().catch((err) => {
  logger.error('failed to start', {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
