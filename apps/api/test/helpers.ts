import { createServer, type Server } from 'node:http';
import type { Express } from 'express';

/**
 * Test helpers shared by the middleware specs.
 *
 * Deliberately no supertest / no new dependency: the app is started on an
 * ephemeral port and driven with the global `fetch`. This exercises the real
 * Express pipeline — including middleware order and the error handler — which
 * is the thing actually worth testing.
 */

export interface TestClient {
  url: string;
  close: () => Promise<void>;
}

export async function startServer(app: Express): Promise<TestClient> {
  const server: Server = createServer(app);

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('server did not bind to a TCP port');
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

export interface JsonResponse<T = unknown> {
  status: number;
  body: T;
  headers: Headers;
}

export async function getJson<T = unknown>(
  client: TestClient,
  path: string,
  init: RequestInit = {},
): Promise<JsonResponse<T>> {
  const res = await fetch(`${client.url}${path}`, init);
  const text = await res.text();
  return {
    status: res.status,
    body: (text ? JSON.parse(text) : null) as T,
    headers: res.headers,
  };
}

/**
 * A cookie jar, because `credentials: 'include'` is a browser-only option and
 * node's fetch does not implement it.
 *
 * Session tests are worthless if the cookie is threaded through by hand — it
 * hides exactly the bug where the server stops setting it. This behaves like a
 * browser: store Set-Cookie on the way out, send matching cookies on the way in.
 */
export class CookieJar {
  private readonly cookies = new Map<string, string>();

  absorb(headers: Headers): void {
    for (const raw of headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const eq = pair.indexOf('=');
      if (eq === -1) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();

      // An expired cookie is a deletion instruction, not a value.
      if (/Expires=Thu, 01 Jan 1970/i.test(raw) || /Max-Age=0/i.test(raw)) {
        this.cookies.delete(name);
        continue;
      }
      this.cookies.set(name, value);
    }
  }

  header(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  get(name: string): string | undefined {
    return this.cookies.get(name);
  }

  has(name: string): boolean {
    return this.cookies.has(name);
  }

  clear(): void {
    this.cookies.clear();
  }
}

/** fetch that carries a CookieJar. */
export async function jarFetch<T = unknown>(
  client: TestClient,
  jar: CookieJar,
  path: string,
  init: RequestInit = {},
): Promise<JsonResponse<T>> {
  const headers = new Headers(init.headers);
  const cookie = jar.header();
  if (cookie) headers.set('cookie', cookie);

  const res = await fetch(`${client.url}${path}`, { ...init, headers });
  jar.absorb(res.headers);

  const text = await res.text();
  return {
    status: res.status,
    body: (text ? JSON.parse(text) : null) as T,
    headers: res.headers,
  };
}
