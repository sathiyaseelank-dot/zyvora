# 05 — Accessibility, Polish & Technical Resilience

This document outlines improvements for accessibility (a11y), visual polish, and technical architecture in the ZYVORA Admin Console.

---

## 1. Accessibility (a11y) & Focus Trapping

### Observations from Live Testing:

1. **Modal Focus Trapping:**
   - In `AdminDashboardPage.tsx`, the Edit Product Modal and Archive Confirmation Modal have `role="dialog"` and `aria-modal="true"`.
   - However, they do not programmatically trap focus. Pressing `Tab` repeatedly can cause focus to leak out into background elements (such as header links or background table rows).
2. **Keyboard Escape Handler:**
   - Pressing `Escape` does not close the Edit Modal or the Archive Confirmation Modal.
3. **Table Accessibility:**
   - Tables across tabs lack explicit `caption` or `aria-label` identifying their contents for screen reader users (e.g. `aria-label="Admin Products Catalog"`).

### Proposed Improvement:

- Add an `Escape` key event listener to close active dialogs.
- Add `focus-trap-react` or an accessible focus management hook to keep focus inside active modals.
- Add descriptive `aria-label` attributes to each data table.

---

## 2. Notification Toast Polish (Auto-dismiss)

### Current Behavior:

When actions succeed or fail, a banner appears above the main content:

```tsx
{
  notice && (
    <div role={notice.type === 'error' ? 'alert' : 'status'}>
      <span>{notice.message}</span>
      <button onClick={() => setNotice(null)}>✕</button>
    </div>
  );
}
```

The notice remains permanently on screen until the user manually clicks `✕` or performs another mutation.

### Proposed Improvement:

- Automatically dismiss success notices after 5 seconds (`setTimeout`).
- Keep error alerts persistent until dismissed, ensuring admins do not miss critical failure messages.
- Add a subtle fade-out transition.

---

## 3. Robust Authenticated Report Downloads (Blob Handling)

### Current Behavior:

In `AdminDashboardPage.tsx`:

```tsx
<a href="/api/admin/reports/summary?format=csv" download className="...">
  Export Sales Report (CSV)
</a>
```

- This works as long as authentication is purely cookie-based with matching CORS credentials.
- However, if the session cookie is strict, or if the API switches to Bearer tokens or needs error handling (e.g. if the report fails to generate, the user is navigated away to a JSON error page), plain `<a>` tags fail silently or break navigation.

### Proposed Improvement:

Use an authenticated blob download handler:

```tsx
async function downloadReport(url: string, filename: string) {
  try {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error('Report generation failed');
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(blobUrl);
  } catch (err) {
    setNotice({ type: 'error', message: 'Failed to download report.' });
  }
}
```

---

## 4. Test Coverage for Gallery Reorder Mutation

### Background:

During mutation testing (`apps/web/scripts/mutate-admin-ui.sh`), 1 mutant survived:

- `gallery: reorder endpoint call omitted` survived because the test did not assert that `PATCH /api/admin/products/:id/images/reorder` was executed with the expected payload.

### Proposed Improvement:

Update `apps/web/test/admin-products.test.tsx` to assert:

```tsx
expect(mockFetch).toHaveBeenCalledWith(
  expect.stringContaining('/api/admin/products/test-id/images/reorder'),
  expect.objectContaining({
    method: 'PATCH',
    body: JSON.stringify({ imageIds: ['img-2', 'img-1'] }),
  }),
);
```

Closing this gap will bring mutation suite coverage to 100%.
