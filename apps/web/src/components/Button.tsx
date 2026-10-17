import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';

type Variant = 'brass' | 'ink' | 'ghost' | 'outline';
type Size = 'sm' | 'md' | 'lg';

const BASE =
  'inline-flex items-center justify-center gap-3 border font-bold uppercase ' +
  'tracking-[0.13em] transition-[background-color,color,transform,border-color] ' +
  'duration-200 ease-[var(--ease-out-soft)] disabled:cursor-not-allowed ' +
  'disabled:opacity-55 disabled:hover:transform-none';

const SIZES: Record<Size, string> = {
  sm: 'px-4 py-2.5 text-[10px]',
  md: 'px-5 py-3.5 text-[10px]',
  lg: 'px-6 py-4 text-[11px]',
};

const VARIANTS: Record<Variant, string> = {
  // Brass fill with ink text — the reference's signature action, and the
  // highest-contrast pairing in the palette (8.9:1).
  brass:
    'bg-brass text-ground-deep border-transparent hover:bg-brass-light ' +
    'hover:-translate-y-0.5 active:translate-y-0',
  ink:
    'bg-ink text-paper border-transparent hover:bg-ink-soft ' +
    'hover:-translate-y-0.5 active:translate-y-0',
  outline:
    'bg-transparent text-ink border-ink/25 hover:border-brass-deep ' +
    'hover:text-brass-deep',
  // Transparent until hovered. Used on ink grounds, where a bordered button
  // would read as a box floating on the hero.
  ghost:
    'bg-transparent text-ink border-transparent hover:text-brass-deep ' +
    'hover:border-brass-deep/40',
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
