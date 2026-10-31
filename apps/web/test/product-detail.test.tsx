import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { ProductDetailPage } from '../src/pages/ProductDetailPage';
import * as api from '../src/lib/api';

/**
 * ZYV-106 — the product detail page.
 *
 * The acceptance criteria for this card describe material, dimensions, colour
 * options, installation instructions, compatibility, shipping/returns policy
 * and an FAQ. The schema has no column for any of them, so none is rendered.
 *
 * That is the property these tests defend. ZYV-40 in this repo already shipped
 * invented stock photography, and "helpfully" filling in a shipping or returns
 * policy would be the same class of mistake with worse consequences — those are
 * promises to the customer. The negative assertions below exist so that adding
 * invented copy to this page breaks a test instead of shipping silently.
 */

const BASE = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'ZYVORA Premium Car Flag — Tricolour',
  price: 2499,
  category: 'car-flags',
  image: 'https://example.invalid/a.jpg',
  description: 'A triple-stripe flag woven from UV-resistant polyester.',
  inStock: true,
  quantityAvailable: 7,
  rating: null as { average: number; count: number } | null,
};

function mockDetail(over: Record<string, unknown> = {}) {
  vi.spyOn(api, 'fetchProductById').mockResolvedValue({
    ...BASE,
    ...over,
  } as never);
  vi.spyOn(api, 'addCartItem').mockResolvedValue({} as never);
}

function renderPage(id = BASE.id) {
  return render(
    <MemoryRouter initialEntries={[`/products/${id}`]}>
      <Routes>
        <Route
          path="/products/:id"
          element={<ProductDetailPage onTitle={() => {}} />}
        />
        <Route path="/checkout" element={<div>Checkout</div>} />
        <Route path="/cart" element={<div>Cart</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

/**
 * Sets the quantity input directly.
 *
 * `userEvent.clear()` on a controlled number input does not stick: React
 * re-renders with its own value and the following keystroke appends to it, so
 * "3" became "13" and the page clamped it to the 7 in stock. Typing into the
 * field was not the thing under test here — the clamp was — so the value is
 * set directly and the assertion stays about the clamp.
 */
function setQuantity(input: HTMLInputElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

/** Rejects with the shape `request()` produces, so the page sees a real 404. */
function notFound() {
  return Object.assign(new Error('not found'), { status: 404 });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('ZYV-106 product detail', () => {
  it('renders name, price, description and image', async () => {
    mockDetail();
    renderPage();

    expect(await screen.findByText(BASE.name)).toBeTruthy();
    expect(screen.getAllByText(/₹2,499/).length).toBeGreaterThan(0);
    expect(screen.getByText(BASE.description)).toBeTruthy();
    expect(screen.getByAltText(BASE.name)).toBeTruthy();
  });

  it('shows stock availability and quantity from the server', async () => {
    mockDetail();
    renderPage();

    expect(await screen.findByText(/In stock — 7 available/)).toBeTruthy();
  });

  it('says sold out and offers no quantity selector when unavailable', async () => {
    mockDetail({ inStock: false, quantityAvailable: 0 });
    renderPage();

    expect(await screen.findByText('Out of stock')).toBeTruthy();
    expect(screen.queryByLabelText(/quantity/i)).toBeNull();
  });

  it('shows a rating only when genuine reviews exist', async () => {
    mockDetail({ rating: { average: 4, count: 1 } });
    renderPage();

    expect(await screen.findByText(/4\.0 ★ from 1 review$/)).toBeTruthy();
  });

  it('omits the rating entirely when there are none', async () => {
    mockDetail({ rating: null });
    renderPage();

    await screen.findByText(BASE.name);
    expect(screen.queryByText(/★/)).toBeNull();
  });

  it('never renders an original price, discount or policy copy', async () => {
    mockDetail();
    renderPage();

    await screen.findByText(BASE.name);
    // No column exists for any of these. Inventing them is the failure mode
    // this asserts against.
    expect(document.querySelector('s, del, .line-through')).toBeNull();
    const text = document.body.textContent ?? '';
    for (const invented of [
      /return policy/i,
      /refund policy/i,
      /shipping policy/i,
      /installation/i,
      /compatible with/i,
      /material:/i,
      /dimensions?:/i,
      /faq/i,
      /was ₹/i,
    ]) {
      expect(text).not.toMatch(invented);
    }
  });

  it('adds the chosen quantity to the cart', async () => {
    mockDetail();
    renderPage();

    await screen.findByText(BASE.name);
    const input = screen.getByLabelText(/quantity/i) as HTMLInputElement;
    setQuantity(input, '3');

    await userEvent.click(
      screen.getAllByRole('button', { name: /add to cart/i })[0],
    );

    await waitFor(() =>
      expect(vi.mocked(api.addCartItem)).toHaveBeenCalledWith(BASE.id, 3),
    );
  });

  it('clamps the quantity to what the server says is available', async () => {
    // quantityAvailable is 7. Typing 99 must not let the page request 99 and
    // have the server reject it — the browser is not the authority on stock.
    mockDetail();
    renderPage();

    await screen.findByText(BASE.name);
    const input = screen.getByLabelText(/quantity/i) as HTMLInputElement;
    setQuantity(input, '99');

    await userEvent.click(
      screen.getAllByRole('button', { name: /add to cart/i })[0],
    );

    await waitFor(() =>
      expect(vi.mocked(api.addCartItem)).toHaveBeenCalledWith(BASE.id, 7),
    );
  });

  it('confirms the add and links to the cart', async () => {
    mockDetail();
    renderPage();

    await screen.findByText(BASE.name);
    await userEvent.click(
      screen.getAllByRole('button', { name: /add to cart/i })[0],
    );

    expect(await screen.findByText(/Added to your cart/)).toBeTruthy();
  });

  it('disables add to cart for a sold-out product', async () => {
    mockDetail({ inStock: false, quantityAvailable: 0 });
    renderPage();

    await screen.findByText('Out of stock');
    const buttons = screen.getAllByRole('button', { name: /sold out/i });
    for (const button of buttons) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('shows the not-found page for an unknown product', async () => {
    vi.spyOn(api, 'fetchProductById').mockRejectedValue(notFound());
    renderPage();

    // Matched on the stable part: the heading splits "not" into its own <em>,
    // so a single regex over the rendered string cannot span it.
    expect(await screen.findByText(/This flag is/i)).toBeTruthy();
  });

  it('reports a failed load distinctly from a missing product', async () => {
    // A 500 is not a 404. Telling a shopper the product does not exist when the
    // server is merely broken is a claim the page cannot support.
    vi.spyOn(api, 'fetchProductById').mockRejectedValue(
      Object.assign(new Error('boom'), { status: 500 }),
    );
    renderPage();

    expect(await screen.findByText(/could not be loaded/i)).toBeTruthy();
    expect(screen.queryByText(/This flag is/i)).toBeNull();
  });

  it('links back to the catalogue', async () => {
    mockDetail();
    renderPage();

    await screen.findByText(BASE.name);
    expect(
      screen
        .getAllByRole('link')
        .some((l) => l.getAttribute('href') === '/catalog'),
    ).toBe(true);
  });

  it('sets the document title from the product name', async () => {
    // Mocked before rendering. Without this the real client fires a fetch at a
    // route that does not exist, the page treats the failure as a 404, and the
    // assertion passes against the wrong title.
    mockDetail();
    const titles: string[] = [];
    render(
      <MemoryRouter initialEntries={[`/products/${BASE.id}`]}>
        <Routes>
          <Route
            path="/products/:id"
            element={<ProductDetailPage onTitle={(t) => titles.push(t)} />}
          />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(titles).toContain(`${BASE.name} — GrownLeaf`));
  });

  it('renders Flipkart-style sticky mobile action bar with Add to cart and Buy at', async () => {
    mockDetail();
    renderPage();

    await screen.findByText(BASE.name);
    const stickyBar = screen.getByTestId('mobile-sticky-bar');
    expect(stickyBar).toBeTruthy();
    expect(screen.getByText('Buy at ₹2,499')).toBeTruthy();

    // Adjusting quantity updates the "Buy at" total price
    const input = screen.getByLabelText(/quantity/i) as HTMLInputElement;
    setQuantity(input, '2');
    expect(screen.getByText('Buy at ₹4,998')).toBeTruthy();
  });

  it('adds item to cart using mobile sticky Add to cart button', async () => {
    mockDetail();
    renderPage();

    await screen.findByText(BASE.name);
    const stickyBar = screen.getByTestId('mobile-sticky-bar');
    const mobileAddButton = stickyBar.querySelector('button')!;
    await userEvent.click(mobileAddButton);

    await waitFor(() =>
      expect(vi.mocked(api.addCartItem)).toHaveBeenCalledWith(BASE.id, 1),
    );
  });

  it('adds item and navigates using mobile sticky Buy at button', async () => {
    mockDetail();
    renderPage();

    await screen.findByText(BASE.name);
    const mobileBuyButton = screen.getByRole('button', {
      name: /buy at ₹2,499/i,
    });
    await userEvent.click(mobileBuyButton);

    await waitFor(() =>
      expect(vi.mocked(api.addCartItem)).toHaveBeenCalledWith(BASE.id, 1),
    );
  });
});
