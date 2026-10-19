import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { HomePage } from '../src/pages/HomePage';
import * as api from '../src/lib/api';

describe('HomePage (ZYV-100, ZYV-107, ZYV-108, ZYV-112)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders hero banner, tagline, value propositions, and FAQ preview', async () => {
    vi.spyOn(api, 'fetchProducts').mockResolvedValue({
      data: [
        {
          id: 'prod-1',
          name: 'ZYVORA Premium Car Flag — Tricolour',
          price: 999,
          category: 'car',
          image: '/uploads/flag1.jpg',
          inStock: true,
          rating: null,
        },
      ],
      meta: { page: 1, pageSize: 6, total: 1, totalPages: 1 },
    });
    vi.spyOn(api, 'fetchBanners').mockResolvedValue([]);

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    // Hero title & visual
    expect(
      screen.getByRole('heading', { level: 1, name: /Flags that fly first/i }),
    ).toBeTruthy();
    expect(
      screen.getByAltText(/ZYVORA Premium Car and Bike Flag Banner/i),
    ).toBeTruthy();

    // Why Choose ZYVORA
    expect(
      screen.getByRole('heading', { level: 2, name: /Why choose ZYVORA/i }),
    ).toBeTruthy();
    expect(screen.getByText(/Aerodynamic Strength/i)).toBeTruthy();
    expect(screen.getByText(/UV-Stabilised Cloth/i)).toBeTruthy();
    expect(screen.getByText(/Triple-Stitched Hem/i)).toBeTruthy();

    // FAQ preview section
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: /Frequently Asked Questions/i,
      }),
    ).toBeTruthy();
    const faqToggle = screen.getByRole('button', {
      name: /Will the flag withstand highway speeds and heavy rain\?/i,
    });
    fireEvent.click(faqToggle);
    expect(
      screen.getByText(
        /Every ZYVORA flag is constructed from 110 GSM UV-stabilised polyester/i,
      ),
    ).toBeTruthy();
  });

  it('hides the reviews section completely when no products have approved reviews (ZYV-108)', async () => {
    vi.spyOn(api, 'fetchProducts').mockResolvedValue({
      data: [
        {
          id: 'prod-1',
          name: 'ZYVORA Premium Car Flag',
          price: 999,
          category: 'car',
          image: '/uploads/flag1.jpg',
          inStock: true,
          rating: null, // No verified reviews
        },
      ],
      meta: { page: 1, pageSize: 6, total: 1, totalPages: 1 },
    });
    vi.spyOn(api, 'fetchBanners').mockResolvedValue([]);

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    // Wait for product to load
    expect(await screen.findByText('ZYVORA Premium Car Flag')).toBeTruthy();

    // Reviews section MUST NOT be present in DOM
    expect(
      screen.queryByRole('heading', { name: /Genuine Reviews/i }),
    ).toBeNull();
    expect(screen.queryByText(/Verified Customers/i)).toBeNull();
  });

  it('shows genuine reviews section when real ratings exist (ZYV-108)', async () => {
    vi.spyOn(api, 'fetchProducts').mockResolvedValue({
      data: [
        {
          id: 'prod-1',
          name: 'ZYVORA Premium Car Flag — Tricolour',
          price: 999,
          category: 'car',
          image: '/uploads/flag1.jpg',
          inStock: true,
          rating: { average: 4.8, count: 24 }, // Verified genuine rating
        },
      ],
      meta: { page: 1, pageSize: 6, total: 1, totalPages: 1 },
    });
    vi.spyOn(api, 'fetchBanners').mockResolvedValue([]);

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole('heading', { name: /Genuine Reviews/i }),
    ).toBeTruthy();
    expect(screen.getAllByText(/4\.8 ★/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/24 verified reviews/i)).toBeTruthy();
  });
});
