import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import cors from 'cors';
import helmet from 'helmet';

import { env } from './config/env.js';
import { catalogRouter } from './routes/catalog.js';

export function createApp(): Express {
  const app = express();

  // Trust the first proxy hop so req.ip and secure-cookie detection are
  // correct once this runs behind a reverse proxy in production.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // Security headers
  app.use(
    helmet({
      contentSecurityPolicy: env.NODE_ENV === 'production' ? undefined : false,
    }),
  );

  app.use(
    cors({
      origin: env.CORS_ORIGINS,
      credentials: true, // required for the session cookie described in ADR-001
    }),
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Request logging
  app.use((req: Request, _res: Response, next: NextFunction) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });

  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'zyvora-api',
      env: env.NODE_ENV,
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  // Public catalog API (unauthenticated — ZYV-36).
  app.use('/api', catalogRouter);

  // Terminal 404 for unmatched API routes.
  app.use((req: Request, res: Response) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: `No route for ${req.method} ${req.path}`,
      },
    });
  });

  // ZYV-39: central error handling with typed responses.
  // Must be registered last so it catches errors thrown by earlier middleware.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    void _next;
    const message = err instanceof Error ? err.message : 'Unexpected error';
    if (env.LOG_LEVEL === 'debug' || env.LOG_LEVEL === 'error') {
      console.error('[api] unhandled error:', err);
    }
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message } });
  });

  return app;
}
