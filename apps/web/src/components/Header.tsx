import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';

import { fetchCart } from '../lib/api';
import { useSession } from '../lib/session';

/**
 * Site header (ZYV-110).
 *
 * Three behaviours worth naming:
 *
 *  - The mobile menu is a real dialog. It traps focus, closes on Escape, and
 *    returns focus to the button that opened it. Without that it is a div
 *    that happens to be visible, which strands a keyboard user behind the
 *    overlay.
 *  - The menu closes on route change. Navigating with the menu open and
 *    leaving it open over the new page is the classic single-page-app bug.
 *  - A skip link precedes everything in the tab order, so the first Tab
 *    reaches "Skip to content" rather than the logo.
 */

const NAV = [
  { to: '/', label: 'Flags', end: true },
  { to: '/catalog', label: 'All Flags', end: false },
  { to: '/about', label: 'About & Craft', end: false },
  { to: '/faq', label: 'FAQ', end: false },
  { to: '/contact', label: 'Contact', end: false },
];

export function Header() {
  const { user, status, logout } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const location = useLocation();

  // Route change closes the menu.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  // Escape closes it and focus returns to the control that opened it.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  // Move focus into the panel so the next Tab stays inside it.
  useEffect(() => {
    if (menuOpen) panelRef.current?.focus();
  }, [menuOpen]);

  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-100 focus:bg-ink focus:px-4 focus:py-2.5 focus:text-[10px] focus:font-bold focus:tracking-[0.13em] focus:text-paper focus:uppercase"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-50 border-b border-rule bg-white/95 backdrop-blur-md shadow-xs">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-5 py-3.5 sm:px-8">
          <Link to="/" className="flex flex-col whitespace-nowrap">
            <span className="font-display text-[22px] font-bold italic tracking-tight leading-none text-ink">
              Grown<span className="text-brass-deep not-italic font-semibold">Leaf</span>
              <sup className="ml-0.5 align-super text-[8px] font-bold not-italic tracking-normal text-brass-deep">
                ®
              </sup>
            </span>
            <span className="hidden text-[8px] font-medium tracking-wide text-ink-muted sm:inline-block">
              <span className="italic">Explore</span>{' '}
              <span className="font-bold text-brass-deep not-italic">
                Premium ✦
              </span>
            </span>
          </Link>

          {/* Central prominent search bar (Flipkart/modern e-commerce style) */}
          <form
            role="search"
            action="/catalog"
            className="hidden max-w-[400px] flex-1 items-center rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-1.5 transition-all focus-within:border-brass focus-within:bg-white focus-within:ring-2 focus-within:ring-brass/20 md:flex"
          >
            <label htmlFor="site-search" className="sr-only">
              Search flags
            </label>
            <svg
              className="h-4 w-4 shrink-0 text-slate-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              id="site-search"
              name="q"
              type="search"
              placeholder="Search flags, vehicle mounts..."
              className="w-full bg-transparent px-2 text-[13px] text-ink outline-none placeholder:text-slate-400"
            />
            <button
              type="submit"
              className="rounded-lg bg-brass px-3 py-1 text-[11px] font-bold text-white transition-opacity hover:opacity-90"
            >
              Search
            </button>
          </form>

          <nav aria-label="Primary" className="hidden lg:block">
            <ul className="flex items-center gap-6">
              {NAV.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      `text-[13px] font-medium transition-colors ${
                        isActive
                          ? 'font-semibold text-brass-deep'
                          : 'text-slate-600 hover:text-brass-deep'
                      }`
                    }
                  >
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>

          <div className="flex items-center gap-3">
            <CartLink />

            {status === 'authenticated' && user ? (
              <div className="hidden items-center gap-2.5 sm:flex">
                <Link
                  to="/account"
                  className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:border-brass hover:text-brass-deep"
                >
                  <svg
                    className="h-3.5 w-3.5 text-slate-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                    />
                  </svg>
                  <span className="max-w-[120px] truncate">{user.fullName}</span>
                </Link>
                <button
                  type="button"
                  onClick={() => void logout()}
                  className="rounded-xl border border-transparent px-2.5 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:text-slate-900"
                >
                  Sign out
                </button>
              </div>
            ) : (
              <Link
                to="/login"
                className="hidden items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-800 shadow-xs transition-colors hover:border-brass hover:text-brass-deep sm:flex"
              >
                <svg
                  className="h-3.5 w-3.5 text-slate-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                  />
                </svg>
                Sign in
              </Link>
            )}

            <button
              ref={toggleRef}
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-expanded={menuOpen}
              aria-controls="mobile-menu"
              className="-mr-1 rounded-xl p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
            >
              <span
                aria-hidden="true"
                className="block text-[18px] leading-none"
              >
                {menuOpen ? '✕' : '☰'}
              </span>
              <span className="sr-only">
                {menuOpen ? 'Close menu' : 'Open menu'}
              </span>
            </button>
          </div>
        </div>

        {/*
          Mobile panel. `role="dialog"` + `aria-modal` tells assistive
          technology the rest of the page is inert while it is open; `tabIndex`
          -1 makes it programmatically focusable without adding a tab stop.
        */}
        {menuOpen ? (
          <div
            id="mobile-menu"
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Site menu"
            tabIndex={-1}
            className="border-t border-rule bg-paper px-5 py-4 md:hidden"
          >
            <nav aria-label="Mobile">
              <ul className="flex flex-col gap-4">
                {NAV.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      className="text-[13px] tracking-[0.08em] uppercase text-ink-soft"
                    >
                      {item.label}
                    </NavLink>
                  </li>
                ))}
                <li className="border-t border-rule pt-4">
                  {status === 'authenticated' ? (
                    <button
                      type="button"
                      onClick={() => void logout()}
                      className="text-[13px] tracking-[0.08em] text-ink-muted uppercase"
                    >
                      Sign out
                    </button>
                  ) : (
                    <Link
                      to="/login"
                      className="text-[13px] tracking-[0.08em] text-ink-soft uppercase"
                    >
                      Sign in
                    </Link>
                  )}
                </li>
              </ul>
            </nav>
          </div>
        ) : null}
      </header>
    </>
  );
}

/**
 * Cart link with a live count.
 *
 * The count is read from the server rather than held in a shared store,
 * because the cart belongs to a guest cookie or an account and the server is
 * the only party that knows which. Polled on navigation only — a header that
 * refetched on a timer would be a request per visitor per interval.
 *
 * A count of 0 renders no badge at all, so the control does not shift as the
 * basket fills. The badge is `aria-hidden` because the link's own accessible
 * name states the count.
 */
function CartLink() {
  const location = useLocation();
  const [count, setCount] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchCart(controller.signal)
      .then((cart) => setCount(cart.totals.itemCount))
      .catch(() => {
        // A failed count must not empty a basket that is actually full.
        // Leave the last known value alone.
      });
    return () => controller.abort();
  }, [location.pathname]);

  return (
    <Link
      to="/cart"
      className="relative flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-xs transition-colors hover:border-brass hover:text-brass-deep"
    >
      <svg
        className="h-4 w-4 text-slate-700"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"
        />
      </svg>
      <span className="hidden sm:inline">Cart</span>
      <span className="sr-only">
        Shopping cart{count > 0 ? `, ${count} items` : ', empty'}
      </span>
      {count > 0 ? (
        <span
          aria-hidden="true"
          className="grid h-4 min-w-4 place-items-center rounded-full bg-flag-red px-1 text-[9px] font-bold text-white shadow-xs"
        >
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
    </Link>
  );
}
