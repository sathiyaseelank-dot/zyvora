import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import express from 'express';
import { z } from 'zod';

import { errorHandler, notFoundHandler } from '../src/http/error-handler.js';
import { validate, valid } from '../src/http/validate.js';
import { getJson, startServer } from './helpers.js';

/** ZYV-34 — Zod request validation middleware. */

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(12),
});

const bodySchema = z
  .object({
    email: z.string().email(),
    quantity: z.number().int().positive(),
  })
  // Unknown keys are stripped rather than silently accepted and ignored.
  .strict();

const app = express();
app.use(express.json());

app.get('/list', validate({ query: listQuerySchema }), (req, res) => {
  // Coercion and defaults from the schema must be visible here.
  res.json({ data: valid<z.infer<typeof listQuerySchema>>(req, 'query') });
});

app.post('/items', validate({ body: bodySchema }), (req, res) => {
  res.json({ data: valid<z.infer<typeof bodySchema>>(req, 'body') });
});

app.post(
  '/nested',
  validate({
    body: z.object({
      address: z.object({
        pinCode: z.string().regex(/^\d{6}$/, 'PIN must be 6 digits'),
      }),
    }),
  }),
  (req, res) => res.json({ data: valid(req, 'body') }),
);

app.use(notFoundHandler());
app.use(errorHandler);

describe('ZYV-34 Zod validation middleware', () => {
  it('coerces query strings and applies schema defaults', async () => {
    const client = await startServer(app);
    try {
      const res = await getJson(client, '/list?page=3');
      assert.equal(res.status, 200);
      assert.equal(res.body.data.page, 3);
      assert.equal(res.body.data.pageSize, 12, 'default was not applied');
      assert.equal(typeof res.body.data.page, 'number');
    } finally {
      await client.close();
    }
  });

  it('rejects a non-numeric page with a field-level message', async () => {
    const client = await startServer(app);
    try {
      const res = await getJson(client, '/list?page=abc');
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
      assert.ok(
        Array.isArray(res.body.error.details.fieldErrors['query.page']),
        'expected query.page field error',
      );
    } finally {
      await client.close();
    }
  });

  it('rejects a body that fails validation', async () => {
    const client = await startServer(app);
    try {
      const res = await getJson(client, '/items', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'not-an-email', quantity: 0 }),
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
      assert.ok(res.body.error.details.fieldErrors['body.email']);
      assert.ok(res.body.error.details.fieldErrors['body.quantity']);
    } finally {
      await client.close();
    }
  });

  it('rejects unknown fields under a strict schema', async () => {
    const client = await startServer(app);
    try {
      const res = await getJson(client, '/items', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'a@b.com', quantity: 1, sneaky: 'x' }),
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    } finally {
      await client.close();
    }
  });

  it('reports nested field paths so forms can highlight the input', async () => {
    const client = await startServer(app);
    try {
      const res = await getJson(client, '/nested', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address: { pinCode: '12' } }),
      });
      assert.equal(res.status, 400);
      assert.ok(
        res.body.error.details.fieldErrors['body.address.pinCode'],
        `expected nested path, got ${JSON.stringify(res.body.error.details)}`,
      );
    } finally {
      await client.close();
    }
  });

  it('accepts a valid body', async () => {
    const client = await startServer(app);
    try {
      const res = await getJson(client, '/items', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'a@b.com', quantity: 2 }),
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.data.quantity, 2);
    } finally {
      await client.close();
    }
  });
});
