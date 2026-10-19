#!/usr/bin/env bash
# Mutation gate for the orders security, ownership and lifecycle surface (E9: ZYV-61, ZYV-77, ZYV-89, ZYV-87).
#
# Asserts that order ownership, stock reservation, and status policy regressions
# are caught by the test suite rather than passing silently.
set -uo pipefail
cd "$(dirname "$0")/.."
export PGHOST=/tmp
export DATABASE_URL="postgresql://$(whoami)@/zyvora?host=/tmp" NODE_ENV=test
export JWT_SECRET=ci-secret-not-used-for-production-min-32-chars
export COOKIE_SECRET=ci-cookie-secret-not-used-in-production-32-chars

ORDER_SRC=src/routes/order.ts
ORDER_BACKUP=$(mktemp)

cp "$ORDER_SRC" "$ORDER_BACKUP"

restore() {
  cp "$ORDER_BACKUP" "$ORDER_SRC"
  rm -f "$ORDER_BACKUP"
}
trap restore EXIT

PASSED=0
SURVIVED=0
FAILED_MUTANT=0

# run_mutation <file> <label> <from> <to>
run_mutation() {
  local target_file="$1" label="$2" from="$3" to="$4"
  
  # Always restore to clean baseline first
  cp "$ORDER_BACKUP" "$ORDER_SRC"

  if ! grep -qF -- "$from" "$target_file"; then
    echo "  SETUP-ERROR  $label (anchor not found in $target_file)"
    FAILED_MUTANT=$((FAILED_MUTANT + 1))
    return
  fi

  python3 - "$target_file" "$from" "$to" <<'PY'
import sys
path, a, b = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(path).read()
open(path, 'w').write(s.replace(a, b, 1))
PY

  mkdir -p /tmp/zyvora-mutations
  if timeout 120 node --import tsx --test test/order.test.ts >/tmp/zyvora-mutations/order-mut.log 2>&1; then
    echo "  SURVIVED     $label"
    SURVIVED=$((SURVIVED + 1))
  else
    if grep -q "SyntaxError\|Cannot find module\|ReferenceError\|TypeError: " /tmp/zyvora-mutations/order-mut.log && ! grep -q "AssertionError" /tmp/zyvora-mutations/order-mut.log; then
      echo "  INCONCLUSIVE $label (broke build/syntax rather than caught by behavioral assertion)"
      FAILED_MUTANT=$((FAILED_MUTANT + 1))
    else
      echo "  CAUGHT       $label"
      PASSED=$((PASSED + 1))
    fi
  fi
}

echo "Running E9 Orders mutation checks..."

# Mutant 1: Disable address ownership check
run_mutation "$ORDER_SRC" "orders.address_ownership_bypass" \
  ".where('id', '=', addressId)
      .where('user_id', '=', user.id)" \
  ".where('id', '=', addressId)
      /* removed address owner filter */"

# Mutant 2: Disable cart empty check
run_mutation "$ORDER_SRC" "orders.empty_cart_bypass" \
  "if (cartItems.length === 0)" \
  "if (false && cartItems.length === 0)"

# Mutant 3: Disable stock reservation on order creation
run_mutation "$ORDER_SRC" "orders.skip_inventory_reservation" \
  "reserved_quantity: eb('reserved_quantity', '+', item.quantity)" \
  "reserved_quantity: eb('reserved_quantity', '+', 0)"

# Mutant 4: Permit cancellation of shipped and delivered orders
run_mutation "$ORDER_SRC" "orders.cancellation_policy_bypass" \
  "const CANCELLABLE_STATUSES = ['pending', 'confirmed', 'processing'];" \
  "const CANCELLABLE_STATUSES = ['pending', 'confirmed', 'processing', 'shipped', 'delivered'];"

# Mutant 5: Permit return of non-delivered orders
run_mutation "$ORDER_SRC" "orders.return_policy_bypass" \
  "if (order.status.toLowerCase() !== 'delivered')" \
  "if (false && order.status.toLowerCase() !== 'delivered')"

# Mutant 6: Leak other customers' orders in order list
run_mutation "$ORDER_SRC" "orders.order_list_leak" \
  ".where('user_id', '=', user.id);" \
  "; // leaked all customer orders"

echo ""
echo "Mutation Gate Summary:"
echo "  Caught:       $PASSED"
echo "  Survived:     $SURVIVED"
echo "  Inconclusive: $FAILED_MUTANT"

if [ "$SURVIVED" -gt 0 ] || [ "$FAILED_MUTANT" -gt 0 ]; then
  exit 1
fi

exit 0
