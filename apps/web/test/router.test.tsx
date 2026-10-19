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
      lines: [],
      totals: { subtotal: 0, discount: 0, total: 0, itemCount: 0 },
    }),
    fetchCategories: vi.fn().mockResolvedValue([]),
    fetchProducts: vi.fn().mockResolvedValue({
      data: [],
      pagination: { total: 0, page: 1, limit: 12, totalPages: 0 },
    }),
    fetchProduct: vi.fn(),
    searchProducts: vi.fn(),
    fetchOrders: vi.fn().mockResolvedValue({
      data: [],
      meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
    }),
    fetchOrder: vi.fn(),
    fetchAddresses: vi.fn().mockResolvedValue([]),
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
      lines: [],
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

  it('redirects unauthenticated user away from protected "/admin" route', async () => {
    renderAt('/admin');
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /sign in/i }),
      ).toBeInTheDocument();
    });
  });

  it('blocks non-admin authenticated customer from "/admin" route with 403', async () => {
    vi.mocked(auth.fetchCurrentUser).mockResolvedValue({
      id: 'cust-1',
      email: 'customer@zyvora.com',
      fullName: 'Customer Name',
      role: 'customer',
    });

    renderAt('/admin');
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /access restricted/i }),
      ).toBeInTheDocument();
    });
  });

  it('allows authenticated admin user to view "/admin" console (ZYV-98)', async () => {
    vi.mocked(auth.fetchCurrentUser).mockResolvedValue({
      id: 'admin-1',
      email: 'admin@zyvora.com',
      fullName: 'Admin User',
      role: 'admin',
    });

    renderAt('/admin');
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /control console/i }),
      ).toBeInTheDocument();
    });
  });

  it('allows authenticated customer to view "/account" dashboard (ZYV-97)', async () => {
    vi.mocked(auth.fetchCurrentUser).mockResolvedValue({
      id: 'cust-1',
      email: 'customer@zyvora.com',
      fullName: 'Customer Name',
      role: 'customer',
    });
    vi.mocked(api.fetchOrders).mockResolvedValue({
      data: [],
      meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
    });
    vi.mocked(api.fetchAddresses).mockResolvedValue([]);

    renderAt('/account');
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { level: 1, name: /hello/i }),
      ).toBeInTheDocument();
    });
  });

  it('renders CheckoutPage on "/checkout"', async () => {
    vi.mocked(api.fetchCart).mockResolvedValue({
      id: 'cart-1',
      lines: [
        {
          itemId: 'i-1',
          productId: 'p-1',
          name: 'ZYVORA Car Flag',
          image: '/flag.jpg',
          unitPrice: 1999,
          quantity: 1,
          lineTotal: 1999,
          available: 10,
        },
      ],
      totals: {
        subtotal: 1999,
        shipping: 0,
        discount: 0,
        total: 1999,
        itemCount: 1,
        freeShippingThreshold: 2000,
        amountToFreeShipping: 1,
      },
    } as any);

    renderAt('/checkout');
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { level: 1, name: /complete your order/i }),
      ).toBeInTheDocument();
    });
  });

  it('renders OrderConfirmationPage on "/order-confirmation/:id"', async () => {
    vi.mocked(api.fetchOrder).mockResolvedValue({
      id: 'ord-123',
      orderNumber: 'ZYV-2027-0001',
      status: 'confirmed',
      currency: 'INR',
      subtotal: 1999,
      shippingFee: 0,
      discount: 0,
      total: 1999,
      customerEmail: 'cust@zyvora.com',
      items: [],
      payment: { status: 'pending', method: 'deferred' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as any);

    renderAt('/order-confirmation/ord-123');
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { level: 1, name: /order confirmed/i }),
      ).toBeInTheDocument();
    });
  });

  it('renders ContactPage on "/contact"', async () => {
    renderAt('/contact');
    await waitFor(() => {
      expect(
        screen.getByRole('heading', {
          level: 1,
          name: /get in touch with zyvora/i,
        }),
      ).toBeInTheDocument();
    });
  });

  it('renders FaqPage on "/faq"', async () => {
    renderAt('/faq');
    await waitFor(() => {
      expect(
        screen.getByRole('heading', {
          level: 1,
          name: /frequently asked questions/i,
        }),
      ).toBeInTheDocument();
    });
  });

  it('renders PolicyPage on "/shipping-policy" and "/terms"', async () => {
    renderAt('/shipping-policy');
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { level: 1, name: /shipping policy/i }),
      ).toBeInTheDocument();
    });

    renderAt('/terms');
    await waitFor(() => {
      expect(
        screen.getByRole('heading', {
          level: 1,
          name: /terms and conditions/i,
        }),
      ).toBeInTheDocument();
    });
  });
});
