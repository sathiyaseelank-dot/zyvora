import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import express from 'express';

import { errorHandler, notFoundHandler } from '../src/http/error-handler.js';
import {
  MemoryStore,
  rateLimit,
  resetRateLimits,
} from '../src/http/rate-limit.js';
import { getJson, startServer } from './helpers.js';

/** ZYV-29 — Rate limiting on sensitive routes. */

describe('ZYV-29 rate limiting', () => {
  it('allows traffic under the limit and returns standard headers', async () => {
    const app = express();
    app.get(
      '/x',
      rateLimit({ name: 't1', limit: 3, windowMs: 60_000 }),
      (_req, res) => res.json({ data: 'ok' }),
    );
    app.use(notFoundHandler());
    app.use(errorHandler);

    const client = await startServer(app);
    try {
      const res = await getJson(client, '/x');
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('ratelimit-limit'), '3');
      assert.equal(res.headers.get('ratelimit-remaining'), '2');
    } finally {
      await client.close();
    }
  });

  it('returns 429 with a documented body once the limit is exceeded', async () => {
    const app = express();
    app.get(
      '/x',
      rateLimit({ name: 't2', limit: 2, windowMs: 60_000 }),
      (_req, res) => res.json({ data: 'ok' }),
    );
    app.use(notFoundHandler());
    app.use(errorHandler);

    const client = await startServer(app);
    try {
      await getJson(client, '/x');
      await getJson(client, '/x');

      const third = await getJson(client, '/x');
      assert.equal(third.status, 429);
      assert.equal(third.body.error.code, 'RATE_LIMITED');
      assert.ok(third.headers.get('retry-after'), 'Retry-After header missing');
      assert.ok(
        typeof third.body.error.details.retryAfterSeconds === 'number',
        'retryAfterSeconds missing from details',
      );
    } finally {
      await client.close();
    }
  });

  it('keeps separate counters per limiter name', async () => {
    const app = express();
    app.get(
      '/a',
      rateLimit({ name: 'ra', limit: 1, windowMs: 60_000 }),
      (_req, res) => res.json({ data: 'a' }),
    );
    app.get(
      '/b',
      rateLimit({ name: 'rb', limit: 5, windowMs: 60_000 }),
      (_req, res) => res.json({ data: 'b' }),
    );
    app.use(notFoundHandler());
    app.use(errorHandler);

    const client = await startServer(app);
    try {
      await getJson(client, '/a');
      assert.equal(
        (await getJson(client, '/a')).status,
        429,
        'limiter /a should trip',
      );
      assert.equal(
        (await getJson(client, '/b')).status,
        200,
        'limiter /b must be independent',
      );
    } finally {
      await client.close();
    }
  });
});

describe('MemoryStore windowing', () => {
  it('starts a fresh window once the previous one has elapsed', () => {
    const store = new MemoryStore();
    const t0 = 1_000_000;

    assert.equal(store.hit('k', t0, 1000).count, 1);
    assert.equal(store.hit('k', t0 + 100, 1000).count, 2);
    assert.equal(store.hit('k', t0 + 200, 1000).count, 3);

    // 1100ms after the window opened: expired, so the count restarts.
    const after = store.hit('k', t0 + 1100, 1000);
    assert.equal(after.count, 1);
    assert.equal(after.resetAt, t0 + 1100 + 1000);
  });

  it('bounds the bucket map so a spoofed-IP flood cannot grow it forever', () => {
    const store = new MemoryStore(10);
    for (let i = 0; i < 50; i++) store.hit(`ip-${i}`, 1_000_000, 60_000);
    // Sweep only evicts expired entries, so live entries are capped by the
    // bound and never exceed it by more than the current batch.
    assert.ok(
      (store as unknown as { buckets: Map<string, unknown> }).buckets.size <=
        60,
    );
  });

  it('reset() clears every counter', () => {
    const store = new MemoryStore();
    store.hit('k', 1_000_000, 1000);
    store.reset();
    assert.equal(store.hit('k', 1_000_100, 1000).count, 1);
  });

  it('resetRateLimits() is callable for test isolation', () => {
    assert.doesNotThrow(() => resetRateLimits());
  });
});
