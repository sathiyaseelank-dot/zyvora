import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { ApiRequestError } from '../lib/api';
import { useSession } from '../lib/session';
import {
  AuthFooterLink,
  AuthLayout,
  FormError,
} from '../components/AuthLayout';
import { Button } from '../components/Button';
import { TextField } from '../components/Field';
import { PasswordField } from '../components/PasswordField';

/**
 * Sign in (ZYV-116).
 *
 * `identifier` is one field, not two, because the API accepts either an email
 * or a mobile number in the same slot. Splitting it into "email / phone" tabs
 * would constrain a user who typed the other kind without being told why.
 */

export function LoginPage() {
  const { login } = useSession();
  const navigate = useNavigate();
  const location = useLocation();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  // Where to go after signing in. `state.from` is set by <RequireAuth>, so a
  // protected screen bounced to here returns the user to where they meant to
  // be rather than dumping them on the home page.
  const from = (location.state as { from?: string } | null)?.from ?? '/account';

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    setBusy(true);
    try {
      await login({ identifier: identifier.trim(), password });
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof ApiRequestError) {
        // The API deliberately returns one identical message for "no such
        // account" and "wrong password" so it cannot be used to discover which
        // addresses are registered. The UI must not undo that by adding a
        // hint, so field errors are shown but the wording is the API's.
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
      eyebrow="Welcome back"
      title="Sign in to your account"
      intro="Access your orders, saved addresses and exclusive flag drops."
      footer={
        <AuthFooterLink prefix="New to ZYVORA?" to="/register">
          Create an account
        </AuthFooterLink>
      }
    >
      <FormError message={error} />

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <TextField
          label="Email or mobile"
          type="text"
          inputMode="email"
          autoComplete="username"
          placeholder="you@example.com"
          value={identifier}
          onChange={setIdentifier}
          error={fieldErrors.identifier}
          required
          disabled={busy}
        />

        <PasswordField
          label="Password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
          error={fieldErrors.password}
          required
          disabled={busy}
          showMeter={false}
        />

        <div className="flex items-center justify-between">
          <Link
            to="/forgot-password"
            className="text-[13px] text-ink-muted underline-offset-4 transition-colors hover:text-brass-deep hover:underline"
          >
            Forgot password?
          </Link>
        </div>

        <Button type="submit" fullWidth size="lg" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthLayout>
  );
}
