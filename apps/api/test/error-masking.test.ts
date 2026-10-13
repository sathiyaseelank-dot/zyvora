import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';

/**
 * ZYV-39 — production error masking.
 *
 * The production branch of `errorHandler` had never been executed by any test.
 * `env.NODE_ENV` defaults to `development`, so `npm test` never reached the
 * line whose entire purpose is to stop internal messages reaching a client in
 * production. An external reviewer flagged it; it was a real gap, and the one
 * branch that matters most for a public API was the one never run.
 *
 * `env` is read at module load, so each case boots a real server in a child
 * process with NODE_ENV set rather than mutating the already-loaded config.
 *
 * These build a minimal app around the REAL errorHandler rather than calling
 * `createApp()`, because createApp() installs its own terminal 404 handler —
 * a route added afterwards would never be reached.
 */

const SRC = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  '..',
  'src',
);

const APP_TS = path.join(SRC, 'app.ts');
const HANDLER_TS = path.join(SRC, 'http', 'error-handler.ts');
const ERRORS_TS = path.join(SRC, 'http', 'errors.ts');

/**
 * The app logs one structured JSON record per request to stdout, so the
 * child's stdout is not pure JSON. Tag the payload and extract only that line.
 */
const TAG = '__REVIEW_RESULT__';

function extract(stdout: string): { status: number; body: string } {
  const line = stdout.split('\n').find((l) => l.startsWith(TAG));
  assert.ok(line, `child produced no tagged result. stdout:\n${stdout}`);
  return JSON.parse(line.slice(TAG.length)) as { status: number; body: string };
}

interface Case {
  /** Extra source imported by the child, e.g. an AppError constructor. */
  imports?: string;
  /** Statement placed in the route handler. Defaults to throwing an Error. */
  throwStmt?: string;
}

function runInEnv(
  nodeEnv: string,
  thrown: string,
  extra: Case = {},
): {
  status: number;
  body: string;
} {
  const imports = extra.imports ?? '';
  const throwStmt =
    extra.throwStmt ?? `throw new Error(${JSON.stringify(thrown)});`;

  const res = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--eval',
      `
      const express = (await import('express')).default;
      const { errorHandler } = await import(${JSON.stringify(HANDLER_TS)});
      ${imports}
      const app = express();
      app.use(express.json());
      app.get('/boom', () => { ${throwStmt} });
      app.use(errorHandler);
      const server = app.listen(0, '127.0.0.1', async () => {
        const { port } = server.address();
        const r = await fetch('http://127.0.0.1:' + port + '/boom');
        const body = await r.text();
        server.close(() =>
          process.stdout.write('${TAG}' + JSON.stringify({ status: r.status, body }))
        );
      });
      `,
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_ENV: nodeEnv,
        // Production refuses to boot on the development secrets.
        JWT_SECRET: 'a-production-secret-of-at-least-32-characters',
        COOKIE_SECRET: 'another-production-secret-32-characters',
      },
    },
  );

  assert.equal(res.status, 0, `child server failed: ${res.stderr}`);
  return extract(res.stdout);
}

describe('ZYV-39 production error masking', () => {
  it('does not leak the internal message in production', () => {
    const { status, body } = runInEnv(
      'production',
      'SECRET internal detail: db password is hunter2',
    );

    assert.equal(status, 500);
    assert.ok(!body.includes('hunter2'), `leaked the secret: ${body}`);
    assert.ok(!body.includes('SECRET'), `leaked the error text: ${body}`);
    assert.match(body, /An unexpected error occurred/);
  });

  it('does not leak a stack trace in production', () => {
    const { body } = runInEnv('production', 'boom');
    assert.ok(!body.includes('at Object.'), `stack frame leaked: ${body}`);
    assert.ok(!body.includes('.ts:'), `source reference leaked: ${body}`);
  });

  it('masks an AppError 5xx too, not just a raw throw', () => {
    // An AppError message is authored, not derived from a stack — but it can
    // still name internals, and production must mask it too.
    const { status, body } = runInEnv('production', '', {
      imports: `const { AppError } = await import(${JSON.stringify(ERRORS_TS)});`,
      throwStmt: `throw new AppError('INTERNAL_ERROR', 'internal detail: table zyvora_users');`,
    });

    assert.equal(status, 500);
    assert.ok(!body.includes('zyvora_users'), `leaked schema detail: ${body}`);
    assert.match(body, /An unexpected error occurred/);
  });

  it('still surfaces the message in development, so the above are not vacuous', () => {
    // Without this, deleting the production branch would leave every assertion
    // above passing for the wrong reason.
    const { body } = runInEnv('development', 'dev message should be visible');
    assert.match(
      body,
      /dev message should be visible/,
      'development must surface the message, otherwise masking is untested',
    );
  });
});

// Referenced so the unused-import lint does not fire on the app path, which is
// the real composition the middleware is mounted in.
void APP_TS;
