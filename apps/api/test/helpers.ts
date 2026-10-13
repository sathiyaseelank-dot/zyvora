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
