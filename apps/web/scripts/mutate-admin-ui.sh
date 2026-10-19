#!/usr/bin/env bash
# Mutation gate for ZYV-92 Admin Product Management UI.
#
# Verifies that tests catch regressions in:
# 1. Archive execution (DELETE /api/admin/products/:id)
# 2. Publish state toggle (isActive flip)
# 3. Form validation (required name & description checks)
# 4. Empty state rendering
# 5. Edit flow pricing update (/api/admin/products/:id/pricing)
# 6. Gallery reordering (/api/admin/products/:id/images/reorder)
set -uo pipefail
cd "$(dirname "$0")/.."
export NODE_ENV=test

PASSED=0
SURVIVED=0
FAILED_MUTANT=0
LOG_FILE="/tmp/zyvora-mut-admin-ui.log"

# run <file> <label> <from> <to>
run() {
  local file="$1" label="$2" from="$3" to="$4"
  local backup
  backup=$(mktemp)
  cp "$file" "$backup"

  if ! grep -qF -- "$from" "$file"; then
    echo "  SETUP-ERROR  $label (anchor not found)"
    FAILED_MUTANT=$((FAILED_MUTANT + 1))
    rm -f "$backup"
    return
  fi

  python3 - "$file" "$from" "$to" <<'PY'
import sys
path, a, b = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(path).read()
assert a in s, "anchor vanished"
open(path, 'w').write(s.replace(a, b, 1))
PY

  if timeout 400 npx vitest run test/admin-products.test.tsx >"$LOG_FILE" 2>&1; then
    echo "  SURVIVED     $label"
    SURVIVED=$((SURVIVED + 1))
  else
    local ran failed
    ran=$(grep -oE 'Tests +[0-9]+ (passed|failed)' "$LOG_FILE" | tail -1 | grep -oE '[0-9]+' | head -1)
    failed=$(grep -cE '^ +× ' "$LOG_FILE" || true)

    if [ -z "${ran:-}" ] || [ "$ran" -eq 0 ]; then
      echo "  BROKE-BUILD  $label (no tests executed - not a valid catch)"
      FAILED_MUTANT=$((FAILED_MUTANT + 1))
    else
      echo "  caught ($failed)  $label"
      PASSED=$((PASSED + 1))
    fi
  fi

  cp "$backup" "$file"
  rm -f "$backup"
}

ADMIN=src/pages/AdminDashboardPage.tsx

echo "=== mutation gate: admin product UI (ZYV-92) ==="

# --- archive execution ----------------------------------------------------
run "$ADMIN" "archive: DELETE call skipped" \
  "await request(\`/api/admin/products/\${productToArchive.id}\`, {
        method: 'DELETE',
      });" \
  "void 0;"

# --- publish toggle -------------------------------------------------------
run "$ADMIN" "publish-toggle: active status not inverted" \
  "const nextActive = !product.isActive;" \
  "const nextActive = product.isActive;"

# --- form validation ------------------------------------------------------
run "$ADMIN" "creation-form: name and description validation removed" \
  "if (!createForm.name.trim() || !createForm.description.trim()) {" \
  "if (false) {"

# --- empty state ----------------------------------------------------------
run "$ADMIN" "empty-state: empty state banner never rendered" \
  "{products.length === 0 ? (" \
  "{false ? ("

# --- pricing endpoint update in edit -------------------------------------
run "$ADMIN" "edit-modal: separate pricing endpoint update omitted" \
  "await request(\`/api/admin/products/\${editingProduct.id}/pricing\`, {" \
  "if (false) await request(\`/api/admin/products/\${editingProduct.id}/pricing\`, {"

# --- gallery reorder ------------------------------------------------------
run "$ADMIN" "gallery: reorder endpoint call omitted" \
  "await request(
        \`/api/admin/products/\${editingProduct.id}/images/reorder\`," \
  "if (false) await request(
        \`/api/admin/products/\${editingProduct.id}/images/reorder\`,"

echo
echo "  caught: $PASSED   survived: $SURVIVED   setup-errors: $FAILED_MUTANT"

if [ "$FAILED_MUTANT" -gt 0 ]; then
  echo "  RESULT: INCONCLUSIVE - $FAILED_MUTANT mutant(s) could not be applied."
  exit 2
fi
if [ "$SURVIVED" -gt 0 ]; then
  echo "  RESULT: $SURVIVED mutant(s) survived - the suite has a coverage gap."
  exit 1
fi
echo "  RESULT: all $PASSED mutants caught."
