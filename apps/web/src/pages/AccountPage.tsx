import { Link } from 'react-router-dom';

import { useSession } from '../lib/session';
import { ButtonLink } from '../components/Button';

/**
 * Account landing.
 *
 * Placeholder on purpose. E9 owns orders and addresses; this exists so
 * <RequireAuth> has a real destination and so the header's account link and
 * post-login redirect go somewhere rather than 404ing. It states the current
 * identity, which is the only part backed by the API today.
 */
export function AccountPage() {
  const { user } = useSession();

  return (
    <div className="mx-auto max-w-[460px] px-5 py-16 sm:py-20">
      <p className="eyebrow">Your account</p>
      <h1 className="font-display text-[38px] leading-[1.02] sm:text-[46px]">
        Hello, {user?.fullName?.split(' ')[0] ?? 'there'}
      </h1>

      <dl className="mt-8 divide-y divide-rule border-y border-rule">
        <div className="flex justify-between gap-4 py-3.5">
          <dt className="text-[11px] tracking-[0.1em] text-ink-muted uppercase">
            Name
          </dt>
          <dd className="text-[14px]">{user?.fullName}</dd>
        </div>
        <div className="flex justify-between gap-4 py-3.5">
          <dt className="text-[11px] tracking-[0.1em] text-ink-muted uppercase">
            Email
          </dt>
          <dd className="truncate text-[14px]">{user?.email}</dd>
        </div>
        <div className="flex justify-between gap-4 py-3.5">
          <dt className="text-[11px] tracking-[0.1em] text-ink-muted uppercase">
            Role
          </dt>
          <dd className="text-[14px] capitalize">{user?.role}</dd>
        </div>
      </dl>

      <p className="mt-8 text-[13px] leading-relaxed text-ink-muted">
        Order history and saved addresses arrive with E9. Your session is held
        in a secure HttpOnly cookie — nothing about it is readable from this
        page.
      </p>

      <div className="mt-8 flex flex-wrap gap-4">
        <ButtonLink to="/catalog" variant="outline" size="md">
          Continue shopping
        </ButtonLink>
        <Link
          to="/"
          className="self-center text-[12px] tracking-[0.08em] text-ink-muted uppercase transition-colors hover:text-brass-deep"
        >
          Back home
        </Link>
      </div>
    </div>
  );
}
