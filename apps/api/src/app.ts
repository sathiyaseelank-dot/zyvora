import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './http/error-handler.js';
import { requestLogger } from './http/logger.js';
import { limiters } from './http/rate-limit.js';
import { catalogRouter } from './routes/catalog.js';

/**
 * Express application assembly — Story ZYV-28.
 *
 * Middleware order is load-bearing and is documented inline. The two rules:
 *   - `errorHandler` must be LAST so it catches every throw before it.
 *   - `requestLogger` runs early so even a rejected request is recorded.
 */

export function createApp(): Express {
  const app = express();

  // Trust the first proxy hop so req.ip and secure-cookie detection are
  // correct once this runs behind a reverse proxy in production. Rate limiting
  // keys on req.ip, so getting this wrong silently merges all clients into one
  // bucket.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

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

  // Required to read the `zyvora_session` cookie (ZYV-32).
  app.use(cookieParser());

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Correlation id on every request/response pair (ZYV-31).
  app.use(requestId());
  app.use(requestLogger());

  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'zyvora-api',
      env: env.NODE_ENV,
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  // Public catalog API — unauthenticated by design (ZYV-36). Rate limited at
  // the group level; the stricter auth/checkout limiters attach in E6/E7.
  app.use('/api', limiters.api, catalogRouter);

  // Terminal 404, then the single error handler.
  app.use(notFoundHandler());
  app.use(errorHandler);

  return app;
}

/** Attach a request id, echoing an inbound one so a trace survives a proxy. */
function requestId() {
  return (req: Request, res: Response, next: NextFunction) => {
    const inbound = req.get('x-request-id');
    const id = inbound && inbound.length <= 200 ? inbound : crypto.randomUUID();
    res.locals.requestId = id;
    res.setHeader('X-Request-Id', id);
    next();
  };
}
