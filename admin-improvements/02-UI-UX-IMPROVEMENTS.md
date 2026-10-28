# 02 — UI & UX Improvements

This document outlines high-impact User Interface and User Experience improvements identified during the live testing session of the ZYVORA Admin Console.

---

## 1. Search Input Debouncing (Performance & Rate-Limiting Protection)

### Current Behavior:

In `AdminDashboardPage.tsx`:

```tsx
<input
  type="search"
  placeholder="Search products..."
  value={productSearch}
  onChange={(e) => setProductSearch(e.target.value)}
/>
```

Every single character typed triggers `setProductSearch`, which immediately triggers the `useEffect` and fires a network request to `/api/admin/products?search=...`.

### Impact:

- If an admin types "Tricolour Flag" (14 characters), 14 separate API requests are sent to the backend within ~1.5 seconds.
- This creates unnecessary server load, exhausts rate limits, and can cause race conditions if responses resolve out of order.

### Proposed Improvement:

Implement a 300ms debounce hook (e.g. `useDebounce(productSearch, 300)`) so backend queries are only dispatched after typing pauses:

```tsx
const [productSearch, setProductSearch] = useState('');
const debouncedSearch = useDebounce(productSearch, 300);

useEffect(() => {
  // load products using debouncedSearch
}, [tab, productStatus, productCategory, debouncedSearch]);
```

---

## 2. Empty States for Orders, Refund Requests, and Audit Logs

### Current Behavior:

- **Products tab** has a dedicated empty state box when `products.length === 0`:
  > _"No products found. No items match the current search filters or none have been created yet."_ with a `+ Add First Product` CTA.
- **Orders, Refund Requests, and Audit Log tabs** render a blank `<tbody>` inside a table border when empty.

### Proposed Improvement:

Create a standardized `<EmptyState />` component across all tabs:

```tsx
{orders.length === 0 ? (
  <div className="rounded-xl border border-rule bg-paper p-12 text-center">
    <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-paper-sunk text-ink-muted">
      📦
    </div>
    <p className="font-display text-[18px] text-ink">No orders found</p>
    <p className="mt-1 text-[13px] text-ink-muted">
      Customer orders will appear here once placed on the storefront.
    </p>
  </div>
) : ( ... )}
```

Apply equivalent friendly empty states for:

- **Refund Requests:** _"No active refund requests. All return and cancellation inquiries have been resolved."_
- **Audit Log:** _"No audit records recorded for this filter range."_

---

## 3. Clear / Reset Filters Button

### Current Behavior:

When an admin has typed a search query and selected both a Category filter and a Status filter, clearing all filters requires 3 separate manual interactions (deleting search text, clicking category dropdown to "All Categories", clicking status dropdown to "All Statuses").

### Proposed Improvement:

Add a dynamic **"Reset Filters"** button when any filter is active:

```tsx
const isFiltered = Boolean(
  productSearch || productCategory || productStatus !== 'all',
);

{
  isFiltered && (
    <button
      type="button"
      onClick={() => {
        setProductSearch('');
        setProductCategory('');
        setProductStatus('all');
      }}
      className="text-[12px] font-semibold text-brass-deep underline hover:text-brass"
    >
      Clear all filters
    </button>
  );
}
```

---

## 4. Table Pagination & Sorting Controls

### Current Behavior:

The endpoints hardcode `limit=50`:

```tsx
const res = await request<...>(`/api/admin/products?limit=50...`);
```

- There are no Next/Previous page controls or page numbers.
- Once catalog size exceeds 50 products or orders exceed 50, older items cannot be viewed without manual search filtering.
- Table headers (`PRODUCT`, `PRICE`, `STOCK`, `DATE`) are non-clickable and do not support sorting.

### Proposed Improvement:

1. **Pagination Controls:** Add pagination controls at the bottom of data tables displaying:
   - Showing `1-20 of 142 items`
   - Previous / Next buttons with disabled states.
2. **Column Sorting:** Add clickable column headers with sorting indicator icons (▲ / ▼) for `Price`, `Stock`, `Created At`, and `Total`.

---

## 5. Responsive Layout for Mobile & Small Screens

### Current Behavior:

Tables use `overflow-x-auto`. On screens under 640px, the wide tables require horizontal swipe gestures, and action buttons (`Edit`, `Archive`, `Confirm`) may be clipped outside the viewport.

### Proposed Improvement:

Add a responsive card-view alternative on mobile screens (`block md:hidden`), displaying:

- Product thumbnail, Title, Category tag.
- Badges for Stock and Status.
- Tap action buttons neatly stacked.
  Keep the full table on `hidden md:table`.
