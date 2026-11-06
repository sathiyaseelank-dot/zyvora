import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { BottomNav } from '../src/components/BottomNav';
import { SessionProvider } from '../src/lib/session';
import * as api from '../src/lib/api';
import * as auth from '../src/lib/auth';

vi.mock(import('../src/lib/auth'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchCurrentUser: vi.fn(),
  };
});

vi.mock(import('../src/lib/api'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchCart: vi.fn(),
  };
});

function renderNav(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SessionProvider>
        <BottomNav />
      </SessionProvider>
    </MemoryRouter>,
  );
}

describe('BottomNav mobile navigation component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth.fetchCurrentUser).mockResolvedValue(null);
    vi.mocked(api.fetchCart).mockResolvedValue({
      id: 'cart-1',
      lines: [],
      totals: { subtotal: 0, discount: 0, total: 0, itemCount: 0 },
    });
  });

  it('renders all 5 primary navigation tabs on home page', async () => {
    renderNav('/');

    const nav = await screen.findByRole('navigation', {
      name: /mobile bottom navigation/i,
    });
    expect(nav).toBeInTheDocument();
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Categories')).toBeInTheDocument();
    expect(screen.getByText('Craft')).toBeInTheDocument();
    expect(screen.getByText('Account')).toBeInTheDocument();
    expect(screen.getByText('Cart')).toBeInTheDocument();
  });

  it('shows the cart count badge when items are present', async () => {
    vi.mocked(api.fetchCart).mockResolvedValue({
      id: 'cart-1',
      lines: [],
      totals: { subtotal: 500, discount: 0, total: 500, itemCount: 3 },
    });

    renderNav('/');

    expect(await screen.findByText('3')).toBeInTheDocument();
  });

  it('hides completely on product detail pages so product action bar has focus', async () => {
    renderNav('/products/some-product-id');

    expect(
      screen.queryByRole('navigation', {
        name: /mobile bottom navigation/i,
      }),
    ).toBeNull();
  });

  it('hides on checkout page to avoid distraction', async () => {
    renderNav('/checkout');

    expect(
      screen.queryByRole('navigation', {
        name: /mobile bottom navigation/i,
      }),
    ).toBeNull();
  });
});
