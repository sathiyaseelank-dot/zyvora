import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { ApiRequestError } from '../lib/api';
import { useSession } from '../lib/session';
import {
  AuthFooterLink,
  AuthLayout,
  FormError,
} from '../components/AuthLayout';
import { Button } from '../components/Button';
import { TextField } from '../components/Field';
import { PasswordField, assessPassword } from '../components/PasswordField';

/**
 * Create an account (ZYV-116).
 *
 * The API validates the mobile as `^[6-9]\d{9}$` and requires `acceptTerms`
 * to be literally `true`. Both are mirrored here so a mistake is caught before
 * a round trip, but the server remains the authority — the client check is a
 * convenience, not a gate, so nothing is blocked on it beyond the obvious.
 */

const MOBILE_PATTERN = /^[6-9]\d{9}$/;

export function RegisterPage() {
  const { register } = useSession();
  const navigate = useNavigate();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  // Client-side confirmation check. Clear the message as soon as the two
  // fields agree again, so the error does not linger while correcting.
  const mismatch =
    confirmPassword.length > 0 && confirmPassword !== password
      ? 'Passwords do not match'
      : undefined;

  const strength = assessPassword(password);
  const tooShort =
    password.length > 0 && password.length < 12
      ? 'Password must be at least 12 characters'
      : undefined;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});

    // Catch the two mismatches the API would reject, without a round trip.
    if (mismatch) {
      setFieldErrors({ confirmPassword: mismatch });
      return;
    }
    if (tooShort) {
      setFieldErrors({ password: tooShort });
      return;
    }
    if (!MOBILE_PATTERN.test(mobile)) {
      setFieldErrors({
        mobile: 'Enter a 10-digit Indian mobile number',
      });
      return;
    }

    setBusy(true);
    try {
      await register({
        fullName: fullName.trim(),
        email: email.trim(),
        mobile: mobile.trim(),
        password,
        confirmPassword,
        acceptTerms,
      });
      navigate('/account', { replace: true });
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(err.message);
        const next: Record<string, string> = {};
        for (const [field, messages] of Object.entries(err.fieldErrors)) {
          if (messages?.[0]) next[field] = messages[0];
        }
        setFieldErrors(next);
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      eyebrow="Join GrownLeaf"
      title="Create your account"
      intro="One account for orders, saved addresses and early access to new flag drops."
      footer={
        <AuthFooterLink prefix="Already have an account?" to="/login">
          Sign in
        </AuthFooterLink>
      }
    >
      <FormError message={error} />

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <TextField
          label="Full name"
          autoComplete="name"
          placeholder="Your full name"
          value={fullName}
          onChange={setFullName}
          error={fieldErrors.fullName}
          required
          disabled={busy}
        />

        <TextField
          label="Email address"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={setEmail}
          error={fieldErrors.email}
          required
          disabled={busy}
        />

        <TextField
          label="Mobile number"
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          placeholder="9876543210"
          maxLength={10}
          value={mobile}
          onChange={(v) => setMobile(v.replace(/\D/g, '').slice(0, 10))}
          error={fieldErrors.mobile}
          hint="10 digits, for order updates only."
          required
          disabled={busy}
        />

        <PasswordField
          label="Password"
          autoComplete="new-password"
          placeholder="A memorable passphrase works best"
          value={password}
          onChange={setPassword}
          error={fieldErrors.password}
          required
          disabled={busy}
        />

        <PasswordField
          label="Confirm password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          error={fieldErrors.confirmPassword ?? mismatch}
          required
          disabled={busy}
          showMeter={false}
        />

        {/*
          A real checkbox, not a styled div: it is keyboard-operable and the
          browser reports its state without us having to mirror it.
        */}
        <div className="flex items-start gap-2.5">
          <input
            id="accept-terms"
            type="checkbox"
            checked={acceptTerms}
            disabled={busy}
            onChange={(e) => setAcceptTerms(e.target.checked)}
            aria-describedby={
              fieldErrors.acceptTerms ? 'terms-error' : undefined
            }
            aria-invalid={fieldErrors.acceptTerms ? true : undefined}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-brass-deep)]"
          />
          <label
            htmlFor="accept-terms"
            className="text-[13px] leading-relaxed text-ink-soft"
          >
            I agree to the{' '}
            <Link
              to="/terms"
              target="_blank"
              rel="noreferrer"
              className="text-brass-deep underline hover:text-ink"
            >
              Terms and Conditions
            </Link>{' '}
            and{' '}
            <Link
              to="/privacy-policy"
              target="_blank"
              rel="noreferrer"
              className="text-brass-deep underline hover:text-ink"
            >
              Privacy Policy
            </Link>
            .
          </label>
        </div>
        {fieldErrors.acceptTerms ? (
          <p id="terms-error" role="alert" className="text-[12px] text-danger">
            {fieldErrors.acceptTerms}
          </p>
        ) : null}

        <Button type="submit" fullWidth size="lg" disabled={busy}>
          {busy ? 'Creating account…' : 'Create account'}
        </Button>

        {/*
          The meter is advisory. Shown as a note rather than a gate so a long
          passphrase is never told it is "not strong enough" for lacking a
          digit.
        */}
        {password.length > 0 ? (
          <p className="text-center text-[11px] text-ink-muted">
            {strength.problem ?? strength.advice ?? 'Password accepted.'}
          </p>
        ) : null}
      </form>
    </AuthLayout>
  );
}
