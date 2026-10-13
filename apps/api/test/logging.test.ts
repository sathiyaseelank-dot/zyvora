import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isSensitiveKey, redact, REDACTED } from '../src/http/logger.js';

/**
 * ZYV-31 — request logging and audit hooks.
 * Acceptance criterion: "No secrets or passwords logged".
 */

describe('ZYV-31 log redaction', () => {
  it('flags the obvious credential keys', () => {
    for (const key of [
      'password',
      'password_hash',
      'confirmPassword',
      'token',
      'accessToken',
      'authorization',
      'cookie',
      'sessionId',
      'apiKey',
      'secret',
      'razorpaySecret',
      'cvv',
      'otp',
    ]) {
      assert.ok(isSensitiveKey(key), `${key} should be treated as sensitive`);
    }
  });

  it('does not flag ordinary fields', () => {
    for (const key of ['email', 'name', 'quantity', 'price', 'page', 'ip']) {
      assert.ok(!isSensitiveKey(key), `${key} should not be redacted`);
    }
  });

  it('replaces sensitive values at the top level', () => {
    const out = redact({ email: 'a@b.com', password: 'hunter2' }) as Record<
      string,
      unknown
    >;
    assert.equal(out.email, 'a@b.com');
    assert.equal(out.password, REDACTED);
  });

  it('replaces sensitive values nested deep in objects and arrays', () => {
    const input = {
      user: { profile: { name: 'x', password_hash: 'argon2$abc' } },
      orders: [{ total: 100, paymentToken: 'tok_secret' }],
    };
    const out = redact(input) as {
      user: { profile: { name: string; password_hash: string } };
      orders: { total: number; paymentToken: string }[];
    };

    assert.equal(out.user.profile.name, 'x');
    assert.equal(out.user.profile.password_hash, REDACTED);
    assert.equal(out.orders[0].total, 100);
    assert.equal(out.orders[0].paymentToken, REDACTED);
  });

  it('leaves the original object untouched', () => {
    const input = { password: 'hunter2' };
    redact(input);
    assert.equal(input.password, 'hunter2');
  });

  it('survives a circular reference instead of throwing', () => {
    const input: Record<string, unknown> = { name: 'root' };
    input.self = input;

    // A logging helper must never take down the request it is describing.
    const out = redact(input) as Record<string, unknown>;
    assert.equal(out.name, 'root');
    assert.equal(out.self, '[Circular]');
  });

  it('preserves a shared reference that is NOT a cycle', () => {
    // Regression: cycle detection used a monotonic "seen" set, so any object
    // referenced twice was reported as [Circular]. An audit entry passing the
    // same object as oldValues and newValues recorded the second one as
    // "[Circular]", destroying the audit record.
    const product = { name: 'Premium Car Flag', price: 1999 };
    const out = redact({ oldValues: product, newValues: product }) as {
      oldValues: unknown;
      newValues: unknown;
    };

    assert.deepEqual(out.oldValues, { name: 'Premium Car Flag', price: 1999 });
    assert.deepEqual(
      out.newValues,
      { name: 'Premium Car Flag', price: 1999 },
      'newValues was corrupted by false cycle detection',
    );
  });

  it('preserves repeated siblings that are structurally equal', () => {
    const out = redact({ a: { id: 1 }, b: { id: 1 } }) as Record<
      string,
      unknown
    >;
    assert.deepEqual(out.a, { id: 1 });
    assert.deepEqual(out.b, { id: 1 });
  });

  it('still detects a genuine cycle nested inside a shared reference', () => {
    const inner: Record<string, unknown> = { deep: true };
    inner.loop = inner;
    const out = redact({ first: inner, second: inner }) as Record<
      string,
      unknown
    >;
    assert.equal((out.first as Record<string, unknown>).deep, true);
    assert.equal((out.first as Record<string, unknown>).loop, '[Circular]');
    assert.equal((out.second as Record<string, unknown>).deep, true);
    assert.equal((out.second as Record<string, unknown>).loop, '[Circular]');
  });

  it('passes through primitives unchanged', () => {
    assert.equal(redact(42), 42);
    assert.equal(redact('text'), 'text');
    assert.equal(redact(null), null);
    assert.equal(redact(undefined), undefined);
  });

  it('never leaks a password through a case-variant key', () => {
    const out = redact({ PassWord: 'hunter2', TOKEN: 'abc' }) as Record<
      string,
      unknown
    >;
    assert.equal(out.PassWord, REDACTED);
    assert.equal(out.TOKEN, REDACTED);
  });
});
