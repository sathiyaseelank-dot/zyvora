import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import {
  AdminDashboardPage,
  type AdminProduct,
  type ProductImage,
} from '../src/pages/AdminDashboardPage';
import * as api from '../src/lib/api';

/**
 * ZYV-92 — Admin Product Entry and Catalogue Operations UI.
 *
 * Verifies:
 * 1. Product listing table with search, category filter, status filter, and empty state.
 * 2. Product creation form (validation, POST /api/admin/products, notification banner).
 * 3. Publish toggle (PATCH /api/admin/products/:id isActive flip).
 * 4. Archive flow with confirmation modal (DELETE /api/admin/products/:id).
 * 5. Edit modal (PATCH /api/admin/products/:id + PATCH /api/admin/products/:id/pricing).
 * 6. Gallery management inside edit modal (attach, remove, reorder images).
 */

vi.mock('../src/lib/session', () => ({
  useSession: () => ({
    user: {
      id: 'admin-user-uuid',
      email: 'admin@zyvora.com',
      fullName: 'Fleet Admiral',
      role: 'admin',
    },
    status: 'authenticated',
  }),
}));

vi.mock('../src/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/api')>();
  return {
    ...actual,
    request: vi.fn(),
  };
});

const MOCK_CATEGORIES: api.Category[] = [
  {
    id: 'cat-uuid-car',
    name: 'Car Flags',
    slug: 'car-flags',
    description: 'Flags for cars',
  },
  {
    id: 'cat-uuid-bike',
    name: 'Bike Flags',
    slug: 'bike-flags',
    description: 'Flags for bikes',
  },
];

const MOCK_PRODUCTS: AdminProduct[] = [
  {
    id: 'prod-uuid-1',
    name: 'ZYVORA Premium Car Flag — Tricolour',
    description:
      'Heavy duty brass-reinforced car flag designed for highway speeds.',
    categoryId: 'cat-uuid-car',
    categoryName: 'Car Flags',
    categorySlug: 'car-flags',
    price: 1999,
    compareAtPrice: 2499,
    image: 'https://images.unsplash.com/photo-car-flag.jpg',
    isActive: true,
    stock: 42,
  },
  {
    id: 'prod-uuid-2',
    name: 'ZYVORA Bike Flag — Tricolour Mini',
    description: 'Compact bike flag with aerodynamic mount.',
    categoryId: 'cat-uuid-bike',
    categoryName: 'Bike Flags',
    categorySlug: 'bike-flags',
    price: 999,
    compareAtPrice: null,
    image: 'https://images.unsplash.com/photo-bike-flag.jpg',
    isActive: false,
    stock: 3,
  },
];

const MOCK_GALLERY: ProductImage[] = [
  {
    id: 'img-uuid-1',
    product_id: 'prod-uuid-1',
    url: 'https://images.unsplash.com/gallery-1.jpg',
    alt_text: 'Front view',
    display_order: 0,
    created_at: new Date().toISOString(),
  },
  {
    id: 'img-uuid-2',
    product_id: 'prod-uuid-1',
    url: 'https://images.unsplash.com/gallery-2.jpg',
    alt_text: 'Mounting bracket close-up',
    display_order: 1,
    created_at: new Date().toISOString(),
  },
];

function renderAdminPage() {
  return render(
    <MemoryRouter>
      <AdminDashboardPage />
    </MemoryRouter>,
  );
}

describe('Admin Product Management UI (ZYV-92)', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(api.request).mockImplementation(
      async (path: string, options?: any) => {
        // Categories endpoint
        if (path === '/api/categories') {
          return { data: MOCK_CATEGORIES } as any;
        }

        // Reports summary for overview tab
        if (path === '/api/admin/reports/summary') {
          return {
            data: {
              period: '30d',
              totalOrders: 150,
              totalRevenue: 245000,
              averageOrderValue: 1633,
            },
          } as any;
        }

        // Products listing endpoint
        if (
          path.startsWith('/api/admin/products?') ||
          path === '/api/admin/products'
        ) {
          if (!options || options.method === 'GET') {
            return { data: MOCK_PRODUCTS } as any;
          }
        }

        // Gallery images endpoint
        if (path === `/api/admin/products/${MOCK_PRODUCTS[0].id}/images`) {
          return { data: MOCK_GALLERY } as any;
        }

        return { data: null } as any;
      },
    );
  });

  async function openProductsTab(user: ReturnType<typeof userEvent.setup>) {
    renderAdminPage();
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /products/i }),
      ).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /products/i }));
    await waitFor(() => {
      expect(
        screen.getByPlaceholderText(/search products/i),
      ).toBeInTheDocument();
    });
  }

  it('renders products table with toolbar, filters, and product details', async () => {
    const user = userEvent.setup();
    await openProductsTab(user);

    // Toolbar elements
    expect(screen.getByPlaceholderText(/search products/i)).toBeInTheDocument();
    expect(
      screen.getByRole('combobox', { name: /filter by category/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('combobox', { name: /filter by status/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /\+ add new product/i }),
    ).toBeInTheDocument();

    // Table rows
    expect(
      screen.getByText('ZYVORA Premium Car Flag — Tricolour'),
    ).toBeInTheDocument();
    expect(screen.getByText('₹1,999')).toBeInTheDocument();
    expect(screen.getByText('₹2,499')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /^active$/i }),
    ).toBeInTheDocument();

    // Second product (archived status)
    expect(
      screen.getByText('ZYVORA Bike Flag — Tricolour Mini'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /^archived$/i }),
    ).toBeInTheDocument();
  });

  it('renders empty state when no products match filters', async () => {
    vi.mocked(api.request).mockImplementation(async (path: string) => {
      if (path === '/api/categories') return { data: MOCK_CATEGORIES } as any;
      if (path.startsWith('/api/admin/products')) return { data: [] } as any;
      return { data: null } as any;
    });

    const user = userEvent.setup();
    renderAdminPage();
    await waitFor(() => screen.getByRole('button', { name: /products/i }));
    await user.click(screen.getByRole('button', { name: /products/i }));

    await waitFor(() => {
      expect(screen.getByText(/no products found/i)).toBeInTheDocument();
    });

    const addFirstBtn = screen.getByRole('button', {
      name: /\+ add first product/i,
    });
    expect(addFirstBtn).toBeInTheDocument();

    // Clicking "+ Add First Product" toggles creation form
    await user.click(addFirstBtn);
    expect(
      screen.getByRole('heading', { level: 2, name: /add new flag product/i }),
    ).toBeInTheDocument();
  });

  it('filters products by status, category, and search query', async () => {
    const user = userEvent.setup();
    await openProductsTab(user);

    // Filter by status: active
    const statusSelect = screen.getByRole('combobox', {
      name: /filter by status/i,
    });
    await user.selectOptions(statusSelect, 'active');
    await waitFor(() => {
      expect(vi.mocked(api.request)).toHaveBeenCalledWith(
        expect.stringContaining('status=active'),
      );
    });

    // Filter by category: car-flags
    const categorySelect = screen.getByRole('combobox', {
      name: /filter by category/i,
    });
    await user.selectOptions(categorySelect, 'car-flags');
    await waitFor(() => {
      expect(vi.mocked(api.request)).toHaveBeenCalledWith(
        expect.stringContaining('category=car-flags'),
      );
    });

    // Search query via change event
    const searchInput = screen.getByPlaceholderText(/search products/i);
    fireEvent.change(searchInput, { target: { value: 'Highway' } });
    await waitFor(() => {
      expect(vi.mocked(api.request)).toHaveBeenCalledWith(
        expect.stringContaining('search=Highway'),
      );
    });
  });

  it('validates required fields in the product creation form', async () => {
    const user = userEvent.setup();
    await openProductsTab(user);

    await user.click(
      screen.getByRole('button', { name: /\+ add new product/i }),
    );
    const heading = screen.getByRole('heading', {
      level: 2,
      name: /add new flag product/i,
    });
    expect(heading).toBeInTheDocument();

    const form = heading.closest('div')!.querySelector('form')!;
    fireEvent.submit(form);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Name and description are required.',
    );
    expect(vi.mocked(api.request)).not.toHaveBeenCalledWith(
      '/api/admin/products',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it(
    'creates a new product successfully with notification feedback',
    async () => {
    const createdProduct: AdminProduct = {
      id: 'prod-uuid-new',
      name: 'ZYVORA Heavy Car Flag',
      description: 'Hand-stitched triple weave polyester.',
      categoryId: 'cat-uuid-car',
      categoryName: 'Car Flags',
      price: 2999,
      compareAtPrice: 3499,
      image: 'https://images.unsplash.com/photo-car-flag-new.jpg',
      isActive: true,
      stock: 50,
    };

    vi.mocked(api.request).mockImplementation(
      async (path: string, options?: any) => {
        if (path === '/api/categories') return { data: MOCK_CATEGORIES } as any;
        if (path === '/api/admin/products' && options?.method === 'POST') {
          return { data: createdProduct } as any;
        }
        if (path.startsWith('/api/admin/products')) {
          return { data: [...MOCK_PRODUCTS, createdProduct] } as any;
        }
        return { data: null } as any;
      },
    );

    const user = userEvent.setup();
    await openProductsTab(user);

    await user.click(
      screen.getByRole('button', { name: /\+ add new product/i }),
    );

    // Fill form
    await user.type(
      screen.getByLabelText(/product name \*/i),
      'ZYVORA Heavy Car Flag',
    );
    await user.type(
      screen.getByLabelText(/description \*/i),
      'Hand-stitched triple weave polyester.',
    );
    await user.selectOptions(
      screen.getByLabelText(/category \*/i),
      'cat-uuid-car',
    );
    await user.type(screen.getByLabelText(/price \(₹ inr\) \*/i), '2999');
    await user.type(screen.getByLabelText(/compare-at price/i), '3499');
    const stockInput = screen.getByLabelText(/initial stock \*/i);
    await user.clear(stockInput);
    await user.type(stockInput, '50');
    await user.type(
      screen.getByLabelText(/primary image url \*/i),
      'https://images.unsplash.com/photo-car-flag-new.jpg',
    );

    // Submit form
    await user.click(screen.getByRole('button', { name: /^create product$/i }));

    await waitFor(() => {
      expect(vi.mocked(api.request)).toHaveBeenCalledWith(
        '/api/admin/products',
        expect.objectContaining({
          method: 'POST',
          body: {
            name: 'ZYVORA Heavy Car Flag',
            description: 'Hand-stitched triple weave polyester.',
            categoryId: 'cat-uuid-car',
            price: 2999,
            compareAtPrice: 3499,
            stock: 50,
            image: 'https://images.unsplash.com/photo-car-flag-new.jpg',
            isActive: true,
          },
        }),
      );
    });

    // Success notice banner is displayed
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'Product "ZYVORA Heavy Car Flag" created successfully!',
      );
    });

    // Form is closed
    expect(
      screen.queryByRole('heading', {
        level: 2,
        name: /add new flag product/i,
      }),
    ).not.toBeInTheDocument();
  }, 15000);

  it('toggles product publish/active status with instant feedback', async () => {
    const user = userEvent.setup();
    await openProductsTab(user);

    // Click Active toggle on the first product
    const activeToggle = screen.getByRole('button', { name: /^active$/i });
    await user.click(activeToggle);

    await waitFor(() => {
      expect(vi.mocked(api.request)).toHaveBeenCalledWith(
        `/api/admin/products/${MOCK_PRODUCTS[0].id}`,
        {
          method: 'PATCH',
          body: { isActive: false },
        },
      );
    });

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'Product "ZYVORA Premium Car Flag — Tricolour" is now Archived (hidden from store).',
      );
    });
  });

  it('prompts confirmation modal and archives product upon confirmation', async () => {
    const user = userEvent.setup();
    await openProductsTab(user);

    // Find and click Archive button for first product
    const archiveButtons = screen.getAllByRole('button', {
      name: /^archive$/i,
    });
    await user.click(archiveButtons[0]);

    // Confirmation dialog is displayed
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: /archive product/i }),
    ).toBeInTheDocument();
    expect(dialog).toHaveTextContent('ZYVORA Premium Car Flag — Tricolour');

    // Clicking Cancel closes modal without deleting
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(vi.mocked(api.request)).not.toHaveBeenCalledWith(
      `/api/admin/products/${MOCK_PRODUCTS[0].id}`,
      { method: 'DELETE' },
    );

    // Open dialog again and confirm
    await user.click(archiveButtons[0]);
    await user.click(screen.getByRole('button', { name: /confirm archive/i }));

    await waitFor(() => {
      expect(vi.mocked(api.request)).toHaveBeenCalledWith(
        `/api/admin/products/${MOCK_PRODUCTS[0].id}`,
        { method: 'DELETE' },
      );
    });

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'Product "ZYVORA Premium Car Flag — Tricolour" archived and hidden from the store.',
      );
    });
  });

  it('opens product edit modal and updates product fields and pricing', async () => {
    const user = userEvent.setup();
    await openProductsTab(user);

    // Click edit on first product
    const editButtons = screen.getAllByRole('button', { name: /^edit$/i });
    await user.click(editButtons[0]);

    // Modal opens and fetches gallery
    const modal = screen.getByRole('dialog');
    expect(modal).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: /edit product: ZYVORA Premium Car Flag — Tricolour/i,
      }),
    ).toBeInTheDocument();

    // Verify pre-filled price input
    const priceInput = screen.getByLabelText(/price \(₹ inr\) \*/i);
    expect(priceInput).toHaveValue(1999);

    // Update price
    await user.clear(priceInput);
    await user.type(priceInput, '2199');

    // Save changes
    await user.click(screen.getByRole('button', { name: /^save changes$/i }));

    await waitFor(() => {
      // 1. PATCH basic fields
      expect(vi.mocked(api.request)).toHaveBeenCalledWith(
        `/api/admin/products/${MOCK_PRODUCTS[0].id}`,
        expect.objectContaining({
          method: 'PATCH',
          body: expect.objectContaining({
            price: 2199,
          }),
        }),
      );
      // 2. PATCH pricing endpoint
      expect(vi.mocked(api.request)).toHaveBeenCalledWith(
        `/api/admin/products/${MOCK_PRODUCTS[0].id}/pricing`,
        {
          method: 'PATCH',
          body: {
            price: 2199,
            compareAtPrice: 2499,
          },
        },
      );
    });

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        /updated successfully/i,
      );
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('manages gallery images inside edit modal (attach, reorder, remove)', async () => {
    const user = userEvent.setup();
    await openProductsTab(user);

    // Open edit modal
    await user.click(screen.getAllByRole('button', { name: /^edit$/i })[0]);
    await waitFor(() => {
      expect(
        screen.getByText('https://images.unsplash.com/gallery-1.jpg'),
      ).toBeInTheDocument();
      expect(
        screen.getByText('https://images.unsplash.com/gallery-2.jpg'),
      ).toBeInTheDocument();
    });

    // 1. Reorder gallery image (move second image up)
    const moveUpButtons = screen.getAllByRole('button', { name: /↑ up/i });
    await user.click(moveUpButtons[1]);

    await waitFor(() => {
      expect(vi.mocked(api.request)).toHaveBeenCalledWith(
        `/api/admin/products/${MOCK_PRODUCTS[0].id}/images/reorder`,
        {
          method: 'PATCH',
          body: {
            imageIds: ['img-uuid-2', 'img-uuid-1'],
          },
        },
      );
    });

    // 2. Remove gallery image (first item in list is now img-uuid-2)
    const removeButtons = screen.getAllByRole('button', { name: /remove/i });
    await user.click(removeButtons[0]);

    await waitFor(() => {
      expect(vi.mocked(api.request)).toHaveBeenCalledWith(
        `/api/admin/products/${MOCK_PRODUCTS[0].id}/images/img-uuid-2`,
        { method: 'DELETE' },
      );
    });

    // 3. Attach new gallery image
    const urlInput = screen.getByPlaceholderText(
      /image url \(\.jpg, \.jpeg, \.png, \.webp\)/i,
    );
    await user.type(urlInput, 'https://images.unsplash.com/gallery-new.jpg');
    const altInput = screen.getByPlaceholderText(/alt text description/i);
    await user.type(altInput, 'Side angle view');

    await user.click(screen.getByRole('button', { name: /\+ attach image/i }));

    await waitFor(() => {
      expect(vi.mocked(api.request)).toHaveBeenCalledWith(
        `/api/admin/products/${MOCK_PRODUCTS[0].id}/images`,
        expect.objectContaining({
          method: 'POST',
          body: expect.objectContaining({
            url: 'https://images.unsplash.com/gallery-new.jpg',
            altText: 'Side angle view',
          }),
        }),
      );
    });
  });
});
