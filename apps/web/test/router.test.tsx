import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { App } from '../src/App';
import { SessionProvider } from '../src/lib/session';
import * as auth from '../src/lib/auth';
import * as api from '../src/lib/api';

/**
 * ZYV-1317 — SPA Router and Navigation Infrastructure.
 *
 * Asserts the route table wiring, public accessible pages, error handling,
 * and route protection (RequireAuth / RequireAnonymous).
 */

vi.mock(import('../src/lib/auth'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchCurrentUser: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
  };
});

vi.mock(import('../src/lib/api'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchCart: vi.fn().mockResolvedValue({
      id: 'mock-cart-id',
      items: [],
      totals: { subtotal: 0, discount: 0, total: 0, itemCount: 0 },
    }),
    fetchCategories: vi.fn().mockResolvedValue([]),
    fetchProducts: vi.fn().mockResolvedValue({
      data: [],
      pagination: { total: 0, page: 1, limit: 12, totalPages: 0 },
    }),
    fetchProduct: vi.fn(),
    searchProducts: vi.fn(),
  };
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SessionProvider>
        <App />
      </SessionProvider>
    </MemoryRouter>,
  );
}

describe('App Router Wiring (ZYV-1317)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth.fetchCurrentUser).mockResolvedValue(null);
    vi.mocked(api.fetchCart).mockResolvedValue({
      id: 'mock-cart-id',
      items: [],
      totals: { subtotal: 0, discount: 0, total: 0, itemCount: 0 },
    });
    vi.mocked(api.fetchCategories).mockResolvedValue([]);
    vi.mocked(api.fetchProducts).mockResolvedValue({
      data: [],
      pagination: { total: 0, page: 1, limit: 12, totalPages: 0 },
    });
  });

  it('renders HomePage on root route "/"', async () => {
    renderAt('/');
    await waitFor(() => {
      expect(
        screen.getByRole('heading', {
          level: 1,
          name: /flags that fly first/i,
        }),
      ).toBeInTheDocument();
    });
  });

  it('renders CatalogPage on "/catalog"', async () => {
    renderAt('/catalog');
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { level: 1, name: /every flag/i }),
      ).toBeInTheDocument();
    });
  });

  it('renders CraftPage on "/about"', async () => {
    renderAt('/about');
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { level: 1, name: /made for the road/i }),
      ).toBeInTheDocument();
    });
  });

  it('renders CartPage on "/cart"', async () => {
    renderAt('/cart');
    await waitFor(() => {
      expect(
        screen.getByRole('heading', {
          level: 1,
          name: /nothing in the basket/i,
        }),
      ).toBeInTheDocument();
    });
  });

  it('renders LoginPage on "/login" when anonymous', async () => {
    renderAt('/login');
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /sign in/i }),
      ).toBeInTheDocument();
    });
  });

  it('renders RegisterPage on "/register" when anonymous', async () => {
    renderAt('/register');
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /create your account/i }),
      ).toBeInTheDocument();
    });
  });

  it('renders ForgotPasswordPage on "/forgot-password"', async () => {
    renderAt('/forgot-password');
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /reset your password/i }),
      ).toBeInTheDocument();
    });
  });

  it('renders NotFoundPage on unmapped routes', async () => {
    renderAt('/some-nonexistent-page-route');
    await waitFor(() => {
      expect(
        screen.getByRole('heading', {
          level: 1,
          name: /this flag is not in our range/i,
        }),
      ).toBeInTheDocument();
    });
  });

  it('redirects unauthenticated user away from protected "/account" route', async () => {
    renderAt('/account');
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /sign in/i }),
      ).toBeInTheDocument();
    });
  });
});
