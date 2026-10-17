import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { ApiRequestError } from '../lib/api';
import { resetPassword } from '../lib/auth';
import {
  AuthFooterLink,
  AuthLayout,
  FormError,
} from '../components/AuthLayout';
import { Button } from '../components/Button';
import { PasswordField } from '../components/PasswordField';

/**
 * Set a new password (ZYV-116, completing the E6-S9 loop).
 *
 * The token arrives as `?token=`. It is read from the URL and immediately
 * removed with `replace: true` so it does not survive in the address bar, get
 * bookmarked, or ride along in a referrer header to the next site. That is the
 * one thing this screen can do that a plain form cannot.
 *
 * A successful reset also revokes every existing session server-side, so
 * landing on /login afterwards is not merely tidy — other devices are locked
 * out at the same time.
 */
export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // Read then strip, in one render pass.
  const [token] = useState(() => searchParams.get('token') ?? '');
  if (searchParams.has('token')) {
    searchParams.delete('token');
    window.history.replaceState(
      {},
      '',
      `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ''}`,
    );
  }

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const mismatch =
    confirmPassword.length > 0 && confirmPassword !== password
      ? 'Passwords do not match'
      : undefined;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});

    if (mismatch) {
      setFieldErrors({ confirmPassword: mismatch });
      return;
    }

    setBusy(true);
    try {
      await resetPassword({ token, password, confirmPassword });
      navigate('/login', { replace: true });
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

  // A link that arrived without a token, or opened after the token was already
  // spent, is not a form worth showing.
  if (!token) {
    return (
      <AuthLayout
        eyebrow="Reset link"
        title="This link is incomplete"
        intro="The reset link is missing its token. Request a new one and try again."
        footer={
          <AuthFooterLink prefix="" to="/forgot-password">
            Request a new link
          </AuthFooterLink>
        }
      >
        <Link
          to="/forgot-password"
          className="inline-flex items-center border border-brass-deep px-6 py-4 text-[11px] font-bold tracking-[0.13em] uppercase transition-colors hover:bg-brass hover:text-ground-deep"
        >
          Send me a new link
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      eyebrow="Almost there"
      title="Set a new password"
      intro="Choose something you have not used elsewhere. You will be signed out everywhere once this is done."
      footer={
        <AuthFooterLink prefix="Remembered it?" to="/login">
          Back to sign in
        </AuthFooterLink>
      }
    >
      <FormError message={error} />

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <PasswordField
          label="New password"
          autoComplete="new-password"
          placeholder="A memorable passphrase works best"
          value={password}
          onChange={setPassword}
          error={fieldErrors.password}
          required
          disabled={busy}
        />

        <PasswordField
          label="Confirm new password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          error={fieldErrors.confirmPassword ?? mismatch}
          required
          disabled={busy}
          showMeter={false}
        />

        <Button type="submit" fullWidth size="lg" disabled={busy}>
          {busy ? 'Saving…' : 'Set new password'}
        </Button>
      </form>
    </AuthLayout>
  );
}
