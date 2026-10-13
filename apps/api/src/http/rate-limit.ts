import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { AppError } from './errors.js';

/**
 * Rate limiting on sensitive routes — Story ZYV-29.
 *
 * Fixed-window, in-memory. Protects the auth and checkout endpoints that are
 * worth attacking: credential stuffing, coupon enumeration, order spam.
 *
 * LIMITATION (documented, not hidden): counters live in this process's heap,
 * so the effective limit is N × instances behind a load balancer. For a single
 * instance — the current deployment shape — this is exact. Before scaling
 * horizontally, replace the `Store` below with a shared backend (Redis) and
 * nothing else needs to change.
 */

export interface RateLimitOptions {
  /** Max requests allowed inside the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Bucket name; keeps independent route groups from sharing a counter. */
  name: string;
  /** Return 429 instead of blocking. Default true. */
  standardHeaders?: boolean;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export interface Store {
  hit(key: string, now: number, windowMs: number): Bucket;
  reset(): void;
}

export class MemoryStore implements Store {
  private readonly buckets = new Map<string, Bucket>();
  /** Bound on distinct keys so a spoofed-IP flood cannot grow the map forever. */
  private readonly maxKeys: number;

  constructor(maxKeys = 10_000) {
    this.maxKeys = maxKeys;
  }

  hit(key: string, now: number, windowMs: number): Bucket {
    const existing = this.buckets.get(key);

    // Absent, or the previous window has elapsed — start a new window.
    if (!existing || now >= existing.resetAt) {
      if (!existing && this.buckets.size >= this.maxKeys) {
        this.makeRoom(now);
      }
      const fresh: Bucket = { count: 1, resetAt: now + windowMs };
      this.buckets.set(key, fresh);
      return fresh;
    }

    existing.count += 1;
    return existing;
  }

  /**
   * Free at least one slot.
   *
   * Sweeping expired buckets is not enough on its own: when every bucket is
   * still inside its window, the sweep reclaims nothing and the map grows
   * without bound — exactly what happens under a spoofed-IP flood, since each
   * forged address gets its own live bucket. So when the sweep falls short,
   * the oldest bucket is evicted to make room. That trades a little rate-limit
   * accuracy for bounded memory, which is the right way round for a limiter
   * whose job is to resist an attacker.
   */
  private makeRoom(now: number): void {
    this.sweep(now);
    if (this.buckets.size < this.maxKeys) return;

    let oldestKey: string | undefined;
    let oldestResetAt = Infinity;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt < oldestResetAt) {
        oldestResetAt = bucket.resetAt;
        oldestKey = key;
      }
    }
    if (oldestKey !== undefined) this.buckets.delete(oldestKey);
  }

  private sweep(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (now >= bucket.resetAt) this.buckets.delete(key);
    }
  }

  /** Current entry count. Exposed so the bound can be asserted in tests. */
  get size(): number {
    return this.buckets.size;
  }

  reset(): void {
    this.buckets.clear();
  }
}

const stores = new Map<string, MemoryStore>();

function storeFor(name: string): MemoryStore {
  let store = stores.get(name);
  if (!store) {
    store = new MemoryStore();
    stores.set(name, store);
  }
  return store;
}

/** Clear all counters. Exposed for tests and for a manual unlock. */
export function resetRateLimits(): void {
  for (const store of stores.values()) store.reset();
}

/**
 * Build the rate-limit middleware for one route group.
 *
 * Keyed on IP only. Authenticated callers are not exempted: a stolen session
 * is exactly the case where a per-account limit matters.
 *
 * TRUST DEPENDENCY — this limiter is only as trustworthy as `req.ip`. If the
 * app is configured with `trust proxy` set, Express derives req.ip from the
 * client-supplied X-Forwarded-For header, and an attacker rotates that header
 * to get a fresh bucket per request. That completely defeats the limiter.
 *
 * The defence is `TRUST_PROXY=false` (the default) whenever the API is
 * reachable directly, and setting it to the true hop count only when the edge
 * proxy overwrites the header. See config/env.ts.
 */
export function rateLimit(options: RateLimitOptions): RequestHandler {
  const store = storeFor(options.name);

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    // Fall back to the raw socket address rather than req.ip: with
    // `trust proxy` enabled req.ip can be entirely client-controlled, while
    // socket.remoteAddress is whatever the TCP connection actually came from.
    const address = req.socket?.remoteAddress ?? 'unknown';
    const key = `${options.name}:${address}`;
    const bucket = store.hit(key, now, options.windowMs);

    const remaining = Math.max(0, options.limit - bucket.count);
    const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));

    if (options.standardHeaders !== false) {
      res.setHeader('RateLimit-Limit', String(options.limit));
      res.setHeader('RateLimit-Remaining', String(remaining));
      res.setHeader(
        'RateLimit-Reset',
        String(Math.ceil(bucket.resetAt / 1000)),
      );
    }

    if (bucket.count > options.limit) {
      res.setHeader('Retry-After', String(retryAfterSec));
      next(
        new AppError(
          'RATE_LIMITED',
          `Too many requests. Try again in ${retryAfterSec}s.`,
          { retryAfterSeconds: retryAfterSec, limit: options.limit },
        ),
      );
      return;
    }

    next();
  };
}

/**
 * Named limiters.
 *
 * Deliberately strict on credential endpoints and loose on ordinary reads.
 */
export const limiters = {
  /** Login/register/forgot-password — credential stuffing. */
  auth: rateLimit({ name: 'auth', limit: 10, windowMs: 15 * 60 * 1000 }),

  /** Order creation and payment initiation. */
  checkout: rateLimit({
    name: 'checkout',
    limit: 20,
    windowMs: 10 * 60 * 1000,
  }),

  /** Public catalog reads. */
  api: rateLimit({ name: 'api', limit: 300, windowMs: 60 * 1000 }),

  /** Password reset redemption — token brute force. */
  reset: rateLimit({ name: 'reset', limit: 5, windowMs: 15 * 60 * 1000 }),
};
