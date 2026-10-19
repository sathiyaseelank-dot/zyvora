import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { CheckoutPage } from '../src/pages/CheckoutPage';
import { OrderConfirmationPage } from '../src/pages/OrderConfirmationPage';
import { AccountPage } from '../src/pages/AccountPage';
import { SessionProvider } from '../src/lib/session';
import * as auth from '../src/lib/auth';
import * as api from '../src/lib/api';

vi.mock(import('../src/lib/auth'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchCurrentUser: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
  };
});

vi.mock(import('../src/lib/api'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchCart: vi.fn(),
    fetchAddresses: vi.fn(),
    createAddress: vi.fn(),
    validateCheckout: vi.fn(),
    createOrder: vi.fn(),
    fetchOrders: vi.fn(),
    fetchOrder: vi.fn(),
    cancelOrder: vi.fn(),
    requestReturn: vi.fn(),
    updateProfile: vi.fn(),
    changePassword: vi.fn(),
  };
});

const MOCK_CART = {
  id: 'cart-1',
  lines: [
    {
      itemId: 'item-1',
      productId: 'prod-1',
      name: 'ZYVORA Tricolor Car Flag',
      image: '/flag1.jpg',
      unitPrice: 1999,
      quantity: 1,
      lineTotal: 1999,
      available: 20,
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
};

const MOCK_ADDRESS = {
  id: 'addr-1',
  userId: 'user-1',
  fullName: 'Arjun Verma',
  mobile: '9876543210',
  email: 'arjun@example.com',
  houseNumberAndStreet: 'Flat 402, Lotus Towers',
  area: 'Indiranagar',
  landmark: 'Near Metro',
  city: 'Bengaluru',
  state: 'Karnataka',
  pinCode: '560038',
  country: 'India',
  deliveryInstructions: 'Leave with guard',
  isDefault: true,
  createdAt: '2027-02-01T10:00:00Z',
  updatedAt: '2027-02-01T10:00:00Z',
};

const MOCK_ORDER = {
  id: 'ord-999',
  user_id: 'user-1',
  checkout_session_id: 'sess-123',
  shippingAddress: MOCK_ADDRESS,
  status: 'confirmed',
  subtotal: 1999,
  shipping: 0,
  tax: 0,
  discount: 0,
  total: 1999,
  items: [
    {
      id: 'oi-1',
      order_id: 'ord-999',
      product_id: 'prod-1',
      name: 'ZYVORA Tricolor Car Flag',
      unit_price: 1999,
      quantity: 1,
    },
  ],
  payment: {
    id: 'pay-1',
    order_id: 'ord-999',
    amount: 1999,
    currency: 'INR',
    method: 'deferred',
    status: 'pending',
  },
  shipment: {
    id: 'ship-1',
    order_id: 'ord-999',
    carrier: 'BlueDart Express',
    tracking_number: 'BD123456789IN',
    status: 'shipped',
    shipped_at: '2027-02-02T10:00:00Z',
    delivered_at: null,
  },
  created_at: '2027-02-01T12:00:00Z',
  updated_at: '2027-02-01T12:00:00Z',
};

describe('CheckoutPage (ZYV-99, ZYV-61, ZYV-66)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    vi.mocked(api.fetchCart).mockResolvedValue(MOCK_CART as any);
    vi.mocked(api.fetchAddresses).mockResolvedValue([MOCK_ADDRESS]);
    vi.mocked(api.validateCheckout).mockResolvedValue({
      canCheckout: true,
      blockers: [],
      totals: {
        subtotal: 1999,
        shipping: 0,
        discount: 0,
        total: 1999,
      },
      lines: [
        {
          itemId: 'item-1',
          productId: 'prod-1',
          name: 'ZYVORA Tricolor Car Flag',
          price: 1999,
          requestedQuantity: 1,
        },
      ],
      address: MOCK_ADDRESS,
    });
  });

  it('renders delivery address step and saved address for authenticated user', async () => {
    vi.mocked(auth.fetchCurrentUser).mockResolvedValue({
      id: 'user-1',
      email: 'arjun@example.com',
      fullName: 'Arjun Verma',
      role: 'customer',
    });

    render(
      <MemoryRouter initialEntries={['/checkout']}>
        <SessionProvider>
          <CheckoutPage />
        </SessionProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Arjun Verma')).toBeInTheDocument();
    });
    expect(screen.getByText(/Flat 402, Lotus Towers/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /continue to order review/i }),
    ).toBeInTheDocument();
  });

  it('progresses to Review and Payment steps and places order', async () => {
    const user = userEvent.setup();
    vi.mocked(auth.fetchCurrentUser).mockResolvedValue({
      id: 'user-1',
      email: 'arjun@example.com',
      fullName: 'Arjun Verma',
      role: 'customer',
    });
    vi.mocked(api.createOrder).mockResolvedValue({
      order: MOCK_ORDER as any,
      items: MOCK_ORDER.items as any,
    });

    render(
      <MemoryRouter initialEntries={['/checkout']}>
        <SessionProvider>
          <Routes>
            <Route path="/checkout" element={<CheckoutPage />} />
            <Route
              path="/order-confirmation/:id"
              element={<div>Order Confirmation Rendered</div>}
            />
          </Routes>
        </SessionProvider>
      </MemoryRouter>,
    );

    // Step 1: Click Continue to Order Review
    await waitFor(() => {
      expect(screen.getByText('Arjun Verma')).toBeInTheDocument();
    });
    const reviewBtn = screen.getByRole('button', {
      name: /continue to order review/i,
    });
    await user.click(reviewBtn);

    // Step 2: Order Review step
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { level: 2, name: /review order/i }),
      ).toBeInTheDocument();
    });
    expect(screen.getByText('ZYVORA Tricolor Car Flag')).toBeInTheDocument();

    const proceedPayBtn = screen.getByRole('button', {
      name: /proceed to payment/i,
    });
    await user.click(proceedPayBtn);

    // Step 3: Payment step
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { level: 2, name: /payment method/i }),
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/standard checkout/i)).toBeInTheDocument();

    const payNowBtn = screen.getByRole('button', { name: /pay now/i });
    await user.click(payNowBtn);

    await waitFor(() => {
      expect(api.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          addressId: 'addr-1',
        }),
      );
    });
  });
});

describe('OrderConfirmationPage (ZYV-82)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.fetchOrder).mockResolvedValue(MOCK_ORDER as any);
  });

  it('renders placed order summary, status, address, and items', async () => {
    render(
      <MemoryRouter initialEntries={['/order-confirmation/ord-999']}>
        <Routes>
          <Route
            path="/order-confirmation/:id"
            element={<OrderConfirmationPage />}
          />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { level: 1, name: /order confirmed/i }),
      ).toBeInTheDocument();
    });
    expect(screen.getByText('ord-999')).toBeInTheDocument();
    expect(screen.getByText('ZYVORA Tricolor Car Flag')).toBeInTheDocument();
    expect(screen.getByText('Arjun Verma')).toBeInTheDocument();
    expect(screen.getByText(/Flat 402, Lotus Towers/)).toBeInTheDocument();
  });
});

describe('AccountPage (ZYV-97, ZYV-77, ZYV-89, ZYV-87, ZYV-79)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth.fetchCurrentUser).mockResolvedValue({
      id: 'user-1',
      email: 'arjun@example.com',
      fullName: 'Arjun Verma',
      role: 'customer',
    });
    vi.mocked(api.fetchOrders).mockResolvedValue({
      data: [MOCK_ORDER as any],
      meta: { page: 1, limit: 10, total: 1, totalPages: 1 },
    });
    vi.mocked(api.fetchAddresses).mockResolvedValue([MOCK_ADDRESS]);
  });

  it('renders orders tab with tracking and allows order cancellation', async () => {
    const user = userEvent.setup();
    vi.mocked(api.cancelOrder).mockResolvedValue({
      order: { ...MOCK_ORDER, status: 'cancelled' } as any,
      message: 'Order cancelled successfully',
    });

    render(
      <MemoryRouter>
        <SessionProvider>
          <AccountPage />
        </SessionProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/ord-999/)).toBeInTheDocument();
    });
    expect(screen.getByText(/BD123456789IN/)).toBeInTheDocument();

    const cancelBtn = screen.getByRole('button', { name: /^cancel order$/i });
    await user.click(cancelBtn);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /confirm cancel/i }),
      ).toBeInTheDocument();
    });

    const confirmCancelBtn = screen.getByRole('button', {
      name: /confirm cancel/i,
    });
    await user.click(confirmCancelBtn);

    await waitFor(() => {
      expect(api.cancelOrder).toHaveBeenCalledWith('ord-999', undefined);
    });
  });

  it('switches to Profile tab and updates profile info', async () => {
    const user = userEvent.setup();
    vi.mocked(api.updateProfile).mockResolvedValue({
      id: 'user-1',
      email: 'arjun@example.com',
      fullName: 'Arjun V.',
      mobile: '9876543211',
    });

    render(
      <MemoryRouter>
        <SessionProvider>
          <AccountPage />
        </SessionProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /profile & security/i }),
      ).toBeInTheDocument();
    });

    const profileTab = screen.getByRole('button', {
      name: /profile & security/i,
    });
    await user.click(profileTab);

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { level: 2, name: /personal details/i }),
      ).toBeInTheDocument();
    });

    const updateBtn = screen.getByRole('button', { name: /update profile/i });
    await user.click(updateBtn);

    await waitFor(() => {
      expect(api.updateProfile).toHaveBeenCalled();
    });
  });
});
