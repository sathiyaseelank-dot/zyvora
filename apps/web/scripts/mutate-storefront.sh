#!/usr/bin/env bash
# Mutation gate for the ZYV-105 / ZYV-106 pages.
#
# Same contract as mutate-catalog.sh: a SURVIVED mutant is a coverage gap, not a
# passing test. These target the two failure modes that matter most on a
# storefront — inventing commercial facts, and disagreeing with the server
# about stock or quantity.
set -uo pipefail
cd "$(dirname "$0")/.."
export PGHOST=/tmp
export DATABASE_URL="postgresql://$(whoami)@/zyvora?host=/tmp" NODE_ENV=test
export JWT_SECRET=ci-secret-not-used-for-production-min-32-chars
export COOKIE_SECRET=ci-cookie-secret-not-used-in-production-32-chars

PASSED=0
SURVIVED=0
FAILED_MUTANT=0

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

  if timeout 400 npx vitest run test/catalog-page.test.tsx test/product-detail.test.tsx \
      >/tmp/opencode/mut-web.log 2>&1; then
    echo "  SURVIVED     $label"
    SURVIVED=$((SURVIVED + 1))
  else
    # A mutant that breaks the BUILD is not a caught mutant. Vitest exits
    # non-zero on a transform error with zero tests executed, and counting that
    # as a catch would let this gate report success for mutants that were never
    # tested against anything. The first mutant written here did exactly that:
    # replacing an object spread with `{},` produced a syntax error, vitest ran
    # nothing, and the gate counted it as caught with zero failures.
    local ran failed
    ran=$(grep -oE 'Tests +[0-9]+ (passed|failed)' /tmp/opencode/mut-web.log | tail -1 | grep -oE '[0-9]+' | head -1)
    failed=$(grep -cE '^ +× ' /tmp/opencode/mut-web.log)

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

CAT=src/pages/CatalogPage.tsx
DET=src/pages/ProductDetailPage.tsx

echo "=== mutation gate: storefront (ZYV-105 / ZYV-106) ==="

# --- inventing commercial facts -----------------------------------------
run "$CAT" "grid: rating printed even when the API sent null" \
  "{product.rating && (" \
  "{true && ("

run "$DET" "detail: rating printed even when the API sent null" \
  "{product.rating && (" \
  "{true && ("

run "$CAT" "grid: out-of-stock shown as in stock" \
  "{product.inStock ? (
                      <span className=\"text-forest\">In stock</span>" \
  "{!product.inStock ? (
                      <span className=\"text-forest\">In stock</span>"

run "$CAT" "grid: sold-out product gets an enabled add-to-cart button" \
  "disabled={!product.inStock || adding === product.id}" \
  "disabled={adding === product.id}"

run "$DET" "detail: sold-out product gets an enabled add-to-cart button" \
  "disabled={!product.inStock || busy}" \
  "disabled={busy}"

# --- agreeing with the server about stock --------------------------------
run "$DET" "detail: quantity clamp to available removed" \
  "Math.min(
                        Math.max(1, Number(e.target.value) || 1),
                        product.quantityAvailable,
                      )" \
  "Math.max(1, Number(e.target.value) || 1)"

run "$DET" "detail: a server fault reported as 'product does not exist'" \
  "if (status === 404) setMissing(true);
        else setFailed(true);" \
  "setMissing(true);"

# --- passing the URL state through to the API ----------------------------
run "$CAT" "grid: sort never sent to the API" \
  "sort: sortValue," \
  "sort: 'name_asc',"

run "$CAT" "grid: page never sent to the API" \
  "page,
            sort: sortValue," \
  "sort: sortValue,"

run "$CAT" "grid: category filter never sent to the API" \
  "...(category ? { category: category as never } : {})," \
  "...(false ? { category: category as never } : {}),"

run "$CAT" "grid: category filter sent as a value that matches nothing" \
  "...(category ? { category: category as never } : {})," \
  "...(category ? { category: 'no-such-category' as never } : {}),"

run "$CAT" "grid: unknown sort values passed through unvalidated" \
  "const sortValue: ProductSort = SORTS.some((s) => s.value === sort)
    ? (sort as ProductSort)
    : 'name_asc';" \
  "const sortValue: ProductSort = sort as ProductSort;"

# --- pagination ----------------------------------------------------------
run "$CAT" "grid: pagination controls hidden even when there are pages" \
  "{showControls && totalPages > 1 && (" \
  "{false && ("

run "$CAT" "grid: previous enabled on the first page" \
  "disabled={page <= 1}" \
  "disabled={false}"

run "$CAT" "grid: next enabled on the last page" \
  "disabled={page >= totalPages}" \
  "disabled={false}"

# --- search --------------------------------------------------------------
run "$CAT" "grid: filter controls shown during a search they cannot apply" \
  "{showControls && (
        <div className=\"mt-6 flex flex-wrap items-center gap-3\">" \
  "{true && (
        <div className=\"mt-6 flex flex-wrap items-center gap-3\">"

# --- reporting the outcome ----------------------------------------------
run "$CAT" "grid: 'added' confirmation never cleared" \
  "setTimeout(() => setAdded((c) => (c === productId ? null : c)), 2500);" \
  "void 0;"

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