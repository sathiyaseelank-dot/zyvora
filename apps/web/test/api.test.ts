import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError, request } from '../src/lib/api';

/**
 * Regression tests for the API client's error handling.
 *
 * The `body.` prefix bug was found by calling the running service rather than
 * by reading the code: the API returns `"body.email"`, the client looked up
 * `fieldErrors.email`, and every validation message rendered in the form
 * banner instead of beside the input it described. It typechecked, built, and
 * looked correct in a screenshot. These tests exist so it cannot come back.
 */

const ORIGINAL_FETCH = global.fetch;

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

/** Stub fetch with one JSON response. */
function mockFetch(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    getSetCookie: () => [],
    json: async () => body,
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

/** The exact envelope the running API returns for a register validation error. */
const VALIDATION_ENVELOPE = {
  error: {
    code: 'VALIDATION_ERROR',
    message: 'Request validation failed',
    details: {
      fieldErrors: {
        'body.fullName': ['String must contain at least 2 character(s)'],
        'body.email': ['Invalid email'],
        'body.mobile': ['Mobile must be a 10-digit Indian number'],
        'body.acceptTerms': ['You must accept the Terms and Conditions'],
      },
    },
  },
};

describe('field error normalisation', () => {
  it('strips the request-part prefix so forms can bind to a field name', async () => {
    mockFetch(400, VALIDATION_ENVELOPE);
    // GET avoids the CSRF path so the stub only serves one response.
    const error = await request('/api/test', { method: 'GET' }).catch(
      (e) => e as ApiRequestError,
    );

    expect(error).toBeInstanceOf(ApiRequestError);
    const api = error as ApiRequestError;

    expect(Object.keys(api.fieldErrors).sort()).toEqual([
      'acceptTerms',
      'email',
      'fullName',
      'mobile',
    ]);
    expect(api.forField('email')).toBe('Invalid email');
    expect(api.forField('mobile')).toMatch(/10-digit/);
    expect(api.forField('nonexistent')).toBeUndefined();
  });

  it('keeps the status, code and message intact', async () => {
    mockFetch(400, VALIDATION_ENVELOPE);
    const api = (await request('/api/test').catch((e) => e)) as ApiRequestError;

    expect(api.status).toBe(400);
    expect(api.code).toBe('VALIDATION_ERROR');
    expect(api.message).toBe('Request validation failed');
  });

  it('survives a non-JSON error body without inventing field errors', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      headers: new Headers(),
      getSetCookie: () => [],
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON');
      },
    }) as unknown as typeof fetch;

    const api = (await request('/api/test').catch((e) => e)) as ApiRequestError;
    expect(api.status).toBe(500);
    expect(api.code).toBe('INTERNAL_ERROR');
    expect(api.fieldErrors).toEqual({});
  });

  it('exposes no field errors on a 401, which is not a validation failure', async () => {
    mockFetch(401, {
      error: { code: 'AUTH_REQUIRED', message: 'You must be signed in' },
    });
    const api = (await request('/api/test').catch((e) => e)) as ApiRequestError;
    expect(api.status).toBe(401);
    expect(api.fieldErrors).toEqual({});
  });

  it('reports a network failure distinctly from a 4xx', async () => {
    global.fetch = vi
      .fn()
      .mockRejectedValue(
        new TypeError('Failed to fetch'),
      ) as unknown as typeof fetch;

    const api = (await request('/api/test').catch((e) => e)) as ApiRequestError;
    expect(api.status).toBe(0);
    expect(api.code).toBe('NETWORK_ERROR');
  });
});
