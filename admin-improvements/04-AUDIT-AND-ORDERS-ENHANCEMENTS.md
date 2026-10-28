# 04 — Order & Audit Log Enhancements

This document outlines improvements for order lifecycle management and audit log inspection.

---

## 1. Audit Log Payload Inspector (Diff Modal for `oldValues` vs `newValues`)

### Current Behavior:
The backend `/api/admin/audit-log` returns rich payload metadata:
```json
{
  "action": "order.status_changed",
  "entityType": "order",
  "entityId": "c68a983c-96de-4d25-b2ac-5f591d9567ae",
  "createdAt": "2026-10-19T16:42:41.054Z",
  "ipAddress": "::1",
  "userAgent": "Mozilla/5.0 ...",
  "oldValues": { "status": "shipped" },
  "newValues": { "status": "delivered", "note": null }
}
```
However, the UI table currently only displays:
`ACTION | ENTITY TYPE | ENTITY ID | DATE`

### Problem:
Admins cannot see **what actually changed**. If a product pricing was updated from ₹999 to ₹1499, or stock was adjusted, the audit entry only shows `admin.product.pricing_update`, leaving the admin blind to the exact modified values.

### Proposed Improvement:
1. Make audit log rows clickable or add a `View Details` button.
2. Clicking opens an Audit Details Modal or drawer displaying:
   - Changed Fields Diff:
     - `status`: `shipped` → `delivered`
     - `price`: `₹999` → `₹1,499`
   - Metadata: IP Address (`::1`), User Agent, Admin Actor ID.
   - Raw JSON expander for technical auditing.

---

## 2. Order Management Search & Status Filtering

### Current Behavior:
The Orders tab displays a plain list of recent orders up to 50 items.
- There is no search box to look up an order by **Order ID**, **Customer Email**, or **Customer Name**.
- There is no filter dropdown to filter orders by state (`pending`, `confirmed`, `processing`, `shipped`, `delivered`, `cancelled`).

### Proposed Improvement:
Add a top toolbar to the Orders tab matching the Products tab:
```tsx
<div className="flex flex-wrap items-center gap-3">
  <input
    type="search"
    placeholder="Search by Order ID or customer email..."
    value={orderSearch}
    onChange={(e) => setOrderSearch(e.target.value)}
  />
  <select
    value={orderStatusFilter}
    onChange={(e) => setOrderStatusFilter(e.target.value)}
  >
    <option value="all">All Order Statuses</option>
    <option value="pending">Pending</option>
    <option value="confirmed">Confirmed</option>
    <option value="processing">Processing</option>
    <option value="shipped">Shipped</option>
    <option value="delivered">Delivered</option>
  </select>
</div>
```

---

## 3. Order Status Transition Confirmation

### Current Behavior:
Clicking `Confirm Order`, `Process`, `Mark Shipped`, or `Mark Delivered` instantly executes the transition without confirmation.
- While archiving a product asks for confirmation, advancing an order (which may trigger shipping notifications or inventory lock) does not.

### Proposed Improvement:
Add a lightweight confirmation dialog or confirmation popover before advancing orders to irreversible states like `Shipped` or `Delivered`.
