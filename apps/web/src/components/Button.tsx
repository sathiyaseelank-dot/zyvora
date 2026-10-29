import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';

type Variant = 'brass' | 'ink' | 'ghost' | 'outline';
type Size = 'sm' | 'md' | 'lg';

const BASE =
  'inline-flex items-center justify-center gap-2.5 border font-semibold ' +
  'rounded-xl transition-all duration-200 ease-[var(--ease-out-soft)] ' +
  'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:transform-none shadow-xs ' +
  'active:scale-[0.98]';

const SIZES: Record<Size, string> = {
  sm: 'px-3.5 py-1.5 text-xs rounded-lg',
  md: 'px-5 py-2.5 text-sm rounded-xl',
  lg: 'px-6 py-3.5 text-sm sm:text-base rounded-xl font-semibold',
};

const VARIANTS: Record<Variant, string> = {
  brass:
    'bg-brass text-white border-transparent hover:bg-brass-light hover:shadow-md ' +
    'hover:-translate-y-0.5 active:translate-y-0',
  ink:
    'bg-ink text-white border-transparent hover:bg-ink-soft hover:shadow-md ' +
    'hover:-translate-y-0.5 active:translate-y-0',
  outline:
    'bg-white text-ink border-slate-200 hover:border-brass-deep hover:text-brass-deep ' +
    'hover:bg-slate-50',
  ghost:
    'bg-transparent text-ink border-transparent hover:text-brass-deep ' +
    'hover:bg-slate-100/60',
};

interface CommonProps {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
  children: ReactNode;
  className?: string;
}

export function Button({
  variant = 'brass',
  size = 'md',
  fullWidth = false,
  className = '',
  children,
  ...rest
}: CommonProps & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`${BASE} ${SIZES[size]} ${VARIANTS[variant]} ${
        fullWidth ? 'w-full' : ''
      } ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/**
 * A link styled as a button.
 *
 * Separate from `Button` on purpose: a router `Link` renders an anchor, and
 * calling a button handler on it produces the classic "opens in a new tab but
 * still uses fetch" bug. Keeping them apart makes the choice explicit.
 */
export function ButtonLink({
  to,
  variant = 'brass',
  size = 'md',
  fullWidth = false,
  className = '',
  children,
}: CommonProps & { to: string }) {
  return (
    <Link
      to={to}
      className={`${BASE} ${SIZES[size]} ${VARIANTS[variant]} ${
        fullWidth ? 'w-full' : ''
      } ${className}`}
    >
      {children}
    </Link>
  );
}
