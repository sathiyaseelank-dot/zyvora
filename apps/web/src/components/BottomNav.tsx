import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

import { fetchCart } from '../lib/api';
import { useSession } from '../lib/session';

/**
 * Flipkart-style Mobile Bottom Sticky Navigation Bar.
 *
 * Provides persistent, one-handed thumb navigation across the primary
 * storefront areas on mobile devices (< md).
 *
 * Hidden on routes that provide their own dedicated full-width bottom
 * action dock (e.g. ProductDetailPage with 'Add to Cart' / 'Buy at ₹...'
 * and CheckoutPage).
 */
export function BottomNav() {
  const location = useLocation();
  const { status } = useSession();
  const [cartCount, setCartCount] = useState(0);

  // Poll cart count on navigation
  useEffect(() => {
    const controller = new AbortController();
    fetchCart(controller.signal)
      .then((cart) => setCartCount(cart.totals.itemCount))
      .catch(() => {
        // Keep last known value on error
      });
    return () => controller.abort();
  }, [location.pathname]);

  // Product detail pages and checkout have their own specialized sticky action bars
  const isExcluded =
    location.pathname.startsWith('/products/') ||
    location.pathname === '/checkout';

  if (isExcluded) {
    return null;
  }

  const navItems = [
    {
      to: '/',
      label: 'Home',
      end: true,
      icon: (active: boolean) => (
        <svg
          className={`h-5 w-5 ${active ? 'stroke-[2.2]' : 'stroke-[1.8]'}`}
          fill={active ? 'currentColor' : 'none'}
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
          />
        </svg>
      ),
    },
    {
      to: '/catalog',
      label: 'Categories',
      end: false,
      icon: (active: boolean) => (
        <svg
          className={`h-5 w-5 ${active ? 'stroke-[2.2]' : 'stroke-[1.8]'}`}
          fill={active ? 'currentColor' : 'none'}
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"
          />
        </svg>
      ),
    },
    {
      to: '/craft',
      label: 'Craft',
      end: false,
      icon: (active: boolean) => (
        <svg
          className={`h-5 w-5 ${active ? 'stroke-[2.2]' : 'stroke-[1.8]'}`}
          fill={active ? 'currentColor' : 'none'}
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
          />
        </svg>
      ),
    },
    {
      to: status === 'authenticated' ? '/account' : '/login',
      label: 'Account',
      end: false,
      icon: (active: boolean) => (
        <svg
          className={`h-5 w-5 ${active ? 'stroke-[2.2]' : 'stroke-[1.8]'}`}
          fill={active ? 'currentColor' : 'none'}
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
          />
        </svg>
      ),
    },
    {
      to: '/cart',
      label: 'Cart',
      end: false,
      badge: cartCount,
      icon: (active: boolean) => (
        <div className="relative">
          <svg
            className={`h-5 w-5 ${active ? 'stroke-[2.2]' : 'stroke-[1.8]'}`}
            fill={active ? 'currentColor' : 'none'}
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"
            />
          </svg>
          {cartCount > 0 && (
            <span
              aria-hidden="true"
              className="absolute -top-1.5 -right-2 grid h-4 min-w-4 place-items-center rounded-full bg-flag-red px-1 text-[9px] font-bold text-white shadow-xs"
            >
              {cartCount > 99 ? '99+' : cartCount}
            </span>
          )}
        </div>
      ),
    },
  ];

  return (
    <nav
      aria-label="Mobile Bottom Navigation"
      data-testid="mobile-bottom-nav"
      className="fixed bottom-0 inset-x-0 z-40 h-[56px] border-t border-slate-200/90 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-2px_12px_rgba(0,0,0,0.06)] backdrop-blur-md md:hidden"
    >
      <div className="mx-auto grid h-full max-w-md grid-cols-5 items-center">
        {navItems.map((item) => (
          <NavLink
            key={item.label}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-0.5 py-1 text-center transition-colors ${
                isActive
                  ? 'font-bold text-brass-deep'
                  : 'font-medium text-slate-500 hover:text-slate-800'
              }`
            }
          >
            {({ isActive }) => (
              <>
                {item.icon(isActive)}
                <span className="text-[10px] leading-tight tracking-tight">
                  {item.label}
                </span>
                {item.badge !== undefined && item.badge > 0 && (
                  <span className="sr-only">
                    {`, ${item.badge} items in cart`}
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
