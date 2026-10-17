import { useId, useState } from 'react';

import { controlClass } from './Field';

/**
 * Password input with a visibility toggle and an honest strength meter
 * (ZYV-54).
 *
 * The meter deliberately mirrors the server policy rather than a prettier
 * invented one: 12 characters minimum, 200 maximum, and an exclusion list.
 * No composition rules (uppercase/digit/symbol) exist on the server, so
 * demanding them here would reject passwords the API is willing to accept and
 * train people to think `Passw0rd!` is good.
 *
 * The meter is advisory. It never blocks submission — the server is the
 * authority, and a client-side rule that disagrees with it produces a form
 * that both rejects valid input and accepts invalid input.
 */

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 200;

/** Mirrors `banned` in apps/api/src/auth/password.ts. */
const BANNED = [
  'password',
  'passw0rd',
  'qwerty',
  '12345678',
  '123456789',
  '11111111',
  'zyvora123',
  'admin@123',
];

export type Strength = 'empty' | 'too-short' | 'weak' | 'good' | 'strong';

export interface StrengthResult {
  strength: Strength;
  /**
   * Why this password would be REJECTED, or null when it would be accepted.
   *
   * Kept strictly separate from `advice`. Conflating the two is how a form
   * ends up blocking input the server is willing to take: `good` used to
   * report "longer is stronger" as a `problem`, which reads identically to
   * "too short" and made the contract with the API impossible to state or
   * test.
   */
  problem: string | null;
  /** Optional nudge when the password is acceptable but could be better. */
  advice: string | null;
  /** 0–4, for the meter's bar fill. */
  score: number;
}

/**
 * Pure so it can be reasoned about — and tested — without a DOM.
 *
 * Scoring counts character-class variety, which is a rough proxy for
 * unpredictability. It never downgrades a long passphrase below `good`, because
 * length is the property that actually matters and penalising a 20-character
 * phrase for lacking a digit would push people toward shorter, worse passwords.
 */
export function assessPassword(password: string): StrengthResult {
  if (password.length === 0)
    return { strength: 'empty', problem: null, advice: null, score: 0 };

  if (password.length > MAX_PASSWORD_LENGTH) {
    return {
      strength: 'too-short',
      problem: `Must be at most ${MAX_PASSWORD_LENGTH} characters`,
      advice: null,
      score: 0,
    };
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      strength: 'too-short',
      problem: `${MIN_PASSWORD_LENGTH - password.length} more character${
        MIN_PASSWORD_LENGTH - password.length === 1 ? '' : 's'
      } to go`,
      advice: null,
      score: 0,
    };
  }

  const lowered = password.toLowerCase();
  const banned = BANNED.find((b) => lowered.includes(b));
  if (banned) {
    return {
      strength: 'weak',
      problem: 'Too common — the server rejects this one',
      advice: null,
      score: 1,
    };
  }

  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) =>
    re.test(password),
  ).length;

  const score = Math.min(4, 1 + classes);

  if (password.length >= 20)
    return { strength: 'strong', problem: null, advice: null, score: 4 };
  if (classes >= 3)
    return { strength: 'strong', problem: null, advice: null, score: score };

  // Acceptable, so `problem` stays null — the note below is advice only.
  return {
    strength: 'good',
    problem: null,
    advice: 'Longer is stronger — try a memorable phrase',
    score: Math.max(2, score),
  };
}

const BAR_COLOUR: Record<Strength, string> = {
  empty: 'bg-rule',
  'too-short': 'bg-danger/70',
  weak: 'bg-danger',
  good: 'bg-brass-deep',
  strong: 'bg-success',
};

const LABEL: Record<Strength, string> = {
  empty: '',
  'too-short': 'Too short',
  weak: 'Weak',
  good: 'Good',
  strong: 'Strong',
};

interface PasswordFieldProps {
  id?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  placeholder?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  /** Show the strength meter. Off for the confirmation field. */
  showMeter?: boolean;
}

export function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  placeholder,
  error,
  required,
  disabled,
  showMeter = true,
}: PasswordFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const [visible, setVisible] = useState(false);

  const meterId = `${fieldId}-strength`;
  const errorId = `${fieldId}-error`;
  const describedBy =
    [showMeter && value ? meterId : null, error ? errorId : null]
      .filter(Boolean)
      .join(' ') || undefined;

  const { strength, problem, advice, score } = assessPassword(value);

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={fieldId}
        className="text-[11px] font-bold uppercase tracking-[0.1em] text-ink-soft"
      >
        {label}
        {required ? (
          <span className="ml-1 text-brass-deep" aria-hidden="true">
            *
          </span>
        ) : null}
        {required ? <span className="sr-only"> (required)</span> : null}
      </label>

      <div className="relative">
        <input
          id={fieldId}
          type={visible ? 'text' : 'password'}
          value={value}
          disabled={disabled}
          required={required}
          placeholder={placeholder}
          autoComplete={autoComplete}
          maxLength={MAX_PASSWORD_LENGTH + 1}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          onChange={(e) => onChange(e.target.value)}
          // Extra room on the right so the toggle never sits on top of the
          // text at the 200-character maximum.
          className={`${controlClass(Boolean(error))} pr-16`}
        />

        {/*
          A real <button> in the tab order rather than a div with an onClick,
          so it is reachable by keyboard and announced as a control. The label
          is static ("Show password") and `aria-pressed` carries the state, so
          the accessible name does not flip under the user mid-press.
        */}
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          aria-controls={fieldId}
          className="absolute top-1/2 right-2 -translate-y-1/2 px-2 py-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted transition-colors hover:text-brass-deep"
        >
          <span aria-hidden="true">{visible ? '◐' : '◑'}</span>
          <span className="sr-only">
            {visible ? 'Hide password' : 'Show password'}
          </span>
        </button>
      </div>

      {/*
        Not `aria-live="polite"`: a meter that announces itself on every
        keystroke would talk over the person typing. It is instead referenced
        by aria-describedby, so it is read when focus arrives and on request.
      */}
      {showMeter && value ? (
        <div id={meterId} className="flex flex-col gap-1.5 pt-0.5">
          <div className="flex gap-1" aria-hidden="true">
            {[1, 2, 3, 4].map((step) => (
              <span
                key={step}
                className={`h-[3px] flex-1 transition-colors duration-300 ${
                  step <= score ? BAR_COLOUR[strength] : 'bg-rule'
                }`}
              />
            ))}
          </div>
          <p className="text-[12px] leading-relaxed text-ink-muted">
            <span className="font-bold uppercase tracking-[0.08em] text-ink-soft">
              {LABEL[strength]}
            </span>
            {problem ? (
              <span className="text-danger"> — {problem}</span>
            ) : advice ? (
              <span> — {advice}</span>
            ) : null}
          </p>
        </div>
      ) : null}

      {error ? (
        <p
          id={errorId}
          role="alert"
          className="flex items-start gap-1.5 text-[12px] font-medium text-danger"
        >
          <span aria-hidden="true">⚠</span>
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}
