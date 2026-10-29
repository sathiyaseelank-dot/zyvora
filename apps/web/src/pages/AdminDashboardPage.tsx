import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { useSession } from '../lib/session';
import { request, type Category } from '../lib/api';

interface SalesSummary {
  period: string;
  totalOrders: number;
  totalRevenue: number;
  averageOrderValue: number;
}

export interface AdminProduct {
  id: string;
  name: string;
  description: string;
  categoryId?: string;
  categoryName: string;
  categorySlug?: string;
  price: number;
  compareAtPrice: number | null;
  image: string;
  isActive: boolean;
  stock: number;
  reservedStock?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProductImage {
  id: string;
  product_id: string;
  url: string;
  alt_text: string | null;
  display_order: number;
  created_at: string;
}

interface AdminOrder {
  id: string;
  userId: string;
  customerEmail: string;
  customerName: string;
  total: number;
  status: string;
  createdAt: string;
}

interface AdminRefund {
  id: string;
  paymentId: string;
  orderId: string;
  amount: number;
  reason: string;
  status: string;
  createdAt: string;
}

interface AdminAuditEntry {
  id: string;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  createdAt: string;
}

export function AdminDashboardPage({
  onTitle,
}: {
  onTitle?: (t: string) => void;
}) {
  const { user } = useSession();
  const [tab, setTab] = useState<
    'overview' | 'products' | 'orders' | 'refunds' | 'audit'
  >('overview');

  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [refunds, setRefunds] = useState<AdminRefund[]>([]);
  const [auditLogs, setAuditLogs] = useState<AdminAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Products filtering & search state
  const [productSearch, setProductSearch] = useState('');
  const [productCategory, setProductCategory] = useState('');
  const [productStatus, setProductStatus] = useState<
    'all' | 'active' | 'archived'
  >('all');

  // Product Creation state
  const [isCreating, setIsCreating] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: '',
    description: '',
    categoryId: '',
    price: '',
    compareAtPrice: '',
    image: '',
    stock: '0',
    isActive: true,
  });
  const [createSubmitting, setCreateSubmitting] = useState(false);

  // Product Edit modal state
  const [editingProduct, setEditingProduct] = useState<AdminProduct | null>(
    null,
  );
  const [editForm, setEditForm] = useState({
    name: '',
    description: '',
    categoryId: '',
    price: '',
    compareAtPrice: '',
    image: '',
    stock: '0',
    isActive: true,
  });
  const [editSubmitting, setEditSubmitting] = useState(false);

  // Product Image gallery state
  const [galleryImages, setGalleryImages] = useState<ProductImage[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [newImageUrl, setNewImageUrl] = useState('');
  const [newImageAlt, setNewImageAlt] = useState('');
  const [newImagePrimary, setNewImagePrimary] = useState(false);
  const [gallerySubmitting, setGallerySubmitting] = useState(false);

  // Archive confirmation state
  const [productToArchive, setProductToArchive] = useState<AdminProduct | null>(
    null,
  );
  const [archiveSubmitting, setArchiveSubmitting] = useState(false);

  useEffect(() => {
    onTitle?.('Admin Console — GrownLeaf');
  }, [onTitle]);

  // Load categories once on mount or when products tab opens
  useEffect(() => {
    let active = true;
    request<{ data: Category[] }>('/api/categories')
      .then((res) => {
        if (active && res.data) {
          setCategories(res.data);
          if (res.data.length > 0 && !createForm.categoryId) {
            setCreateForm((prev) => ({
              ...prev,
              categoryId: res.data[0].id || '',
            }));
          }
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [createForm.categoryId]);

  async function loadProducts() {
    try {
      const params = new URLSearchParams();
      params.set('limit', '50');
      if (productStatus !== 'all') params.set('status', productStatus);
      if (productCategory) params.set('category', productCategory);
      if (productSearch.trim()) params.set('search', productSearch.trim());

      const res = await request<{ data: AdminProduct[] }>(
        `/api/admin/products?${params.toString()}`,
      );
      setProducts(res.data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load products list',
      );
    }
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    async function loadData() {
      try {
        if (tab === 'overview') {
          const res = await request<{ data: SalesSummary }>(
            '/api/admin/reports/summary',
          );
          if (active) setSummary(res.data);
        } else if (tab === 'products') {
          await loadProducts();
        } else if (tab === 'orders') {
          const res = await request<{ data: AdminOrder[] }>(
            '/api/admin/orders?limit=50',
          );
          if (active) setOrders(res.data);
        } else if (tab === 'refunds') {
          const res = await request<{ data: AdminRefund[] }>(
            '/api/admin/refunds',
          );
          if (active) setRefunds(res.data);
        } else if (tab === 'audit') {
          const res = await request<{ data: AdminAuditEntry[] }>(
            '/api/admin/audit-log?limit=50',
          );
          if (active) setAuditLogs(res.data);
        }
      } catch (err: unknown) {
        if (active) {
          setError(
            err instanceof Error
              ? err.message
              : 'Failed to load administration data',
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadData();
    return () => {
      active = false;
    };
  }, [tab, productStatus, productCategory, productSearch]);

  // Handle Product Creation
  async function handleCreateProduct(e: FormEvent) {
    e.preventDefault();
    if (!createForm.name.trim() || !createForm.description.trim()) {
      setNotice({
        type: 'error',
        message: 'Name and description are required.',
      });
      return;
    }
    const catId = createForm.categoryId || categories[0]?.id;
    if (!catId) {
      setNotice({ type: 'error', message: 'Please select a valid category.' });
      return;
    }

    setCreateSubmitting(true);
    setNotice(null);

    try {
      const res = await request<{ data: AdminProduct }>('/api/admin/products', {
        method: 'POST',
        body: {
          name: createForm.name.trim(),
          description: createForm.description.trim(),
          categoryId: catId,
          price: Number(createForm.price),
          compareAtPrice: createForm.compareAtPrice
            ? Number(createForm.compareAtPrice)
            : null,
          image: createForm.image.trim(),
          isActive: createForm.isActive,
          stock: Number(createForm.stock || 0),
        },
      });

      setNotice({
        type: 'success',
        message: `Product "${res.data.name}" created successfully!`,
      });
      setCreateForm({
        name: '',
        description: '',
        categoryId: categories[0]?.id || '',
        price: '',
        compareAtPrice: '',
        image: '',
        stock: '0',
        isActive: true,
      });
      setIsCreating(false);
      await loadProducts();
    } catch (err) {
      setNotice({
        type: 'error',
        message:
          err instanceof Error ? err.message : 'Failed to create product.',
      });
    } finally {
      setCreateSubmitting(false);
    }
  }

  // Open Edit Modal & load images
  async function handleOpenEdit(product: AdminProduct) {
    setEditingProduct(product);
    setEditForm({
      name: product.name,
      description: product.description || '',
      categoryId: product.categoryId || categories[0]?.id || '',
      price: String(product.price),
      compareAtPrice: product.compareAtPrice
        ? String(product.compareAtPrice)
        : '',
      image: product.image,
      stock: String(product.stock),
      isActive: product.isActive,
    });
    setGalleryLoading(true);
    try {
      const imgRes = await request<{ data: ProductImage[] }>(
        `/api/admin/products/${product.id}/images`,
      );
      setGalleryImages(imgRes.data || []);
    } catch {
      setGalleryImages([]);
    } finally {
      setGalleryLoading(false);
    }
  }

  // Save Edit Changes
  async function handleSaveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editingProduct) return;

    setEditSubmitting(true);
    setNotice(null);

    try {
      // 1. Update basic fields
      await request(`/api/admin/products/${editingProduct.id}`, {
        method: 'PATCH',
        body: {
          name: editForm.name.trim(),
          description: editForm.description.trim(),
          categoryId: editForm.categoryId || undefined,
          price: Number(editForm.price),
          compareAtPrice: editForm.compareAtPrice
            ? Number(editForm.compareAtPrice)
            : null,
          image: editForm.image.trim(),
          isActive: editForm.isActive,
          stock: Number(editForm.stock || 0),
        },
      });

      // 2. Also ensure pricing endpoint is called for price/compareAtPrice
      await request(`/api/admin/products/${editingProduct.id}/pricing`, {
        method: 'PATCH',
        body: {
          price: Number(editForm.price),
          compareAtPrice: editForm.compareAtPrice
            ? Number(editForm.compareAtPrice)
            : null,
        },
      });

      setNotice({
        type: 'success',
        message: `Product "${editForm.name}" updated successfully.`,
      });
      setEditingProduct(null);
      await loadProducts();
    } catch (err) {
      setNotice({
        type: 'error',
        message:
          err instanceof Error ? err.message : 'Failed to update product.',
      });
    } finally {
      setEditSubmitting(false);
    }
  }

  // Toggle Product Active / Publish State
  async function handleToggleActive(product: AdminProduct) {
    const nextActive = !product.isActive;
    try {
      await request(`/api/admin/products/${product.id}`, {
        method: 'PATCH',
        body: { isActive: nextActive },
      });
      setNotice({
        type: 'success',
        message: `Product "${product.name}" is now ${
          nextActive
            ? 'Active (published to store)'
            : 'Archived (hidden from store)'
        }.`,
      });
      await loadProducts();
    } catch (err) {
      setNotice({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Failed to toggle product status.',
      });
    }
  }

  // Archive Product
  async function handleArchiveProduct() {
    if (!productToArchive) return;
    setArchiveSubmitting(true);
    try {
      await request(`/api/admin/products/${productToArchive.id}`, {
        method: 'DELETE',
      });
      setNotice({
        type: 'success',
        message: `Product "${productToArchive.name}" archived and hidden from the store.`,
      });
      setProductToArchive(null);
      await loadProducts();
    } catch (err) {
      setNotice({
        type: 'error',
        message:
          err instanceof Error ? err.message : 'Failed to archive product.',
      });
    } finally {
      setArchiveSubmitting(false);
    }
  }

  // Attach Image to Gallery
  async function handleAddGalleryImage(e: FormEvent) {
    e.preventDefault();
    if (!editingProduct || !newImageUrl.trim()) return;

    setGallerySubmitting(true);
    try {
      await request(`/api/admin/products/${editingProduct.id}/images`, {
        method: 'POST',
        body: {
          url: newImageUrl.trim(),
          altText: newImageAlt.trim() || undefined,
          displayOrder: galleryImages.length,
          isPrimary: newImagePrimary,
        },
      });
      setNewImageUrl('');
      setNewImageAlt('');
      setNewImagePrimary(false);
      setNotice({
        type: 'success',
        message: 'Product image attached to gallery.',
      });
      const imgRes = await request<{ data: ProductImage[] }>(
        `/api/admin/products/${editingProduct.id}/images`,
      );
      setGalleryImages(imgRes.data || []);
      await loadProducts();
    } catch (err) {
      setNotice({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to attach image.',
      });
    } finally {
      setGallerySubmitting(false);
    }
  }

  // Delete Gallery Image
  async function handleDeleteGalleryImage(imageId: string) {
    if (!editingProduct) return;
    try {
      await request(
        `/api/admin/products/${editingProduct.id}/images/${imageId}`,
        { method: 'DELETE' },
      );
      setNotice({
        type: 'success',
        message: 'Gallery image removed.',
      });
      setGalleryImages((prev) => prev.filter((img) => img.id !== imageId));
    } catch (err) {
      setNotice({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to delete image.',
      });
    }
  }

  // Reorder Gallery Images
  async function handleReorderGallery(index: number, direction: 'up' | 'down') {
    if (!editingProduct) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= galleryImages.length) return;

    const reordered = [...galleryImages];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, moved);
    setGalleryImages(reordered);

    try {
      await request(`/api/admin/products/${editingProduct.id}/images/reorder`, {
        method: 'PATCH',
        body: { imageIds: reordered.map((img) => img.id) },
      });
      setNotice({
        type: 'success',
        message: 'Gallery images reordered.',
      });
    } catch (err) {
      setNotice({
        type: 'error',
        message:
          err instanceof Error ? err.message : 'Failed to reorder images.',
      });
    }
  }

  async function handleStatusTransition(orderId: string, nextStatus: string) {
    try {
      await request(`/api/admin/orders/${orderId}/status`, {
        method: 'PATCH',
        body: { status: nextStatus },
      });
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, status: nextStatus } : o)),
      );
      setNotice({
        type: 'success',
        message: `Order status transitioned to ${nextStatus}.`,
      });
    } catch (err: unknown) {
      setNotice({
        type: 'error',
        message: err instanceof Error ? err.message : 'Transition failed',
      });
    }
  }

  async function handleRefundStatus(
    refundId: string,
    nextStatus: 'approved' | 'rejected',
  ) {
    try {
      await request(`/api/admin/refunds/${refundId}/status`, {
        method: 'PATCH',
        body: { status: nextStatus },
      });
      setRefunds((prev) =>
        prev.map((r) => (r.id === refundId ? { ...r, status: nextStatus } : r)),
      );
      setNotice({
        type: 'success',
        message: `Refund request marked as ${nextStatus}.`,
      });
    } catch (err: unknown) {
      setNotice({
        type: 'error',
        message: err instanceof Error ? err.message : 'Refund update failed',
      });
    }
  }

  return (
    <div className="mx-auto max-w-[1200px] px-5 py-12">
      <header className="mb-8 flex flex-col justify-between gap-4 border-b border-rule pb-6 sm:flex-row sm:items-center">
        <div>
          <h1 className="font-display text-[32px] sm:text-[40px]">
            Control Console
          </h1>
        </div>
        <div className="flex items-center gap-4">
          <span className="rounded-full bg-brass-deep/10 px-3 py-1 text-[11px] font-semibold text-brass-deep uppercase">
            {user?.role} — {user?.email}
          </span>
          <Link
            to="/catalog"
            className="text-[12px] font-medium text-ink-muted hover:text-brass-deep"
          >
            Storefront
          </Link>
        </div>
      </header>

      {/* Tabs */}
      <nav
        aria-label="Admin Sections"
        className="mb-8 flex gap-2 border-b border-rule"
      >
        {[
          { key: 'overview', label: 'Overview & Reports' },
          { key: 'products', label: 'Products' },
          { key: 'orders', label: 'Orders' },
          { key: 'refunds', label: 'Refund Requests' },
          { key: 'audit', label: 'Audit Log' },
        ].map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key as typeof tab)}
            className={`border-b-2 px-4 py-2.5 text-[13px] font-medium transition-colors ${
              tab === t.key
                ? 'border-brass-deep text-brass-deep font-semibold'
                : 'border-transparent text-ink-muted hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {/* Feedback Notice */}
      {notice && (
        <div
          role={notice.type === 'error' ? 'alert' : 'status'}
          className={`mb-6 flex items-center justify-between rounded-lg p-4 text-[13px] ${
            notice.type === 'error'
              ? 'border border-red-200 bg-red-50 text-red-800'
              : 'border border-emerald-200 bg-emerald-50 text-emerald-800'
          }`}
        >
          <span>{notice.message}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="ml-4 font-bold text-ink-muted hover:text-ink"
            aria-label="Dismiss notice"
          >
            ✕
          </button>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mb-6 rounded-lg bg-red-50 p-4 text-[13px] text-red-700"
        >
          {error}
        </div>
      )}

      {loading ? (
        <div role="status" className="py-20 text-center text-ink-muted">
          Loading console data…
        </div>
      ) : (
        <div>
          {tab === 'overview' && summary && (
            <div className="space-y-8">
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
                <div className="rounded-xl border border-rule bg-paper p-6">
                  <p className="text-[11px] font-semibold text-ink-muted uppercase">
                    Total Revenue
                  </p>
                  <p className="mt-2 font-display text-[32px]">
                    ₹{summary.totalRevenue.toLocaleString()}
                  </p>
                </div>
                <div className="rounded-xl border border-rule bg-paper p-6">
                  <p className="text-[11px] font-semibold text-ink-muted uppercase">
                    Total Orders
                  </p>
                  <p className="mt-2 font-display text-[32px]">
                    {summary.totalOrders}
                  </p>
                </div>
                <div className="rounded-xl border border-rule bg-paper p-6">
                  <p className="text-[11px] font-semibold text-ink-muted uppercase">
                    Average Order Value
                  </p>
                  <p className="mt-2 font-display text-[32px]">
                    ₹{summary.averageOrderValue.toLocaleString()}
                  </p>
                </div>
              </div>

              <div className="flex gap-4">
                <a
                  href="/api/admin/reports/summary?format=csv"
                  download
                  className="rounded bg-brass-deep px-4 py-2 text-[12px] font-semibold text-paper hover:bg-brass-deep/90"
                >
                  Export Sales Report (CSV)
                </a>
                <a
                  href="/api/admin/reports/low-stock?format=csv"
                  download
                  className="rounded border border-rule px-4 py-2 text-[12px] font-semibold text-ink hover:bg-paper-sunk"
                >
                  Export Low Stock (CSV)
                </a>
              </div>
            </div>
          )}

          {tab === 'products' && (
            <div className="space-y-6">
              {/* Product Tab Toolbar & Filters */}
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    type="search"
                    placeholder="Search products..."
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    className="rounded border border-rule bg-paper px-3 py-1.5 text-[13px] outline-none focus:border-brass-deep"
                  />
                  <select
                    aria-label="Filter by category"
                    value={productCategory}
                    onChange={(e) => setProductCategory(e.target.value)}
                    className="rounded border border-rule bg-paper px-3 py-1.5 text-[13px] outline-none focus:border-brass-deep"
                  >
                    <option value="">All Categories</option>
                    {categories.map((c) => (
                      <option key={c.slug} value={c.slug}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Filter by status"
                    value={productStatus}
                    onChange={(e) =>
                      setProductStatus(
                        e.target.value as 'all' | 'active' | 'archived',
                      )
                    }
                    className="rounded border border-rule bg-paper px-3 py-1.5 text-[13px] outline-none focus:border-brass-deep"
                  >
                    <option value="all">All Statuses</option>
                    <option value="active">Active Only</option>
                    <option value="archived">Archived Only</option>
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => setIsCreating((prev) => !prev)}
                  className="rounded bg-brass px-4 py-2 text-[12px] font-bold tracking-wider text-ground-deep uppercase transition-colors hover:bg-brass-light"
                >
                  {isCreating ? 'Close Form' : '+ Add New Product'}
                </button>
              </div>

              {/* Product Creation Form (ZYV-92) */}
              {isCreating && (
                <div
                  aria-labelledby="create-product-heading"
                  className="rounded-xl border border-brass/40 bg-paper p-6 shadow-sm"
                >
                  <h2
                    id="create-product-heading"
                    className="font-display text-[20px] font-bold text-ink"
                  >
                    Add New Flag Product
                  </h2>
                  <p className="mt-1 text-[12px] text-ink-muted">
                    Enter product specifications to publish to the store
                    catalog.
                  </p>
                  <form
                    onSubmit={handleCreateProduct}
                    className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2"
                  >
                    <div className="sm:col-span-2">
                      <label
                        htmlFor="new-prod-name"
                        className="block text-[11px] font-bold tracking-wider text-ink-muted uppercase"
                      >
                        Product Name *
                      </label>
                      <input
                        id="new-prod-name"
                        type="text"
                        required
                        value={createForm.name}
                        onChange={(e) =>
                          setCreateForm((prev) => ({
                            ...prev,
                            name: e.target.value,
                          }))
                        }
                        placeholder="e.g. ZYVORA Premium Car Flag — Tricolour"
                        className="mt-1.5 w-full rounded border border-rule bg-paper px-3.5 py-2 text-[13px] text-ink outline-none focus:border-brass-deep"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label
                        htmlFor="new-prod-description"
                        className="block text-[11px] font-bold tracking-wider text-ink-muted uppercase"
                      >
                        Description *
                      </label>
                      <textarea
                        id="new-prod-description"
                        required
                        rows={3}
                        value={createForm.description}
                        onChange={(e) =>
                          setCreateForm((prev) => ({
                            ...prev,
                            description: e.target.value,
                          }))
                        }
                        placeholder="Detailed specifications, fabric durability, and mounting instructions..."
                        className="mt-1.5 w-full rounded border border-rule bg-paper px-3.5 py-2 text-[13px] text-ink outline-none focus:border-brass-deep"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="new-prod-category"
                        className="block text-[11px] font-bold tracking-wider text-ink-muted uppercase"
                      >
                        Category *
                      </label>
                      <select
                        id="new-prod-category"
                        required
                        value={createForm.categoryId}
                        onChange={(e) =>
                          setCreateForm((prev) => ({
                            ...prev,
                            categoryId: e.target.value,
                          }))
                        }
                        className="mt-1.5 w-full rounded border border-rule bg-paper px-3.5 py-2 text-[13px] text-ink outline-none focus:border-brass-deep"
                      >
                        {categories.map((c) => (
                          <option key={c.id || c.slug} value={c.id || c.slug}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor="new-prod-price"
                        className="block text-[11px] font-bold tracking-wider text-ink-muted uppercase"
                      >
                        Price (₹ INR) *
                      </label>
                      <input
                        id="new-prod-price"
                        type="number"
                        min="1"
                        required
                        value={createForm.price}
                        onChange={(e) =>
                          setCreateForm((prev) => ({
                            ...prev,
                            price: e.target.value,
                          }))
                        }
                        placeholder="1999"
                        className="mt-1.5 w-full rounded border border-rule bg-paper px-3.5 py-2 text-[13px] text-ink outline-none focus:border-brass-deep"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="new-prod-compare-at-price"
                        className="block text-[11px] font-bold tracking-wider text-ink-muted uppercase"
                      >
                        Compare-at Price (₹ INR, Optional)
                      </label>
                      <input
                        id="new-prod-compare-at-price"
                        type="number"
                        min="1"
                        value={createForm.compareAtPrice}
                        onChange={(e) =>
                          setCreateForm((prev) => ({
                            ...prev,
                            compareAtPrice: e.target.value,
                          }))
                        }
                        placeholder="2499"
                        className="mt-1.5 w-full rounded border border-rule bg-paper px-3.5 py-2 text-[13px] text-ink outline-none focus:border-brass-deep"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="new-prod-stock"
                        className="block text-[11px] font-bold tracking-wider text-ink-muted uppercase"
                      >
                        Initial Stock *
                      </label>
                      <input
                        id="new-prod-stock"
                        type="number"
                        min="0"
                        required
                        value={createForm.stock}
                        onChange={(e) =>
                          setCreateForm((prev) => ({
                            ...prev,
                            stock: e.target.value,
                          }))
                        }
                        placeholder="50"
                        className="mt-1.5 w-full rounded border border-rule bg-paper px-3.5 py-2 text-[13px] text-ink outline-none focus:border-brass-deep"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label
                        htmlFor="new-prod-image"
                        className="block text-[11px] font-bold tracking-wider text-ink-muted uppercase"
                      >
                        Primary Image URL *
                      </label>
                      <input
                        id="new-prod-image"
                        type="url"
                        required
                        value={createForm.image}
                        onChange={(e) =>
                          setCreateForm((prev) => ({
                            ...prev,
                            image: e.target.value,
                          }))
                        }
                        placeholder="https://images.unsplash.com/photo-car-flag.jpg"
                        className="mt-1.5 w-full rounded border border-rule bg-paper px-3.5 py-2 text-[13px] text-ink outline-none focus:border-brass-deep"
                      />
                    </div>

                    <div className="flex items-center gap-2 sm:col-span-2">
                      <input
                        id="new-prod-is-active"
                        type="checkbox"
                        checked={createForm.isActive}
                        onChange={(e) =>
                          setCreateForm((prev) => ({
                            ...prev,
                            isActive: e.target.checked,
                          }))
                        }
                        className="h-4 w-4 accent-brass-deep"
                      />
                      <label
                        htmlFor="new-prod-is-active"
                        className="text-[13px] text-ink-soft font-medium"
                      >
                        Publish immediately to public storefront
                      </label>
                    </div>

                    <div className="flex gap-3 sm:col-span-2">
                      <button
                        type="submit"
                        disabled={createSubmitting}
                        className="rounded bg-brass px-5 py-2.5 text-[11px] font-bold tracking-wider text-ground-deep uppercase hover:bg-brass-light disabled:opacity-50"
                      >
                        {createSubmitting ? 'Creating…' : 'Create Product'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsCreating(false)}
                        className="rounded border border-rule px-5 py-2.5 text-[11px] font-semibold text-ink-muted hover:text-ink"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* Products Table (ZYV-92) */}
              {products.length === 0 ? (
                <div className="rounded-xl border border-rule bg-paper p-12 text-center">
                  <p className="font-display text-[18px] text-ink">
                    No products found.
                  </p>
                  <p className="mt-1 text-[13px] text-ink-muted">
                    No items match the current search filters or none have been
                    created yet.
                  </p>
                  <button
                    type="button"
                    onClick={() => setIsCreating(true)}
                    className="mt-4 rounded bg-brass px-4 py-2 text-[11px] font-bold tracking-wider text-ground-deep uppercase hover:bg-brass-light"
                  >
                    + Add First Product
                  </button>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-rule">
                  <table className="w-full text-left text-[13px]">
                    <thead className="border-b border-rule bg-paper-sunk text-[11px] text-ink-muted uppercase">
                      <tr>
                        <th className="px-4 py-3">Product</th>
                        <th className="px-4 py-3">Category</th>
                        <th className="px-4 py-3">Price</th>
                        <th className="px-4 py-3">Stock</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-rule">
                      {products.map((p) => (
                        <tr
                          key={p.id}
                          className="hover:bg-paper-sunk/50 transition-colors"
                        >
                          <td className="px-4 py-3.5">
                            <div className="flex items-center gap-3">
                              {p.image ? (
                                <img
                                  src={p.image}
                                  alt={p.name}
                                  className="h-10 w-10 rounded object-cover border border-rule bg-paper-sunk"
                                />
                              ) : null}
                              <div>
                                <p className="font-medium text-ink">{p.name}</p>
                                <p className="text-[11px] text-ink-muted line-clamp-1 max-w-[280px]">
                                  {p.description}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3.5 text-ink-muted whitespace-nowrap">
                            {p.categoryName}
                          </td>
                          <td className="px-4 py-3.5 whitespace-nowrap font-medium">
                            ₹{p.price.toLocaleString()}
                            {p.compareAtPrice ? (
                              <span className="ml-1.5 text-[11px] text-ink-muted line-through">
                                ₹{p.compareAtPrice.toLocaleString()}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-4 py-3.5 whitespace-nowrap">
                            <span
                              className={
                                p.stock <= 5
                                  ? 'font-bold text-red-600'
                                  : 'text-ink-soft'
                              }
                            >
                              {p.stock}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => handleToggleActive(p)}
                              title={
                                p.isActive
                                  ? 'Click to hide from store'
                                  : 'Click to publish to store'
                              }
                              className={`rounded px-2.5 py-1 text-[10px] font-semibold uppercase transition-colors ${
                                p.isActive
                                  ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                              }`}
                            >
                              {p.isActive ? 'Active' : 'Archived'}
                            </button>
                          </td>
                          <td className="px-4 py-3.5 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleOpenEdit(p)}
                                className="rounded border border-rule px-2.5 py-1 text-[11px] font-semibold text-ink hover:border-brass-deep hover:text-brass-deep"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => setProductToArchive(p)}
                                className="rounded border border-red-200 px-2.5 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-50"
                              >
                                Archive
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Product Edit Modal (ZYV-92, ZYV-78, ZYV-80) */}
              {editingProduct && (
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="edit-product-heading"
                  className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4"
                >
                  <div className="my-8 max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-paper p-6 shadow-2xl border border-rule">
                    <div className="flex items-center justify-between border-b border-rule pb-4">
                      <h2
                        id="edit-product-heading"
                        className="font-display text-[22px] font-bold text-ink"
                      >
                        Edit Product: {editingProduct.name}
                      </h2>
                      <button
                        type="button"
                        onClick={() => setEditingProduct(null)}
                        className="p-1 font-bold text-ink-muted hover:text-ink"
                        aria-label="Close dialog"
                      >
                        ✕
                      </button>
                    </div>

                    <form onSubmit={handleSaveEdit} className="mt-6 space-y-5">
                      <div>
                        <label
                          htmlFor="edit-prod-name"
                          className="block text-[11px] font-bold tracking-wider text-ink-muted uppercase"
                        >
                          Name *
                        </label>
                        <input
                          id="edit-prod-name"
                          type="text"
                          required
                          value={editForm.name}
                          onChange={(e) =>
                            setEditForm((prev) => ({
                              ...prev,
                              name: e.target.value,
                            }))
                          }
                          className="mt-1.5 w-full rounded border border-rule bg-paper px-3.5 py-2 text-[13px] text-ink outline-none focus:border-brass-deep"
                        />
                      </div>

                      <div>
                        <label
                          htmlFor="edit-prod-description"
                          className="block text-[11px] font-bold tracking-wider text-ink-muted uppercase"
                        >
                          Description *
                        </label>
                        <textarea
                          id="edit-prod-description"
                          required
                          rows={3}
                          value={editForm.description}
                          onChange={(e) =>
                            setEditForm((prev) => ({
                              ...prev,
                              description: e.target.value,
                            }))
                          }
                          className="mt-1.5 w-full rounded border border-rule bg-paper px-3.5 py-2 text-[13px] text-ink outline-none focus:border-brass-deep"
                        />
                      </div>

                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                          <label
                            htmlFor="edit-prod-category"
                            className="block text-[11px] font-bold tracking-wider text-ink-muted uppercase"
                          >
                            Category
                          </label>
                          <select
                            id="edit-prod-category"
                            value={editForm.categoryId}
                            onChange={(e) =>
                              setEditForm((prev) => ({
                                ...prev,
                                categoryId: e.target.value,
                              }))
                            }
                            className="mt-1.5 w-full rounded border border-rule bg-paper px-3.5 py-2 text-[13px] text-ink outline-none focus:border-brass-deep"
                          >
                            {categories.map((c) => (
                              <option
                                key={c.id || c.slug}
                                value={c.id || c.slug}
                              >
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label
                            htmlFor="edit-prod-price"
                            className="block text-[11px] font-bold tracking-wider text-ink-muted uppercase"
                          >
                            Price (₹ INR) *
                          </label>
                          <input
                            id="edit-prod-price"
                            type="number"
                            min="1"
                            required
                            value={editForm.price}
                            onChange={(e) =>
                              setEditForm((prev) => ({
                                ...prev,
                                price: e.target.value,
                              }))
                            }
                            className="mt-1.5 w-full rounded border border-rule bg-paper px-3.5 py-2 text-[13px] text-ink outline-none focus:border-brass-deep"
                          />
                        </div>

                        <div>
                          <label
                            htmlFor="edit-prod-compare-at-price"
                            className="block text-[11px] font-bold tracking-wider text-ink-muted uppercase"
                          >
                            Compare-at Price (₹ INR)
                          </label>
                          <input
                            id="edit-prod-compare-at-price"
                            type="number"
                            min="1"
                            value={editForm.compareAtPrice}
                            onChange={(e) =>
                              setEditForm((prev) => ({
                                ...prev,
                                compareAtPrice: e.target.value,
                              }))
                            }
                            className="mt-1.5 w-full rounded border border-rule bg-paper px-3.5 py-2 text-[13px] text-ink outline-none focus:border-brass-deep"
                          />
                        </div>

                        <div>
                          <label
                            htmlFor="edit-prod-stock"
                            className="block text-[11px] font-bold tracking-wider text-ink-muted uppercase"
                          >
                            Inventory Stock
                          </label>
                          <input
                            id="edit-prod-stock"
                            type="number"
                            min="0"
                            required
                            value={editForm.stock}
                            onChange={(e) =>
                              setEditForm((prev) => ({
                                ...prev,
                                stock: e.target.value,
                              }))
                            }
                            className="mt-1.5 w-full rounded border border-rule bg-paper px-3.5 py-2 text-[13px] text-ink outline-none focus:border-brass-deep"
                          />
                        </div>
                      </div>

                      <div>
                        <label
                          htmlFor="edit-prod-image"
                          className="block text-[11px] font-bold tracking-wider text-ink-muted uppercase"
                        >
                          Primary Image URL
                        </label>
                        <input
                          id="edit-prod-image"
                          type="url"
                          required
                          value={editForm.image}
                          onChange={(e) =>
                            setEditForm((prev) => ({
                              ...prev,
                              image: e.target.value,
                            }))
                          }
                          className="mt-1.5 w-full rounded border border-rule bg-paper px-3.5 py-2 text-[13px] text-ink outline-none focus:border-brass-deep"
                        />
                      </div>

                      <div className="flex items-center gap-2">
                        <input
                          id="edit-prod-is-active"
                          type="checkbox"
                          checked={editForm.isActive}
                          onChange={(e) =>
                            setEditForm((prev) => ({
                              ...prev,
                              isActive: e.target.checked,
                            }))
                          }
                          className="h-4 w-4 accent-brass-deep"
                        />
                        <label
                          htmlFor="edit-prod-is-active"
                          className="text-[13px] text-ink-soft font-medium"
                        >
                          Published to store (is_active)
                        </label>
                      </div>

                      <div className="flex gap-3 border-t border-rule pt-4">
                        <button
                          type="submit"
                          disabled={editSubmitting}
                          className="rounded bg-brass px-5 py-2 text-[11px] font-bold tracking-wider text-ground-deep uppercase hover:bg-brass-light disabled:opacity-50"
                        >
                          {editSubmitting ? 'Saving…' : 'Save Changes'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingProduct(null)}
                          className="rounded border border-rule px-4 py-2 text-[11px] font-semibold text-ink-muted hover:text-ink"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>

                    {/* Image Gallery Management Section (ZYV-80) */}
                    <div className="mt-8 border-t border-rule pt-6">
                      <h3 className="font-display text-[18px] font-bold text-ink">
                        Product Gallery Images
                      </h3>
                      <p className="mt-1 text-[12px] text-ink-muted">
                        Manage additional high-resolution product photographs
                        and display order.
                      </p>

                      {galleryLoading ? (
                        <p className="py-4 text-[13px] text-ink-muted">
                          Loading gallery images…
                        </p>
                      ) : (
                        <div className="mt-4 space-y-3">
                          {galleryImages.length === 0 ? (
                            <p className="text-[12px] text-ink-muted italic">
                              No gallery images attached yet.
                            </p>
                          ) : (
                            galleryImages.map((img, idx) => (
                              <div
                                key={img.id}
                                className="flex items-center justify-between rounded border border-rule p-2.5"
                              >
                                <div className="flex items-center gap-3">
                                  <img
                                    src={img.url}
                                    alt={img.alt_text || 'Product image'}
                                    className="h-12 w-12 rounded object-cover border border-rule"
                                  />
                                  <div>
                                    <p className="text-[12px] font-mono text-ink line-clamp-1 max-w-[260px]">
                                      {img.url}
                                    </p>
                                    <p className="text-[11px] text-ink-muted">
                                      Order: {img.display_order}{' '}
                                      {img.alt_text ? `• ${img.alt_text}` : ''}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    disabled={idx === 0}
                                    onClick={() =>
                                      handleReorderGallery(idx, 'up')
                                    }
                                    className="rounded border border-rule px-2 py-1 text-[10px] font-semibold disabled:opacity-30"
                                  >
                                    ↑ Up
                                  </button>
                                  <button
                                    type="button"
                                    disabled={idx === galleryImages.length - 1}
                                    onClick={() =>
                                      handleReorderGallery(idx, 'down')
                                    }
                                    className="rounded border border-rule px-2 py-1 text-[10px] font-semibold disabled:opacity-30"
                                  >
                                    ↓ Down
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleDeleteGalleryImage(img.id)
                                    }
                                    className="rounded border border-red-200 px-2 py-1 text-[10px] font-semibold text-red-700 hover:bg-red-50"
                                  >
                                    Remove
                                  </button>
                                </div>
                              </div>
                            ))
                          )}

                          {/* Add Image Form */}
                          <form
                            onSubmit={handleAddGalleryImage}
                            className="mt-4 rounded border border-rule/80 bg-paper-sunk/30 p-4 space-y-3"
                          >
                            <h4 className="text-[11px] font-bold tracking-wider text-ink uppercase">
                              Attach Gallery Image
                            </h4>
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                              <div>
                                <input
                                  type="url"
                                  required
                                  placeholder="Image URL (.jpg, .jpeg, .png, .webp)"
                                  value={newImageUrl}
                                  onChange={(e) =>
                                    setNewImageUrl(e.target.value)
                                  }
                                  className="w-full rounded border border-rule bg-paper px-3 py-1.5 text-[12px] text-ink outline-none focus:border-brass-deep"
                                />
                              </div>
                              <div>
                                <input
                                  type="text"
                                  placeholder="Alt text description"
                                  value={newImageAlt}
                                  onChange={(e) =>
                                    setNewImageAlt(e.target.value)
                                  }
                                  className="w-full rounded border border-rule bg-paper px-3 py-1.5 text-[12px] text-ink outline-none focus:border-brass-deep"
                                />
                              </div>
                            </div>
                            <div className="flex items-center justify-between">
                              <label className="flex items-center gap-2 text-[12px] text-ink-muted">
                                <input
                                  type="checkbox"
                                  checked={newImagePrimary}
                                  onChange={(e) =>
                                    setNewImagePrimary(e.target.checked)
                                  }
                                  className="h-3.5 w-3.5 accent-brass-deep"
                                />
                                Set as primary product photo
                              </label>
                              <button
                                type="submit"
                                disabled={
                                  gallerySubmitting || !newImageUrl.trim()
                                }
                                className="rounded bg-brass px-3 py-1.5 text-[11px] font-bold text-ground-deep uppercase hover:bg-brass-light disabled:opacity-50"
                              >
                                {gallerySubmitting
                                  ? 'Attaching…'
                                  : '+ Attach Image'}
                              </button>
                            </div>
                          </form>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Archive Confirmation Modal */}
              {productToArchive && (
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="archive-dialog-title"
                  className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
                >
                  <div className="w-full max-w-md rounded-xl bg-paper p-6 shadow-2xl border border-rule">
                    <h2
                      id="archive-dialog-title"
                      className="font-display text-[20px] font-bold text-ink"
                    >
                      Archive Product
                    </h2>
                    <p className="mt-3 text-[13px] leading-relaxed text-ink-soft">
                      Are you sure you want to archive{' '}
                      <strong>"{productToArchive.name}"</strong>? It will be
                      deactivated and immediately hidden from the public store
                      catalog.
                    </p>
                    <div className="mt-6 flex justify-end gap-3">
                      <button
                        type="button"
                        onClick={() => setProductToArchive(null)}
                        className="rounded border border-rule px-4 py-2 text-[12px] font-semibold text-ink-muted hover:text-ink"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={archiveSubmitting}
                        onClick={handleArchiveProduct}
                        className="rounded bg-red-600 px-4 py-2 text-[12px] font-bold tracking-wider text-white uppercase hover:bg-red-700 disabled:opacity-50"
                      >
                        {archiveSubmitting ? 'Archiving…' : 'Confirm Archive'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'orders' && (
            <div className="overflow-x-auto rounded-xl border border-rule">
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-rule bg-paper-sunk text-[11px] text-ink-muted uppercase">
                  <tr>
                    <th className="px-4 py-3">Order ID</th>
                    <th className="px-4 py-3">Customer</th>
                    <th className="px-4 py-3">Total</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Transition Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {orders.map((o) => (
                    <tr key={o.id} className="hover:bg-paper-sunk/50">
                      <td className="px-4 py-3.5 font-mono text-[12px]">
                        {o.id.slice(0, 8)}…
                      </td>
                      <td className="px-4 py-3.5">{o.customerEmail}</td>
                      <td className="px-4 py-3.5 font-medium">₹{o.total}</td>
                      <td className="px-4 py-3.5 capitalize">{o.status}</td>
                      <td className="px-4 py-3.5">
                        {o.status === 'pending' && (
                          <button
                            type="button"
                            onClick={() =>
                              handleStatusTransition(o.id, 'confirmed')
                            }
                            className="rounded bg-brass-deep px-2.5 py-1 text-[11px] font-semibold text-paper"
                          >
                            Confirm Order
                          </button>
                        )}
                        {o.status === 'confirmed' && (
                          <button
                            type="button"
                            onClick={() =>
                              handleStatusTransition(o.id, 'processing')
                            }
                            className="rounded bg-brass-deep px-2.5 py-1 text-[11px] font-semibold text-paper"
                          >
                            Process
                          </button>
                        )}
                        {o.status === 'processing' && (
                          <button
                            type="button"
                            onClick={() =>
                              handleStatusTransition(o.id, 'shipped')
                            }
                            className="rounded bg-brass-deep px-2.5 py-1 text-[11px] font-semibold text-paper"
                          >
                            Mark Shipped
                          </button>
                        )}
                        {o.status === 'shipped' && (
                          <button
                            type="button"
                            onClick={() =>
                              handleStatusTransition(o.id, 'delivered')
                            }
                            className="rounded bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-paper"
                          >
                            Mark Delivered
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'refunds' && (
            <div className="overflow-x-auto rounded-xl border border-rule">
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-rule bg-paper-sunk text-[11px] text-ink-muted uppercase">
                  <tr>
                    <th className="px-4 py-3">Refund ID</th>
                    <th className="px-4 py-3">Amount</th>
                    <th className="px-4 py-3">Reason</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {refunds.map((r) => (
                    <tr key={r.id} className="hover:bg-paper-sunk/50">
                      <td className="px-4 py-3.5 font-mono text-[12px]">
                        {r.id.slice(0, 8)}…
                      </td>
                      <td className="px-4 py-3.5 font-medium">₹{r.amount}</td>
                      <td className="px-4 py-3.5 text-ink-muted">{r.reason}</td>
                      <td className="px-4 py-3.5 capitalize">{r.status}</td>
                      <td className="px-4 py-3.5">
                        {r.status === 'pending' && (
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                handleRefundStatus(r.id, 'approved')
                              }
                              className="rounded bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-paper"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                handleRefundStatus(r.id, 'rejected')
                              }
                              className="rounded bg-red-600 px-2.5 py-1 text-[11px] font-semibold text-paper"
                            >
                              Reject
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'audit' && (
            <div className="overflow-x-auto rounded-xl border border-rule">
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-rule bg-paper-sunk text-[11px] text-ink-muted uppercase">
                  <tr>
                    <th className="px-4 py-3">Action</th>
                    <th className="px-4 py-3">Entity Type</th>
                    <th className="px-4 py-3">Entity ID</th>
                    <th className="px-4 py-3">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {auditLogs.map((a) => (
                    <tr key={a.id} className="hover:bg-paper-sunk/50">
                      <td className="px-4 py-3.5 font-mono text-[12px]">
                        {a.action}
                      </td>
                      <td className="px-4 py-3.5">{a.entityType}</td>
                      <td className="px-4 py-3.5 font-mono text-[11px] text-ink-muted">
                        {a.entityId ? `${a.entityId.slice(0, 8)}…` : '—'}
                      </td>
                      <td className="px-4 py-3.5 text-ink-muted">
                        {new Date(a.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
