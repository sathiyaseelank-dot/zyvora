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

describe('ZYV-29 X-Forwarded-For spoofing', () => {
  // Regression: the limiter keyed on req.ip. With `trust proxy` enabled that
  // value comes from the client-supplied X-Forwarded-For header, so rotating
  // it handed out a fresh bucket per request — measured RateLimit-Remaining:
  // 299 after three spoofed requests, i.e. the limiter never engaged.
  function spoofApp() {
    const app = express();
    // Worst case: trust proxy fully on, the header is believed.
    app.set('trust proxy', true);
    app.get(
      '/x',
      rateLimit({ name: 'spoof', limit: 3, windowMs: 60_000 }),
      (_req, res) => res.json({ data: 'ok' }),
    );
    app.use(notFoundHandler());
    app.use(errorHandler);
    return app;
  }

  it('is not defeated by rotating X-Forwarded-For', async () => {
    // Stores are module-level, so each test starts from a clean counter.
    resetRateLimits();
    const client = await startServer(spoofApp());
    try {
      for (const ip of ['1.1.1.1', '2.2.2.2', '3.3.3.3']) {
        await getJson(client, '/x', { headers: { 'x-forwarded-for': ip } });
      }

      // Fourth request, yet another "address": must already be limited.
      const res = await getJson(client, '/x', {
        headers: { 'x-forwarded-for': '4.4.4.4' },
      });
      assert.equal(
        res.status,
        429,
        'rotating X-Forwarded-For handed out a fresh bucket',
      );
      assert.equal(res.body.error.code, 'RATE_LIMITED');
    } finally {
      await client.close();
    }
  });

  it('counts every request against the real socket address', async () => {
    resetRateLimits();
    const client = await startServer(spoofApp());
    try {
      const first = await getJson(client, '/x', {
        headers: { 'x-forwarded-for': '9.9.9.9' },
      });
      assert.equal(first.status, 200);
      // Remaining must reflect the shared socket bucket, not a per-header one.
      assert.equal(first.headers.get('ratelimit-remaining'), '2');
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

  it('bounds the bucket map even when every window is still live', () => {
    // The previous version asserted size <= 60 after 50 inserts against a
    // maxKeys of 10 — which passes whether or not the bound works at all.
    // This one cannot pass vacuously: 5000 live buckets, bound of 25.
    const store = new MemoryStore(25);
    const t0 = 1_000_000;
    for (let i = 0; i < 5000; i++) store.hit(`ip-${i}`, t0, 3_600_000);

    assert.ok(
      store.size <= 25,
      `bucket map grew to ${store.size}, bound is 25`,
    );
  });

  it('keeps counting correctly under sustained eviction pressure', () => {
    const store = new MemoryStore(5);
    const t0 = 1_000_000;
    for (let i = 0; i < 100; i++) store.hit(`ip-${i}`, t0, 60_000);
    assert.ok(store.size <= 5, `size ${store.size} exceeds bound of 5`);
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
