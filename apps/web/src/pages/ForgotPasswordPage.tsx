import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { ApiRequestError } from '../lib/api';
import { requestPasswordReset } from '../lib/auth';
import {
  AuthFooterLink,
  AuthLayout,
  FormError,
  FormSuccess,
} from '../components/AuthLayout';
import { Button } from '../components/Button';
import { TextField } from '../components/Field';

/**
 * Forgot password (ZYV-116).
 *
 * The acknowledgement is deliberately IDENTICAL whether or not the address is
 * registered. The API already returns the same 202 and the same body for both
 * cases (ZYV-52), and burning comparable time on each path as well — showing a
 * different message here would undo both protections and turn this form into
 * an account-enumeration oracle.
 *
 * `devResetToken` appears only when the API runs with DEV_EXPOSE_RESET_TOKEN,
 * which it refuses to do in production. Its presence is detected rather than
 * assumed, so this screen needs no build-time flag of its own.
 */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [sent, setSent] = useState(false);
  const [devToken, setDevToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    setBusy(true);
    try {
      const result = await requestPasswordReset(email.trim());
      setSent(true);
      setDevToken(result.devResetToken ?? null);
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

  if (sent) {
    return (
      <AuthLayout
        eyebrow="Reset requested"
        title="Check your inbox"
        intro="If an account exists for that address, a reset link is on its way. The link expires in 30 minutes."
        footer={
          <AuthFooterLink prefix="Remembered it?" to="/login">
            Back to sign in
          </AuthFooterLink>
        }
      >
        <FormSuccess>
          <p>
            If an account exists for <strong>{email}</strong>, a password reset
            link has been sent.
          </p>
        </FormSuccess>

        {devToken ? (
          <div className="border border-dashed border-brass-deep/50 bg-brass/5 px-4 py-3">
            <p className="mb-2 text-[10px] font-bold tracking-[0.14em] text-brass-deep uppercase">
              Development only
            </p>
            <p className="mb-3 text-[12px] leading-relaxed text-ink-soft">
              No mail provider is configured yet, so the API returned the token
              directly. This panel cannot appear in production — the server
              refuses to start with this flag set outside development.
            </p>
            <Link
              to={`/reset-password?token=${encodeURIComponent(devToken)}`}
              className="inline-flex items-center gap-2 border border-brass-deep px-4 py-2.5 text-[10px] font-bold tracking-[0.13em] text-ink uppercase transition-colors hover:bg-brass hover:text-ground-deep"
            >
              Open the reset link
            </Link>
          </div>
        ) : null}
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      eyebrow="Account recovery"
      title="Reset your password"
      intro="Enter the email address on your account and we will send a link to set a new password."
      footer={
        <AuthFooterLink prefix="Remembered it?" to="/login">
          Back to sign in
        </AuthFooterLink>
      }
    >
      <FormError message={error} />

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <TextField
          label="Email address"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={setEmail}
          error={fieldErrors.email}
          hint="We will never confirm whether an address is registered."
          required
          disabled={busy}
        />

        <Button type="submit" fullWidth size="lg" disabled={busy}>
          {busy ? 'Sending…' : 'Send reset link'}
        </Button>
      </form>
    </AuthLayout>
  );
}
