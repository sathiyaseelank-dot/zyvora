import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Where the production bundle points.
 *
 * The failure this guards against is not hypothetical: it is deployed and
 * observed. A Vercel build produced a bundle containing `localhost:4000`, and
 * the browser console showed every request going to the visitor's own machine.
 * `localhost` compiles into the JavaScript — it is not a runtime lookup — so
 * nothing about the deployed page reveals it until a browser tries to use it.
 *
 * These assertions read the source rather than the built bundle, so they stay
 * fast; the bundle is verified once, against the live deployment, after push.
 */
// Located by searching up from the cwd, because vitest rewrites
// `import.meta.url` into something that is not a file:// URL.
const apiSourcePath = [
  resolve(process.cwd(), 'src/lib/api.ts'),
  resolve(process.cwd(), 'apps/web/src/lib/api.ts'),
].find((candidate) => existsSync(candidate));

if (!apiSourcePath) {
  throw new Error('could not locate src/lib/api.ts from ' + process.cwd());
}

const source = readFileSync(apiSourcePath, 'utf8');

describe('API base URL', () => {
  it('never falls back to localhost in a production build', () => {
    // The dev default must be behind `import.meta.env.DEV`. If it is the
    // fallback for the unflagged case, a production build with no
    // VITE_API_URL baked in points every visitor at their own machine.
    const devFallback =
      /import\.meta\.env\.DEV\s*\?\s*'http:\/\/localhost:4000'/;
    expect(source).toMatch(devFallback);
  });

  it('resolves to the page origin when VITE_API_URL is empty', () => {
    // `window.location.origin` is the same-origin case that makes the
    // SameSite=Lax cookies first-party.
    expect(source).toMatch(/window\.location\.origin/);
  });

  it('treats a blank VITE_API_URL as unset rather than a literal empty base', () => {
    // `??` alone would not catch an empty string, and the env var is set to
    // an empty value in production to mean "same origin".
    expect(source).toMatch(
      /\(import\.meta\.env\.VITE_API_URL \?\? ''\)\.trim\(\)/,
    );
  });

  it('strips a trailing slash so /api is never doubled', () => {
    // A base of "https://host/" plus a path of "/api/x" yields "//api/x",
    // which the rewrite's `/api/(.*)` does not match.
    // Written with String.raw so the backslashes survive: the source contains
    // a regex literal, and a plain string would lose them.
    expect(source).toContain(String.raw`.replace(/\/$/, '')`);
  });
});

describe('paths', () => {
  it('prefixes every request path with /api exactly once', () => {
    // The rewrite is source `/api/(.*)` -> `.../api/$1`. A client that also
    // appended /api would produce /api/api and 404 through the proxy.
    const apiPaths = [
      ...source.matchAll(/request<[^>]*>\(\s*[`'"](\/api\/[^`'"$]*)/g),
    ].map((m) => m[1]);
    expect(apiPaths.length).toBeGreaterThan(0);
    for (const p of apiPaths) {
      expect(p.match(/\/api\//g) ?? []).toHaveLength(1);
    }
  });
});
