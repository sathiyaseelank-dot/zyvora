import { describe, expect, it } from 'vitest';

import {
  assessPassword,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from '../src/components/PasswordField';

/**
 * ZYV-54 — the strength meter is the part of the frontend that encodes a
 * security rule, so it gets tested like one.
 *
 * The invariants that matter, and would be easy to break:
 *
 *  - It mirrors the SERVER policy. A stricter client rule rejects passwords the
 *    API would accept; a looser one claims a bad password is fine. Both are
 *    failures, and neither is caught by a test that only checks "renders".
 *  - It never downgrades a long passphrase for lacking a character class. That
 *    regression is the most likely way this function breaks, because it looks
 *    like "improving" the meter.
 */

describe('assessPassword', () => {
  it('reports nothing for an empty field rather than an error', () => {
    const result = assessPassword('');
    expect(result.strength).toBe('empty');
    expect(result.problem).toBeNull();
  });

  it(`refuses anything under ${MIN_PASSWORD_LENGTH} characters`, () => {
    for (const length of [1, 5, 11]) {
      const result = assessPassword('a'.repeat(length));
      expect(result.strength).toBe('too-short');
      expect(result.problem).toMatch(/character/);
    }
  });

  it('counts down the characters still needed', () => {
    expect(assessPassword('a'.repeat(10)).problem).toMatch(/^2 more/);
    expect(assessPassword('a'.repeat(11)).problem).toMatch(/^1 more/);
    // Singular: the naive string concatenation reads "1 more characters to go".
    expect(assessPassword('a'.repeat(11)).problem).not.toMatch(/characters/);
  });

  it(`rejects anything over ${MAX_PASSWORD_LENGTH} characters`, () => {
    const result = assessPassword('a'.repeat(MAX_PASSWORD_LENGTH + 1));
    expect(result.strength).toBe('too-short');
    expect(result.problem).toMatch(/at most/);
  });

  it('flags the exclusion list the server also rejects', () => {
    // Every one of these is >= 12 chars so it clears the length gate and
    // reaches the banned-substring check. Mirrors apps/api/src/auth/password.ts.
    for (const banned of [
      'mypassword123',
      'MyPassw0rd!ab',
      'qwertyuiopas',
      '12345678abcd',
      '11111111aaaa',
      'zyvora123456',
      'admin@1234567',
    ]) {
      expect(assessPassword(banned).strength, banned).toBe('weak');
    }
  });

  it('does not report a problem for a passphrase the server accepts', () => {
    const result = assessPassword('correct horse battery staple');
    expect(result.problem).toBeNull();
    expect(['good', 'strong']).toContain(result.strength);
  });

  it('separates advice from rejection', () => {
    // The distinction that makes the server contract stateable: a `good`
    // password may carry advice, and must never carry a problem.
    const result = assessPassword('abcdefghijkl');
    expect(result.strength).toBe('good');
    expect(result.problem).toBeNull();
    expect(result.advice).toBeTruthy();
  });

  it('never downgrades a long passphrase for lacking a character class', () => {
    // The regression this test exists for: rewarding variety over length
    // pushes people toward shorter passwords with a digit bolted on.
    const longish = 'abcdefghijklmnop';
    expect(longish.length).toBeGreaterThanOrEqual(MIN_PASSWORD_LENGTH);
    expect(assessPassword(longish).strength).not.toBe('too-short');
    expect(assessPassword(longish).strength).not.toBe('weak');
  });

  it('rates a long passphrase with many classes as strong', () => {
    expect(assessPassword('Th1s-Is-A-Long-Passphrase!').strength).toBe(
      'strong',
    );
  });

  it('keeps the score inside the 0-4 range the meter renders', () => {
    const samples = [
      '',
      'a',
      'a'.repeat(12),
      'a'.repeat(200),
      'a'.repeat(201),
      'password1234',
      'Th1s-Is-A-Long-Passphrase!',
    ];
    for (const sample of samples) {
      const { score } = assessPassword(sample);
      expect(score, sample).toBeGreaterThanOrEqual(0);
      expect(score, sample).toBeLessThanOrEqual(4);
      expect(Number.isInteger(score), sample).toBe(true);
    }
  });

  it('agrees with the server on which inputs are acceptable', () => {
    // The contract that matters. Any input this function flags as a problem
    // must also be rejected by the API — otherwise the UI is inventing rules.
    const samples = [
      'short',
      'a'.repeat(11),
      'mypassword1234',
      'correct horse battery staple',
      'Th1s-Is-A-Long-Passphrase!',
      'abcdefghijkl',
    ];
    for (const sample of samples) {
      const { problem } = assessPassword(sample);
      const serverAccepts =
        sample.length >= MIN_PASSWORD_LENGTH &&
        sample.length <= MAX_PASSWORD_LENGTH &&
        ![
          'password',
          'passw0rd',
          'qwerty',
          '12345678',
          '123456789',
          '11111111',
          'zyvora123',
          'admin@123',
        ].some((b) => sample.toLowerCase().includes(b));
      expect(Boolean(problem), sample).toBe(!serverAccepts);
    }
  });
});
