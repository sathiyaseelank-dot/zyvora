import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';

import { useSession } from '../lib/session';

/**
 * Route guard.
 *
 * The one thing this must get right is the wait. While the session is still
 * being resolved the correct render is NOTHING — redirecting on
 * `status === 'anonymous'` alone would bounce a signed-in user to /login on
 * every hard refresh, because the first render is always 'loading'.
 *
 * The destination is carried in `state.from` so the user returns to the screen
 * they wanted rather than the home page.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const location = useLocation();

  if (status === 'loading') {
    // Visually quiet, but announced, so a screen-reader user is told the page
    // is working rather than being left in silence.
    return (
      <div
        role="status"
        aria-live="polite"
        className="mx-auto max-w-[460px] px-5 py-20 text-center"
      >
        <p className="text-[11px] tracking-[0.14em] text-ink-muted uppercase">
          Checking your session…
        </p>
      </div>
    );
  }

  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}

/** Keeps a signed-in user off /login and /register. */
export function RequireAnonymous({ children }: { children: ReactNode }) {
  const { status } = useSession();

  if (status === 'loading') return null;
  if (status === 'authenticated') return <Navigate to="/account" replace />;

  return <>{children}</>;
}
