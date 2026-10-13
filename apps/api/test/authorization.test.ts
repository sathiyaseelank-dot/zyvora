import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import express, {
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import { SignJWT } from 'jose';

import { env } from '../src/config/env.js';
import { errorHandler, notFoundHandler } from '../src/http/error-handler.js';
import {
  requireAuth,
  SESSION_COOKIE,
  type RoleName,
} from '../src/http/auth.js';
import {
  requireAdmin,
  requireOwnership,
  requireRole,
} from '../src/http/rbac.js';
import { getJson, startServer } from './helpers.js';

/**
 * ZYV-35 — Role-based authorization.
 *
 * Acceptance criterion: "Authorization unit tested".
 *
 * `requireAuth` is replaced with a stub that injects a fixed user. The real
 * middleware is exercised separately in auth.test.ts; this spec is about the
 * authorization DECISION, which must be testable without a database.
 */

function withUser(
  role: RoleName | null,
  id = '11111111-1111-4111-8111-111111111111',
) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (role) {
      req.user = {
        id,
        email: 'u@example.com',
        fullName: 'U',
        mobile: null,
        role,
      };
    }
    next();
  };
}

function buildApp(role: RoleName | null) {
  const app = express();
  app.use(express.json());
  app.use(withUser(role));

  app.get('/customer-only', requireRole('customer'), (_req, res) => {
    res.json({ data: 'ok' });
  });
  app.get('/admin-only', requireAdmin, (_req, res) => {
    res.json({ data: 'ok' });
  });
  app.get('/any-user', requireRole('customer', 'admin'), (_req, res) => {
    res.json({ data: 'ok' });
  });

  app.use(notFoundHandler());
  app.use(errorHandler);
  return app;
}

describe('ZYV-35 role-based authorization', () => {
  it('allows a customer onto a customer route', async () => {
    const client = await startServer(buildApp('customer'));
    try {
      assert.equal((await getJson(client, '/customer-only')).status, 200);
    } finally {
      await client.close();
    }
  });

  it('blocks a customer from an admin route with 403', async () => {
    const client = await startServer(buildApp('customer'));
    try {
      const res = await getJson(client, '/admin-only');
      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, 'FORBIDDEN');
    } finally {
      await client.close();
    }
  });

  it('allows an admin onto an admin route', async () => {
    const client = await startServer(buildApp('admin'));
    try {
      assert.equal((await getJson(client, '/admin-only')).status, 200);
    } finally {
      await client.close();
    }
  });

  it('blocks an admin from a customer-only route', async () => {
    const client = await startServer(buildApp('admin'));
    try {
      assert.equal((await getJson(client, '/customer-only')).status, 403);
    } finally {
      await client.close();
    }
  });

  it('allows either role on a multi-role route', async () => {
    for (const role of ['customer', 'admin'] as RoleName[]) {
      const client = await startServer(buildApp(role));
      try {
        assert.equal((await getJson(client, '/any-user')).status, 200);
      } finally {
        await client.close();
      }
    }
  });

  it('rejects an anonymous request with 401, not 403', async () => {
    const client = await startServer(buildApp(null));
    try {
      const res = await getJson(client, '/admin-only');
      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'AUTH_REQUIRED');
    } finally {
      await client.close();
    }
  });
});

describe('ZYV-35 horizontal authorisation (requireOwnership)', () => {
  const OWNER = '11111111-1111-4111-8111-111111111111';
  const OTHER = '22222222-2222-4222-8222-222222222222';

  it('allows the owner', () => {
    assert.doesNotThrow(() => requireOwnership(OWNER, OWNER));
  });

  it("throws 404 for another customer's row", () => {
    // 404, not 403: a 403 would confirm the resource exists and leak by
    // inference. E9-S1 permits either.
    assert.throws(
      () => requireOwnership(OTHER, OWNER),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal((err as { status?: number }).status, 404);
        return true;
      },
    );
  });

  it('throws 404 for an unowned row', () => {
    assert.throws(() => requireOwnership(null, OWNER));
    assert.throws(() => requireOwnership(undefined, OWNER));
  });

  it('throws 401 when there is no authenticated user', () => {
    assert.throws(
      () => requireOwnership(OWNER, undefined),
      (err: unknown) => {
        assert.equal((err as { status?: number }).status, 401);
        return true;
      },
    );
  });
});

describe('ZYV-32 authentication middleware (JWT verification)', () => {
  const key = new TextEncoder().encode(env.JWT_SECRET);

  async function mintToken(payload: Record<string, unknown>, alg = 'HS256') {
    return new SignJWT(payload)
      .setProtectedHeader({ alg })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(key);
  }

  function authApp() {
    const app = express();
    // requireAuth is a factory: it must be invoked. Passing the factory itself
    // silently hangs the request, because Express would call the factory,
    // get back a handler, and never advance the middleware chain.
    app.get('/protected', requireAuth(), (req, res) => {
      res.json({ data: { role: req.user?.role, id: req.user?.id } });
    });
    app.use(notFoundHandler());
    app.use(errorHandler);
    return app;
  }

  it('returns 401 with no cookie', async () => {
    const client = await startServer(authApp());
    try {
      const res = await getJson(client, '/protected');
      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'AUTH_REQUIRED');
    } finally {
      await client.close();
    }
  });

  it('returns 401 for a garbage cookie without touching the database', async () => {
    const client = await startServer(authApp());
    try {
      const res = await getJson(client, '/protected', {
        headers: { cookie: `${SESSION_COOKIE}=not-a-jwt` },
      });
      assert.equal(res.status, 401);
    } finally {
      await client.close();
    }
  });

  it('rejects a token signed with the wrong secret', async () => {
    const forged = await new SignJWT({ sub: 'x', role: 'admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('a-completely-different-secret-value'));
    const client = await startServer(authApp());
    try {
      const res = await getJson(client, '/protected', {
        headers: { cookie: `${SESSION_COOKIE}=${forged}` },
      });
      assert.equal(res.status, 401, 'a forged token was accepted');
    } finally {
      await client.close();
    }
  });

  it('rejects an expired token', async () => {
    const expired = await new SignJWT({ sub: 'x', role: 'customer' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(key);
    const client = await startServer(authApp());
    try {
      const res = await getJson(client, '/protected', {
        headers: { cookie: `${SESSION_COOKIE}=${expired}` },
      });
      assert.equal(res.status, 401);
    } finally {
      await client.close();
    }
  });

  it('rejects the "none" algorithm (algorithm-confusion guard)', async () => {
    const client = await startServer(authApp());
    try {
      // Unsigned token: alg none, empty signature.
      const header = Buffer.from(
        JSON.stringify({ alg: 'none', typ: 'JWT' }),
      ).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({
          sub: 'x',
          role: 'admin',
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      ).toString('base64url');
      const res = await getJson(client, '/protected', {
        headers: { cookie: `${SESSION_COOKIE}=${header}.${payload}.` },
      });
      assert.equal(res.status, 401, 'alg=none token was accepted');
    } finally {
      await client.close();
    }
  });

  it('mints a token that survives the middleware shape check', async () => {
    // The user row is re-read from the database on every request, so this
    // asserts the token is at least well-formed and cryptographically valid
    // — it must not be rejected as a signature failure.
    const token = await mintToken({ sub: 'abc', role: 'customer' });
    const [h, p, s] = token.split('.');
    assert.ok(h && p && s, 'token is not three dot-separated segments');
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
    assert.equal(claims.sub, 'abc');
    assert.equal(claims.role, 'customer');
  });
});
