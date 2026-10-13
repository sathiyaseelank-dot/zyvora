import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import express from 'express';

import { errorHandler, notFoundHandler } from '../src/http/error-handler.js';
import { AppError } from '../src/http/errors.js';
import { asyncHandler } from '../src/http/async-handler.js';
import { getJson, startServer } from './helpers.js';

/** ZYV-39 — central error handling with typed responses. */

function buildApp(mode: 'dev' | 'production') {
  const app = express();
  app.use(express.json());

  app.get('/boom', () => {
    throw new Error('a very internal detail: db password is hunter2');
  });

  app.get(
    '/async-boom',
    asyncHandler(async () => {
      throw new Error('rejected inside an async handler');
    }),
  );

  app.get('/typed', () => {
    throw new AppError('FORBIDDEN', 'You cannot touch that');
  });

  app.get('/with-details', () => {
    throw new AppError('VALIDATION_ERROR', 'Bad input', {
      fieldErrors: { email: ['must be an email'] },
    });
  });

  app.use(notFoundHandler());
  app.use(errorHandler);
  // mode only documents intent; env.NODE_ENV drives the real behaviour.
  void mode;
  return app;
}

describe('ZYV-39 central error handling', () => {
  it('maps an unexpected throw to 500 INTERNAL_ERROR', async () => {
    const client = await startServer(buildApp('dev'));
    try {
      const res = await getJson(client, '/boom');
      assert.equal(res.status, 500);
      assert.equal(res.body.error.code, 'INTERNAL_ERROR');
    } finally {
      await client.close();
    }
  });

  it('rejects an async rejection instead of hanging the request', async () => {
    const client = await startServer(buildApp('dev'));
    try {
      const res = await getJson(client, '/async-boom');
      assert.equal(res.status, 500);
      assert.equal(res.body.error.code, 'INTERNAL_ERROR');
    } finally {
      await client.close();
    }
  });

  it('preserves the status and code of a typed AppError', async () => {
    const client = await startServer(buildApp('dev'));
    try {
      const res = await getJson(client, '/typed');
      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, 'FORBIDDEN');
      assert.equal(res.body.error.message, 'You cannot touch that');
    } finally {
      await client.close();
    }
  });

  it('passes structured details through untouched', async () => {
    const client = await startServer(buildApp('dev'));
    try {
      const res = await getJson(client, '/with-details');
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
      assert.deepEqual(res.body.error.details, {
        fieldErrors: { email: ['must be an email'] },
      });
    } finally {
      await client.close();
    }
  });

  it('returns 404 with the standard envelope for an unmatched route', async () => {
    const client = await startServer(buildApp('dev'));
    try {
      const res = await getJson(client, '/no-such-route');
      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, 'NOT_FOUND');
      assert.match(res.body.error.message, /GET \/no-such-route/);
    } finally {
      await client.close();
    }
  });

  it('never leaks a stack trace to the client', async () => {
    const client = await startServer(buildApp('dev'));
    try {
      const res = await getJson(client, '/boom');
      const serialised = JSON.stringify(res.body);
      assert.ok(!serialised.includes('at Object.'), 'stack frames leaked');
      assert.ok(!('stack' in res.body.error), 'stack key present in response');
    } finally {
      await client.close();
    }
  });
});
