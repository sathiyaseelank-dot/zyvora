import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';

/**
 * Password hashing — Story ZYV-57 / E6-S6.
 *
 * Argon2id, the winner of the Password Hashing Competition and the OWASP
 * recommended option. Argon2id is memory-hard, so a GPU or ASIC attack is
 * expensive rather than merely costly.
 *
 * Parameters follow the OWASP minimums (m=19 MiB, t=2, p=1). They are stated
 * once here so a future cost change is a single edit rather than a hunt.
 */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456, // KiB — OWASP minimum for argon2id
  timeCost: 2, // passes — OWASP minimum
  parallelism: 1,
} as const;

/** Encoded hash length; argon2 output is well under this. */
const MAX_HASH_LENGTH = 255;

/**
 * Minimum password length.
 *
 * Length beats composition rules: "Passphrase9" should not fail because it
 * lacks a symbol. NIST SP 800-63B recommends a minimum with no mandatory
 * character classes, and a maximum that permits passphrases.
 */
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 200;

export type PasswordProblem = string | null;

/**
 * Validate a candidate password.
 *
 * Returns a human-readable problem, or null when acceptable.
 */
export function validatePassword(password: unknown): PasswordProblem {
  if (typeof password !== 'string') return 'Password must be text';

  // Guard the hashing cost itself before spending ~50ms and 19 MiB on input
  // that cannot possibly be accepted.
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Password must be at most ${MAX_PASSWORD_LENGTH} characters`;
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }

  // Not a real entropy check, just an exclusion list. The intent is to reject
  // passwords that are trivially guessable regardless of length.
  const lowered = password.toLowerCase();
  const banned = [
    'password',
    'passw0rd',
    'qwerty',
    '12345678',
    '123456789',
    '11111111',
    'zyvora123',
    'admin@123',
  ];
  for (const b of banned) {
    if (lowered.includes(b)) {
      return 'Password is too common';
    }
  }

  return null;
}

/** Hash a password with Argon2id. Never throws on invalid input. */
export async function hashPassword(password: string): Promise<string> {
  const hash = await argon2.hash(password, ARGON2_OPTIONS);
  if (hash.length > MAX_HASH_LENGTH) {
    // Would be truncated by the column and silently break verification later.
    throw new Error(`Password hash exceeds ${MAX_HASH_LENGTH} characters`);
  }
  return hash;
}

/**
 * Verify a password against a stored hash.
 *
 * A malformed or missing hash returns false rather than throwing, so a corrupt
 * row cannot turn a failed login into a 500.
 *
 * The hash format itself encodes the parameters, so a future cost increase does
 * not invalidate existing hashes — verification uses whatever the row specifies.
 */
export async function verifyPassword(
  hash: string | null | undefined,
  password: string,
): Promise<boolean> {
  if (!hash) {
    // No stored hash means no account. Still burn comparable time so the
    // response does not distinguish "no such user" from "wrong password".
    await dummyVerify(password);
    return false;
  }
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/**
 * A hash of a value nobody knows, used to equalise timing.
 *
 * E6-S8 requires that an unknown account and a wrong password take comparable
 * time. Without this, "no such user" returns in microseconds while a real
 * account costs ~50ms of Argon2 — a timing oracle that confirms which emails
 * are registered.
 *
 * Built lazily and cached. It cannot be a hardcoded literal: a made-up hash
 * string fails to *parse*, which returns instantly and reintroduces exactly
 * the oracle this is meant to close. The first unknown-account login pays for
 * the generation; every one after is a real verification.
 */
let dummyHashPromise: Promise<string> | null = null;

function dummyHash(): Promise<string> {
  // The password is random and discarded. Its hash is a valid, verifiable
  // Argon2id string that no account can match.
  dummyHashPromise ??= argon2.hash(
    randomBytes(32).toString('base64url'),
    ARGON2_OPTIONS,
  );
  return dummyHashPromise;
}

/**
 * Build the dummy hash ahead of the first login attempt.
 *
 * Called during startup. Without it, the first unknown-account login pays
 * ~90ms extra to generate the hash, which is measurably slower than any
 * subsequent request — a one-shot timing asymmetry an attacker could exploit
 * by probing a known address first and reading the slow response as "this
 * account exists".
 */
export async function warmupPasswordHasher(): Promise<void> {
  await dummyVerify('warmup');
}

export async function dummyVerify(password: string): Promise<void> {
  try {
    await argon2.verify(await dummyHash(), password);
  } catch {
    // Defensive only — the hash is generated by us, so it always parses.
  }
}

/**
 * Generate a URL-safe random token for a password reset.
 *
 * 32 bytes of CSPRNG output. The raw token is returned to the caller to email;
 * only its hash is persisted.
 */
export function generateResetToken(): string {
  return randomBytes(32).toString('base64url');
}
