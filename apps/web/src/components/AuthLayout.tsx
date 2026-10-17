import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/**
 * Shared frame for the three authentication screens.
 *
 * Centred, single column, no distractions — the reference's restraint applied
 * to a task rather than a shopfront. One `<h1>` per screen, and the error
 * region sits above the form so it is reachable by screen readers in the
 * order a sighted user reads it.
 */

interface AuthLayoutProps {
  eyebrow: string;
  title: string;
  intro: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function AuthLayout({
  eyebrow,
  title,
  intro,
  children,
  footer,
}: AuthLayoutProps) {
  return (
    <div className="mx-auto w-full max-w-[460px] px-5 py-14 sm:py-20">
      <p className="eyebrow">{eyebrow}</p>

      <h1 className="font-display text-[38px] leading-[1.02] sm:text-[46px]">
        {title}
      </h1>

      <p className="mt-4 text-[14px] leading-relaxed text-ink-soft">{intro}</p>

      <div className="mt-9">{children}</div>

      {footer ? (
        <div className="mt-8 border-t border-rule pt-6 text-[13px] text-ink-soft">
          {footer}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Form-level error banner.
 *
 * `role="alert"` on an element that is ALWAYS rendered (toggled by content,
 * not mounting) so the live region is registered before the message arrives —
 * an `aria-live` node inserted together with its own text is often missed.
 */
export function FormError({ message }: { message?: string | null }) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className={message ? 'mb-5' : 'mb-0'}
    >
      {message ? (
        <div className="flex items-start gap-2 border border-danger/30 bg-danger-soft px-4 py-3">
          <span aria-hidden="true" className="text-danger">
            ⚠
          </span>
          <p className="text-[13px] leading-relaxed text-danger">{message}</p>
        </div>
      ) : null}
    </div>
  );
}

/** Confirmation banner for a success that has no redirect. */
export function FormSuccess({ children }: { children: ReactNode }) {
  return (
    <div className="mb-5 flex items-start gap-2 border border-success/30 bg-success-soft px-4 py-3">
      <span aria-hidden="true" className="text-success">
        ✓
      </span>
      <div className="text-[13px] leading-relaxed text-success">{children}</div>
    </div>
  );
}

/** Text link used under forms ("Already have an account?"). */
export function AuthFooterLink({
  prefix,
  to,
  children,
}: {
  prefix: string;
  to: string;
  children: ReactNode;
}) {
  return (
    <p>
      {prefix}{' '}
      <Link
        to={to}
        className="border-b border-brass-deep text-ink transition-colors hover:text-brass-deep"
      >
        {children}
      </Link>
    </p>
  );
}
