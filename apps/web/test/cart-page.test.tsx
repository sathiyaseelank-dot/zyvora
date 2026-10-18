import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { CartPage } from '../src/pages/CartPage';
import * as api from '../src/lib/api';

/**
 * ZYV-113 — the cart page.
 *
 * The property that matters: the page DISPLAYS what the server computed and
 * never recomputes it. A cart that summed its own lines would look right in
 * every test and still disagree with the order the server creates, because the
 * server reprices from the database on read.
 *
 * Two tricks make that falsifiable rather than assumed:
 *
 *  - Two lines, so no line total equals the subtotal and every assertion names
 *    one specific figure.
 *  - The totals do NOT add up: shipping 0 on a 2397 subtotal (right, it clears
 *    the threshold) but a total of 2401, a rupee of invented tax. A component
 *    deriving anything renders 2397 and these assertions fail.
 *
 * And the line totals deliberately do NOT sum to the server's subtotal: 1999 +
 * 398 = 2397, which is exactly what the subtotal says, so a browser summing
 * its own lines got the right answer and "displays the server figure" passed
 * while proving nothing. Mutation testing caught it — swapping
 * `{totals.subtotal}` for a local reduce left all 16 tests green. So line B
 * below reports 396 against a 199 unit price, standing in for a rupee-scale
 * server-side adjustment a client cannot reproduce. The lines now sum to 2395.
 */

const LINE_A = {
  itemId: 'a1b2c3d4-0000-4000-8000-000000000001',
  productId: 'a1b2c3d4-0000-4000-8000-000000000011',
  name: 'ZYVORA Deluxe Car Flag',
  image: 'https://example.invalid/one.jpg',
  unitPrice: 1999,
  quantity: 1,
  lineTotal: 1999,
  available: 75,
};

const LINE_B = {
  itemId: 'a1b2c3d4-0000-4000-8000-000000000002',
  productId: 'a1b2c3d4-0000-4000-8000-000000000012',
  name: 'ZYVORA Bike Flag Mini',
  image: 'https://example.invalid/two.jpg',
  unitPrice: 199,
  quantity: 2,
  // 199 x 2 = 398, reported as 396. See the note above: that gap is what makes
  // a client-side sum detectable.
  lineTotal: 396,
  available: 200,
};

const cart = {
  lines: [LINE_A, LINE_B],
  totals: {
    subtotal: 2397,
    shipping: 0,
    discount: 0,
    total: 2401,
    itemCount: 3,
    freeShippingThreshold: 2000,
    amountToFreeShipping: 0,
  },
};

function renderCart() {
  return render(
    <MemoryRouter>
      <CartPage />
    </MemoryRouter>,
  );
}

/** Wait for the server's authoritative total to appear. */
const ready = () =>
  waitFor(() => expect(screen.getByText('₹2,401')).toBeInTheDocument());

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('CartPage renders the server figures', () => {
  it('shows line totals, subtotal and total verbatim', async () => {
    vi.spyOn(api, 'fetchCart').mockResolvedValue(cart);
    renderCart();

    await ready();
    expect(screen.getByText('₹1,999')).toBeInTheDocument(); // line A
    expect(screen.getByText('₹396')).toBeInTheDocument(); // line B
    expect(screen.getByText('₹2,397')).toBeInTheDocument(); // subtotal
    expect(screen.getByText('₹2,401')).toBeInTheDocument(); // total
    expect(screen.getByText('Total')).toBeInTheDocument();
  });

  it('shows the item count for the whole basket, not the number of lines', async () => {
    vi.spyOn(api, 'fetchCart').mockResolvedValue(cart);
    renderCart();

    await ready();
    // 3 units across 2 lines.
    expect(
      screen.getByRole('heading', { name: '3 flags' }),
    ).toBeInTheDocument();
  });

  it('does not derive a shipping figure of its own', async () => {
    vi.spyOn(api, 'fetchCart').mockResolvedValue(cart);
    renderCart();

    await ready();
    // The server said zero, and the subtotal clears the threshold. A client
    // that recomputed from the subtotal could land here by luck, so the
    // negative case below is the real check.
    expect(screen.getByText('Free')).toBeInTheDocument();
    expect(screen.queryByText('₹99')).not.toBeInTheDocument();
  });

  it('shows the shipping amount the server sent even when it is surprising', async () => {
    // Below the threshold, but the server charged 1. A client would say 99.
    vi.spyOn(api, 'fetchCart').mockResolvedValue({
      ...cart,
      totals: {
        ...cart.totals,
        subtotal: 1999,
        shipping: 1,
        total: 2000,
        amountToFreeShipping: 1,
      },
    });
    renderCart();

    await waitFor(() => expect(screen.getByText('₹2,000')).toBeInTheDocument());
    expect(screen.getByText('₹1')).toBeInTheDocument();
    expect(screen.queryByText('₹99')).not.toBeInTheDocument();
  });

  it('uses the server shortfall in the free-delivery nudge', async () => {
    vi.spyOn(api, 'fetchCart').mockResolvedValue({
      ...cart,
      totals: { ...cart.totals, amountToFreeShipping: 42 },
    });
    renderCart();

    await ready();
    expect(
      screen.getByText(/add ₹42 more for free delivery/i),
    ).toBeInTheDocument();
  });

  it('confirms free delivery when the server says there is no shortfall', async () => {
    vi.spyOn(api, 'fetchCart').mockResolvedValue(cart);
    renderCart();

    await ready();
    expect(screen.getByText(/free delivery applied/i)).toBeInTheDocument();
  });
});

describe('CartPage empty and failure states', () => {
  it('invites browsing rather than showing an error', async () => {
    vi.spyOn(api, 'fetchCart').mockResolvedValue({
      lines: [],
      totals: { ...cart.totals, itemCount: 0, subtotal: 0, total: 0 },
    });
    renderCart();

    await waitFor(() =>
      expect(screen.getByText(/nothing in the basket/i)).toBeInTheDocument(),
    );
    expect(
      screen.getByRole('link', { name: /browse the collection/i }),
    ).toBeInTheDocument();
  });

  it('says the shop is unreachable instead of showing an empty basket', async () => {
    // An empty basket and a failed fetch look identical on screen. Rendering
    // "nothing in the basket" after a network error would tell a shopper with
    // nine flags in their basket that they have none.
    vi.spyOn(api, 'fetchCart').mockRejectedValue(
      new api.NetworkError('http://localhost:4000'),
    );
    renderCart();

    await waitFor(() =>
      expect(screen.getByText(/could not load your cart/i)).toBeInTheDocument(),
    );
    expect(
      screen.queryByText(/nothing in the basket/i),
    ).not.toBeInTheDocument();
  });
});

describe('CartPage mutations adopt the server response', () => {
  it('renders the returned cart after a quantity change', async () => {
    const user = userEvent.setup();
    const update = vi.spyOn(api, 'updateCartItem').mockResolvedValue({
      lines: [{ ...LINE_A, quantity: 2, lineTotal: 3998 }, LINE_B],
      totals: {
        ...cart.totals,
        subtotal: 4396,
        total: 4400,
        itemCount: 4,
      },
    });
    vi.spyOn(api, 'fetchCart').mockResolvedValue(cart);

    renderCart();
    await ready();

    await user.click(
      screen.getByRole('button', {
        name: /increase quantity of ZYVORA Deluxe Car Flag/i,
      }),
    );

    await waitFor(() => expect(update).toHaveBeenCalledWith(LINE_A.itemId, 2));
    // 4,396 and 4,400 came from the server, including the gap between them.
    // A local calculation could produce 4,396 but has no way to reach 4,400.
    await waitFor(() => expect(screen.getByText('₹4,400')).toBeInTheDocument());
    expect(screen.getByText('₹4,396')).toBeInTheDocument();
  });

  it('re-reads the cart after a rejected change instead of keeping the stale number', async () => {
    // A stock rejection means the server's view already differs from ours.
    // Patching locally would leave a quantity on screen that cannot be bought.
    const user = userEvent.setup();
    const fetchCart = vi
      .spyOn(api, 'fetchCart')
      .mockResolvedValueOnce(cart)
      .mockResolvedValueOnce({
        ...cart,
        lines: [{ ...LINE_A, available: 1 }, LINE_B],
      });
    vi.spyOn(api, 'updateCartItem').mockRejectedValue(
      new api.ApiRequestError(400, 'VALIDATION_ERROR', 'Only 1 left in stock'),
    );

    renderCart();
    await ready();

    await user.click(
      screen.getByRole('button', {
        name: /increase quantity of ZYVORA Deluxe Car Flag/i,
      }),
    );

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        /only 1 left in stock/i,
      ),
    );
    // Two reads: the initial one and the re-read after the rejection.
    expect(fetchCart).toHaveBeenCalledTimes(2);
    // Both the banner and the line warning carry the message, so assert the
    // count rather than a single match.
    await waitFor(() =>
      expect(
        screen.getAllByText(/only 1 left in stock/i).length,
      ).toBeGreaterThan(0),
    );
  });

  it('removes a line and renders the emptied basket', async () => {
    const user = userEvent.setup();
    const remove = vi.spyOn(api, 'removeCartItem').mockResolvedValue({
      lines: [],
      totals: { ...cart.totals, itemCount: 0, subtotal: 0, total: 0 },
    });
    vi.spyOn(api, 'fetchCart').mockResolvedValue(cart);

    renderCart();
    await ready();

    await user.click(
      screen.getByRole('button', { name: /remove ZYVORA Deluxe Car Flag/i }),
    );

    await waitFor(() => expect(remove).toHaveBeenCalledWith(LINE_A.itemId));
    await waitFor(() =>
      expect(screen.getByText(/nothing in the basket/i)).toBeInTheDocument(),
    );
  });
});

describe('CartPage accessibility', () => {
  it('labels the quantity controls by product', async () => {
    vi.spyOn(api, 'fetchCart').mockResolvedValue(cart);
    renderCart();

    await ready();
    expect(
      screen.getByRole('button', {
        name: /increase quantity of ZYVORA Deluxe Car Flag/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: /reduce quantity of ZYVORA Deluxe Car Flag/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: /increase quantity of ZYVORA Bike Flag Mini/i,
      }),
    ).toBeInTheDocument();
  });

  it('warns when a line is nearly out of stock', async () => {
    vi.spyOn(api, 'fetchCart').mockResolvedValue({
      ...cart,
      lines: [{ ...LINE_A, available: 3 }, LINE_B],
    });
    renderCart();

    await ready();
    expect(screen.getByText(/only 3 left in stock/i)).toBeInTheDocument();
  });

  it('gives every remove button a distinct accessible name', async () => {
    // Two buttons both reading "Remove" is ambiguous on a screen. This is the
    // test that would have caught the original markup.
    vi.spyOn(api, 'fetchCart').mockResolvedValue(cart);
    renderCart();

    await ready();
    const names = screen
      .getAllByRole('button')
      .map((b) => b.textContent)
      .filter((t) => t?.trim().toLowerCase().startsWith('remove'));
    expect(names.length).toBe(2);
    expect(new Set(names).size).toBe(2);
  });

  it('marks an out-of-stock line', async () => {
    vi.spyOn(api, 'fetchCart').mockResolvedValue({
      ...cart,
      lines: [{ ...LINE_A, available: 0 }, LINE_B],
    });
    renderCart();

    await ready();
    expect(screen.getByText(/out of stock/i)).toBeInTheDocument();
  });

  it('will not let the stepper exceed what is available', async () => {
    vi.spyOn(api, 'fetchCart').mockResolvedValue({
      ...cart,
      lines: [{ ...LINE_A, quantity: 75, available: 75 }, LINE_B],
    });
    renderCart();

    await ready();
    expect(
      screen.getByRole('button', {
        name: /increase quantity of ZYVORA Deluxe Car Flag/i,
      }),
    ).toBeDisabled();
  });
});
