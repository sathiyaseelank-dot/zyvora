import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { CatalogPage } from '../src/pages/CatalogPage';
import * as api from '../src/lib/api';

/**
 * ZYV-105 — the catalogue grid.
 *
 * The property worth defending: the page renders what the API says and invents
 * nothing. Specifically it must not display a struck-through original price or
 * a star rating, because `products` has no MRP column and `rating` is null until
 * verified reviews exist. A page that "helpfully" rendered a fabricated discount
 * would look finished and be lying to every customer.
 *
 * The fixture makes that falsifiable. `MOCK` contains one in-stock product with
 * a rating, one out-of-stock product with no rating, and prices chosen so no
 * line total happens to match a plausible made-up one.
 */

const CATEGORIES = [
  { name: 'Car Flags', slug: 'car-flags', description: null },
  { name: 'Bike Flags', slug: 'bike-flags', description: null },
  { name: 'Accessories', slug: 'accessories', description: null },
  { name: 'Gift Sets', slug: 'gift-sets', description: null },
];

function product(over: Partial<Parameters<typeof api.fetchProducts>[0]> = {}) {
  void over;
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'ZYVORA Premium Car Flag — Tricolour',
    price: 2499,
    category: 'car-flags' as const,
    image: 'https://example.invalid/a.jpg',
    inStock: true,
    rating: null as { average: number; count: number } | null,
  };
}

const IN_STOCK_RATED = {
  ...product(),
  rating: { average: 4.5, count: 12 },
};

const OUT_OF_STOCK = {
  ...product(),
  id: '22222222-2222-4222-8222-222222222222',
  name: 'ZYVORA Bike Flag — Tricolour Mini',
  price: 1499,
  category: 'bike-flags' as const,
  inStock: false,
  rating: null,
};

const MOCK = [IN_STOCK_RATED, OUT_OF_STOCK];

const meta = {
  page: 1,
  pageSize: 12,
  total: 2,
  totalPages: 1,
  sort: 'name_asc' as const,
};

function mockApi(over: { data?: typeof MOCK; meta?: Partial<typeof meta> } = {}) {
  vi.spyOn(api, 'fetchCategories').mockResolvedValue(CATEGORIES);
  vi.spyOn(api, 'fetchProducts').mockResolvedValue({
    data: over.data ?? MOCK,
    meta: { ...meta, ...over.meta },
  });
  vi.spyOn(api, 'searchProducts').mockResolvedValue({
    data: over.data ?? MOCK,
    meta: { page: 1, pageSize: 12, query: 'flag' },
  });
  vi.spyOn(api, 'addCartItem').mockResolvedValue({} as never);
}

function renderPage(route = '/catalog') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/catalog" element={<CatalogPage />} />
        <Route path="/products/:id" element={<div>detail placeholder</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('ZYV-105 catalogue grid', () => {
  it('renders image, name and price for each product', async () => {
    mockApi();
    renderPage();

    expect(
      await screen.findByText('ZYVORA Premium Car Flag — Tricolour'),
    ).toBeTruthy();
    expect(screen.getByText(/₹2,499/)).toBeTruthy();
    expect(
      screen.getByAltText('ZYVORA Premium Car Flag — Tricolour'),
    ).toBeTruthy();
  });

  it('attaches availability to the right product', async () => {
    mockApi();
    renderPage();

    await screen.findByText('ZYVORA Premium Car Flag — Tricolour');

    // Asserted per card, not "the page contains both strings". Checking only
    // that "In stock" and "Out of stock" both appear passes just as well when
    // the condition is inverted and every product gets the wrong label.
    const inStockCard = screen
      .getByText('ZYVORA Premium Car Flag — Tricolour')
      .closest('article') as HTMLElement;
    const outOfStockCard = screen
      .getByText('ZYVORA Bike Flag — Tricolour Mini')
      .closest('article') as HTMLElement;

    expect(within(inStockCard).getByText('In stock')).toBeTruthy();
    expect(within(inStockCard).queryByText('Out of stock')).toBeNull();

    expect(within(outOfStockCard).getByText('Out of stock')).toBeTruthy();
    expect(within(outOfStockCard).queryByText('In stock')).toBeNull();
  });

  it('never renders a struck-through price, because no MRP column exists', async () => {
    mockApi();
    renderPage();

    await screen.findByText('ZYVORA Premium Car Flag — Tricolour');
    // No strikethrough anywhere: the schema has no original-price column, so any
    // "was ₹X" on this page would be invented.
    expect(document.querySelector('s, del, .line-through')).toBeNull();
    expect(screen.queryByText(/was ₹/i)).toBeNull();
  });

  it('shows a rating only when the API supplied genuine reviews', async () => {
    mockApi();
    renderPage();

    // The rated product shows its average and count.
    expect(await screen.findByText(/4\.5 ★/)).toBeTruthy();
    expect(screen.getByText(/\(12\)/)).toBeTruthy();

    // The unrated product shows no stars at all — not "0.0 ★ (0)", which would
    // be a claim about a product nobody has bought.
    const unratedCard = screen
      .getByText('ZYVORA Bike Flag — Tricolour Mini')
      .closest('article') as HTMLElement;
    expect(within(unratedCard).queryByText(/★/)).toBeNull();
  });

  it('disables add-to-cart for an out-of-stock product', async () => {
    mockApi();
    renderPage();

    await screen.findByText('Out of stock');
    const buttons = screen.getAllByRole('button', { name: /add to cart|sold out/i });
    expect(buttons).toHaveLength(2);
    // Exactly one is available.
    expect(buttons.filter((b) => !(b as HTMLButtonElement).disabled)).toHaveLength(
      1,
    );
    expect(
      buttons.find((b) => b.textContent?.includes('Sold out')),
    ).toBeTruthy();
  });

  it('adds the in-stock product to the cart', async () => {
    // mockApi() installs the spy, so the reference has to be taken afterwards.
    // Spying first and then calling mockApi() left the assertion watching a
    // spy that had already been replaced, and it failed for the wrong reason.
    mockApi();
    const spy = vi.mocked(api.addCartItem);
    renderPage();

    // Await the grid first. getAllByRole is synchronous, so querying before
    // the fetch resolves looks for buttons in a page still showing skeletons.
    await screen.findByText('ZYVORA Premium Car Flag — Tricolour');

    const buttons = screen.getAllByRole('button', { name: /add to cart/i });
    await userEvent.click(buttons[0]);

    // Two arguments, not three: the page passes no AbortSignal for an action the
    // shopper initiated, so requiring one asserted against the wrong contract.
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(IN_STOCK_RATED.id, 1),
    );
  });

  it('links each card to its detail page', async () => {
    mockApi();
    renderPage();

    await screen.findByText('ZYVORA Premium Car Flag — Tricolour');
    const links = screen
      .getAllByRole('link')
      .filter((l) => l.getAttribute('href')?.startsWith('/products/'));
    expect(links.length).toBeGreaterThanOrEqual(2);
    expect(
      links.some((l) => l.getAttribute('href') === `/products/${IN_STOCK_RATED.id}`),
    ).toBe(true);
  });

  it('requests the sort named in the URL', async () => {
    const spy = vi.spyOn(api, 'fetchProducts');
    mockApi();
    renderPage('/catalog?sort=price_desc');

    await waitFor(() =>
      expect(
        spy.mock.calls.some((c) => c[0]?.sort === 'price_desc'),
      ).toBe(true),
    );
  });

  it('falls back to the default sort for a hand-edited unknown sort', async () => {
    const spy = vi.spyOn(api, 'fetchProducts');
    mockApi();
    renderPage('/catalog?sort=sideways');

    await waitFor(() => expect(spy).toHaveBeenCalled());
    for (const call of spy.mock.calls) {
      expect(call[0]?.sort ?? 'name_asc').toBe('name_asc');
    }
  });

  it('filters by category from the URL', async () => {
    const spy = vi.spyOn(api, 'fetchProducts');
    mockApi();
    renderPage('/catalog?category=bike-flags');

    await waitFor(() =>
      expect(
        spy.mock.calls.some((c) => c[0]?.category === 'bike-flags'),
      ).toBe(true),
    );
  });

  it('passes the page number through for pagination', async () => {
    const spy = vi.spyOn(api, 'fetchProducts');
    mockApi();
    renderPage('/catalog?page=3');

    await waitFor(() =>
      expect(spy.mock.calls.some((c) => c[0]?.page === 3)).toBe(true),
    );
  });

  it('offers no pagination controls on a single page of results', async () => {
    mockApi();
    renderPage();

    await screen.findByText('ZYVORA Premium Car Flag — Tricolour');
    expect(screen.queryByRole('button', { name: /next/i })).toBeNull();
  });

  it('offers pagination and reports the window when there are several pages', async () => {
    mockApi({ meta: { total: 40, totalPages: 4 } });
    renderPage();

    expect(await screen.findByText(/Showing 1–12 of 40/)).toBeTruthy();
    expect(screen.getByText(/Page 1 of 4/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /previous/i })).toBeTruthy();
  });

  it('disables previous on the first page', async () => {
    mockApi({ meta: { total: 40, totalPages: 4 } });
    renderPage('/catalog?page=1');

    const previous = await screen.findByRole('button', { name: /previous/i });
    expect((previous as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables next on the last page', async () => {
    mockApi({ meta: { total: 40, totalPages: 4 } });
    renderPage('/catalog?page=4');

    const next = await screen.findByRole('button', { name: /next/i });
    expect((next as HTMLButtonElement).disabled).toBe(true);
  });

  it('enables both controls in the middle of the range', async () => {
    mockApi({ meta: { total: 40, totalPages: 4 } });
    renderPage('/catalog?page=2');

    const previous = await screen.findByRole('button', { name: /previous/i });
    const next = screen.getByRole('button', { name: /next/i });
    expect((previous as HTMLButtonElement).disabled).toBe(false);
    expect((next as HTMLButtonElement).disabled).toBe(false);
  });

  it('clears the added confirmation so a stale badge cannot linger', async () => {
    mockApi();
    renderPage();

    // Let the grid settle on the real clock first. RTL's async queries poll
    // with timers, so switching to fake timers before this point makes
    // findBy* wait on a clock nobody advances and the test times out on the
    // query rather than on the behaviour it is checking.
    await screen.findByText('ZYVORA Premium Car Flag — Tricolour');

    vi.useFakeTimers();
    try {
      // fireEvent rather than userEvent: it is synchronous, so it needs no
      // timer advancement and cannot deadlock against the fake clock.
      fireEvent.click(
        screen.getAllByRole('button', { name: /add to cart/i })[0],
      );
      await act(async () => {});

      expect(screen.getByRole('button', { name: /^added$/i })).toBeTruthy();

      // The badge claims this product is in the basket. Left in place it stays
      // true after the shopper removes the item elsewhere.
      await act(async () => {
        vi.advanceTimersByTime(2600);
      });

      expect(screen.getByRole('button', { name: /add to cart/i })).toBeTruthy();
      expect(screen.queryByRole('button', { name: /^added$/i })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('hides the filter controls while a search query is active', async () => {
    // The search endpoint cannot filter, sort or paginate. Showing controls that
    // silently do nothing is worse than not offering them.
    mockApi();
    renderPage('/catalog?q=tricolour');

    await screen.findByText('ZYVORA Premium Car Flag — Tricolour');
    expect(screen.queryByLabelText(/filter by category/i)).toBeNull();
    expect(screen.queryByLabelText(/sort products/i)).toBeNull();
  });

  it('uses the search endpoint when a query is present', async () => {
    const search = vi.spyOn(api, 'searchProducts');
    mockApi();
    renderPage('/catalog?q=tricolour');

    await waitFor(() => expect(search).toHaveBeenCalled());
  });

  it('reports an empty catalogue without pretending it is loading', async () => {
    mockApi({ data: [] });
    renderPage();

    expect(await screen.findByText(/Nothing matched that search/)).toBeTruthy();
  });

  it('shows an error rather than a blank page when the catalogue fails', async () => {
    vi.spyOn(api, 'fetchCategories').mockRejectedValue(new Error('down'));
    vi.spyOn(api, 'fetchProducts').mockRejectedValue(new Error('down'));
    renderPage();

    expect(await screen.findByText(/catalog is unavailable/i)).toBeTruthy();
  });
});