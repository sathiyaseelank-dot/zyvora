# 03 — Form & Validation Improvements

This document outlines improvements for product creation, editing, pricing logic, and image upload management in the ZYVORA Admin Console.

---

## 1. Live Image URL Previews

### Current Behavior:
In both the Product Creation form and the Edit Product modal, the primary image input is a standard text input:
```tsx
<input
  type="url"
  value={createForm.image}
  placeholder="https://images.unsplash.com/photo-car-flag.jpg"
/>
```
Admins cannot see what the image looks like before submitting the form. If an invalid or 404 URL is pasted, it is saved, leading to a broken image tile on the storefront.

### Proposed Improvement:
Add a live image preview thumbnail right next to the URL input:
- Shows a 64×64 or 80×80 thumbnail preview as soon as a valid URL string is typed.
- Renders an error fallback badge if the image fails to load (`onError`).
- Displays an "Image loaded successfully" indicator.

```tsx
{form.image && (
  <div className="mt-2 flex items-center gap-3 rounded-lg border border-rule bg-paper-sunk p-2">
    <img
      src={form.image}
      alt="Preview"
      className="h-16 w-16 rounded object-cover border border-rule"
      onError={(e) => {
        (e.target as HTMLElement).style.display = 'none';
      }}
    />
    <div className="text-[11px] text-ink-muted">
      <span>Preview of primary storefront photo</span>
    </div>
  </div>
)}
```

---

## 2. Pricing Guardrails (`compareAtPrice` vs `price`)

### Current Behavior:
The price and compare-at price inputs have no cross-field validation on the frontend:
- An admin can input `Price: ₹1999` and `Compare-at Price: ₹999`.
- In e-commerce semantics, `compareAtPrice` represents the original MSRP / strikethrough price, which must be strictly greater than the selling `price`.
- Entering a lower compare-at price causes broken UI badges (e.g. "Save -50%").

### Proposed Improvement:
Add frontend validation warning or block when `compareAtPrice <= price`:
```tsx
const isInvalidDiscount = 
  Number(form.compareAtPrice) > 0 && 
  Number(form.compareAtPrice) <= Number(form.price);

{isInvalidDiscount && (
  <p className="mt-1 text-[11px] text-amber-700">
    ⚠️ Compare-at price (original MSRP) should be higher than the selling price.
  </p>
)}
```

---

## 3. Numeric Constraints on Price and Stock

### Current Behavior:
Input fields are `<input type="number">` without `min="0"` or `step="1"`:
- Allows typing negative numbers like `-500` for price or `-10` for stock.

### Proposed Improvement:
Add explicit HTML5 constraints:
```tsx
<input
  type="number"
  min="1"
  step="1"
  placeholder="1999"
  required
/>
```
And for inventory stock:
```tsx
<input
  type="number"
  min="0"
  step="1"
  placeholder="50"
  required
/>
```

---

## 4. Unsaved Changes Dirty Warning (Prevent Accidental Data Loss)

### Current Behavior:
When editing a product in the Edit Modal:
- Clicking the background backdrop, the `✕` close button, or the `Cancel` button immediately closes the modal and discards all changes without confirmation.

### Proposed Improvement:
Track form dirty state:
```tsx
const isDirty = 
  editForm.name !== editingProduct.name ||
  editForm.description !== editingProduct.description ||
  editForm.price !== String(editingProduct.price) ||
  editForm.stock !== String(editingProduct.stock);

function handleClose() {
  if (isDirty && !window.confirm('You have unsaved changes. Discard?')) {
    return;
  }
  setEditingProduct(null);
}
```
