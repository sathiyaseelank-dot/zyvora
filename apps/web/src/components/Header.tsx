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

      <header className="sticky top-0 z-50 border-b border-rule bg-paper/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[1400px] items-center gap-6 px-5 py-4 sm:px-8">
          <Link to="/" className="flex flex-col whitespace-nowrap">
            <span className="font-display text-[22px] font-bold tracking-[0.17em] leading-none">
              ZYVORA
              <sup className="ml-0.5 align-super text-[8px] font-bold tracking-normal text-brass-deep">
                ®
              </sup>
            </span>
            <span className="hidden text-[7.5px] font-semibold tracking-[0.15em] text-ink-muted uppercase sm:inline-block">
              Quality | Style | For Your World
            </span>
          </Link>

          <nav aria-label="Primary" className="ml-4 hidden md:block">
            <ul className="flex items-center gap-7">
              {NAV.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      `text-[12px] tracking-[0.08em] uppercase transition-colors ${
                        isActive
                          ? 'text-brass-deep'
                          : 'text-ink-soft hover:text-brass-deep'
                      }`
                    }
                  >
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>

          <div className="ml-auto flex items-center gap-4">
            {/* Search is a real form so Enter submits and the value is a URL. */}
            <form
              role="search"
              action="/catalog"
              className="hidden items-center gap-2 border-b border-ink-muted/50 pb-1 lg:flex"
            >
              <label htmlFor="site-search" className="sr-only">
                Search flags
              </label>
              <input
                id="site-search"
                name="q"
                type="search"
                placeholder="Search"
                className="w-[150px] bg-transparent text-[12px] outline-none placeholder:text-ink-muted"
              />
              <button
                type="submit"
                className="text-[12px] text-ink-muted transition-colors hover:text-brass-deep"
              >
                <span aria-hidden="true">⌕</span>
                <span className="sr-only">Search</span>
              </button>
            </form>

            <CartLink />

            {status === 'authenticated' && user ? (
              <div className="hidden items-center gap-3 sm:flex">
                <Link
                  to="/account"
                  className="max-w-[140px] truncate text-[12px] tracking-[0.08em] text-ink-soft transition-colors hover:text-brass-deep"
                >
                  {user.fullName}
                </Link>
                <button
                  type="button"
                  onClick={() => void logout()}
                  className="text-[12px] tracking-[0.08em] text-ink-muted uppercase transition-colors hover:text-brass-deep"
                >
                  Sign out
                </button>
              </div>
            ) : (
              <Link
                to="/login"
                className="hidden text-[12px] tracking-[0.08em] text-ink-soft uppercase transition-colors hover:text-brass-deep sm:block"
              >
                Sign in
              </Link>
            )}

            <button
              ref={toggleRef}
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-expanded={menuOpen}
              aria-controls="mobile-menu"
              className="-mr-1 p-2 text-ink-soft md:hidden"
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
      className="relative text-[16px] text-ink-soft transition-colors hover:text-brass-deep"
    >
      <span aria-hidden="true">🛒</span>
      <span className="sr-only">
        Shopping cart{count > 0 ? `, ${count} items` : ', empty'}
      </span>
      {count > 0 ? (
        <span
          aria-hidden="true"
          className="absolute -top-2 -right-2 grid h-4 min-w-4 place-items-center rounded-full bg-flag-red px-1 text-[9px] font-bold text-white"
        >
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
    </Link>
  );
}
