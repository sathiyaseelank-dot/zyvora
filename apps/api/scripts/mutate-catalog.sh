#!/usr/bin/env bash
# Mutation gate for the catalogue changes (ZYV-105).
#
# Each mutant is a single semantic change to apps/api/src/routes/catalog.ts.
# A mutant SURVIVED means the test suite would not have noticed the behaviour
# changing — which is a coverage gap, not a passing test.
set -uo pipefail
cd "$(dirname "$0")/.."
export PGHOST=/tmp
export DATABASE_URL="postgresql://$(whoami)@/zyvora?host=/tmp" NODE_ENV=test
export JWT_SECRET=ci-secret-not-used-for-production-min-32-chars
export COOKIE_SECRET=ci-cookie-secret-not-used-in-production-32-chars

SRC=src/routes/catalog.ts
BACKUP=$(mktemp)
cp "$SRC" "$BACKUP"
trap 'cp "$BACKUP" "$SRC"; rm -f "$BACKUP"' EXIT

PASSED=0
SURVIVED=0
FAILED_MUTANT=0

# run <label> <from> <to>
run() {
  local label="$1" from="$2" to="$3"
  cp "$BACKUP" "$SRC"

  if ! grep -qF -- "$from" "$SRC"; then
    echo "  SETUP-ERROR  $label (anchor not found)"
    FAILED_MUTANT=$((FAILED_MUTANT + 1))
    return
  fi

  python3 - "$SRC" "$from" "$to" <<'PY'
import sys
path, a, b = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(path).read()
open(path, 'w').write(s.replace(a, b, 1))
PY

  if timeout 300 node --import tsx --test test/catalog.test.ts >/tmp/opencode/mut.log 2>&1; then
    echo "  SURVIVED     $label"
    SURVIVED=$((SURVIVED + 1))
  else
    # A mutant that fails to COMPILE is not a caught mutant. node --test exits
    # non-zero on a transform or import error having run nothing, and counting
    # that as a catch would let this gate report success for mutants that were
    # never exercised against a single assertion.
    local ran failed
    ran=$(grep -oE '^. (tests) [0-9]+' /tmp/opencode/mut.log | tail -1 | grep -oE '[0-9]+' | head -1)
    failed=$(grep -cE '^  ✖' /tmp/opencode/mut.log)

    if [ -z "${ran:-}" ] || [ "$ran" -eq 0 ]; then
      echo "  BROKE-BUILD  $label (no tests executed - not a valid catch)"
      FAILED_MUTANT=$((FAILED_MUTANT + 1))
    else
      echo "  caught ($failed)  $label"
      PASSED=$((PASSED + 1))
    fi
  fi
}

echo "=== mutation gate: catalogue (ZYV-105) ==="

# --- stock ---------------------------------------------------------------
run "sellable: > 0  becomes  >= 0 (fully reserved reads as available)" \
  "(row.quantity ?? 0) - (row.reserved_quantity ?? 0) > 0" \
  "(row.quantity ?? 0) - (row.reserved_quantity ?? 0) >= 0"

run "sellable: missing inventory row defaults to in stock" \
  "(row.quantity ?? 0) - (row.reserved_quantity ?? 0) > 0" \
  "(row.quantity ?? 99) - (row.reserved_quantity ?? 0) > 0"

run "sellable: reserved quantity ignored entirely" \
  "(row.quantity ?? 0) - (row.reserved_quantity ?? 0) > 0" \
  "(row.quantity ?? 0) > 0"

# --- ratings -------------------------------------------------------------
run "ratings: unverified purchases included in the average" \
  ".where('is_verified_purchase', '=', true)" \
  ".where('product_id', 'in', ids)"

run "ratings: no reviews reported as a zero rating instead of null" \
  "rating: ratings.get(row.id) ?? null" \
  "rating: ratings.get(row.id) ?? { average: 0, count: 0 }"

run "ratings: average not rounded to one decimal" \
  "average: Math.round(average * 10) / 10" \
  "average: average"

run "ratings: rating attached to the wrong product" \
  "ratings.set(row.product_id, {" \
  "ratings.set('00000000-0000-4000-8000-000000000000', {"

# --- filtering -----------------------------------------------------------
run "filter: inactive products are listed" \
  ".where('products.is_active', '=', true);" \
  ".where('products.is_active', 'in', [true, false]);"

run "filter: category filter removed from the row query" \
  "query = query.where('categories.slug', '=', category);
    }

    switch (sort)" \
  "}

    switch (sort)"

run "filter: category filter removed from the count query" \
  "countQuery = countQuery.where('categories.slug', '=', category);" \
  ""

# --- pagination ----------------------------------------------------------
run "pagination: totalPages loses its floor of one" \
  "totalPages: Math.max(1, Math.ceil(totalCount / pageSize))" \
  "totalPages: Math.ceil(totalCount / pageSize)"

run "pagination: page window offset ignored" \
  "const offset = (page - 1) * pageSize;
    const rows = await query.limit(pageSize).offset(offset).execute();" \
  "const offset = 0;
    const rows = await query.limit(pageSize).offset(offset).execute();"

run "pagination: count query stops ignoring the page window" \
  "const counted = await countQuery.executeTakeFirstOrThrow();" \
  "countQuery = countQuery.limit(pageSize).offset((page - 1) * pageSize);
    const counted = await countQuery.executeTakeFirstOrThrow();"

# --- sorting -------------------------------------------------------------
run "sort: price ascending inverted" \
  "query = query.orderBy('products.price', 'asc');" \
  "query = query.orderBy('products.price', 'desc');"

run "sort: price descending inverted" \
  "query = query.orderBy('products.price', 'desc');" \
  "query = query.orderBy('products.price', 'asc');"

run "sort: name descending inverted" \
  "query = query.orderBy('products.name', 'desc');" \
  "query = query.orderBy('products.name', 'asc');"

# --- detail --------------------------------------------------------------
run "detail: unknown product returns 200 with nulls instead of 404" \
  "throw new AppError('NOT_FOUND', 'Product not found');" \
  "return res.json({ data: null });"

run "detail: inactive product exposed by direct id" \
  ".where('products.id', '=', id)
      .where('products.is_active', '=', true)" \
  ".where('products.id', '=', id)"

# --- search --------------------------------------------------------------
run "search: description no longer searched" \
  "eb('products.description', 'ilike', pattern),
        ])," \
  "'false',
        ]),"

echo
echo "  caught: $PASSED   survived: $SURVIVED   setup-errors: $FAILED_MUTANT"

if [ "$FAILED_MUTANT" -gt 0 ]; then
  echo "  RESULT: INCONCLUSIVE - $FAILED_MUTANT mutant(s) could not be applied."
  echo "          A mutation gate that did not run is not a pass."
  exit 2
fi
if [ "$SURVIVED" -gt 0 ]; then
  echo "  RESULT: $SURVIVED mutant(s) survived - the suite has a coverage gap."
  exit 1
fi
echo "  RESULT: all $PASSED mutants caught."