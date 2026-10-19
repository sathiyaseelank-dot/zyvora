#!/usr/bin/env bash
# Mutation gate for the admin security and API surface (E10: ZYV-84, ZYV-94, ZYV-85, etc.).
#
# Asserts that security regressions (role check bypass, 403 removal, transition guard deletion)
# are caught by the test suite rather than passing silently.
set -uo pipefail
cd "$(dirname "$0")/.."
export PGHOST=/tmp
export DATABASE_URL="postgresql://$(whoami)@/zyvora?host=/tmp" NODE_ENV=test
export JWT_SECRET=ci-secret-not-used-for-production-min-32-chars
export COOKIE_SECRET=ci-cookie-secret-not-used-in-production-32-chars

RBAC_SRC=src/http/rbac.ts
APP_SRC=src/app.ts
ADMIN_SRC=src/routes/admin.ts

RBAC_BACKUP=$(mktemp)
APP_BACKUP=$(mktemp)
ADMIN_BACKUP=$(mktemp)

cp "$RBAC_SRC" "$RBAC_BACKUP"
cp "$APP_SRC" "$APP_BACKUP"
cp "$ADMIN_SRC" "$ADMIN_BACKUP"

restore() {
  cp "$RBAC_BACKUP" "$RBAC_SRC"
  cp "$APP_BACKUP" "$APP_SRC"
  cp "$ADMIN_BACKUP" "$ADMIN_SRC"
  rm -f "$RBAC_BACKUP" "$APP_BACKUP" "$ADMIN_BACKUP"
}
trap restore EXIT

PASSED=0
SURVIVED=0
FAILED_MUTANT=0

# run_mutation <file> <label> <from> <to>
run_mutation() {
  local target_file="$1" label="$2" from="$3" to="$4"
  
  # Always restore to clean baseline first
  cp "$RBAC_BACKUP" "$RBAC_SRC"
  cp "$APP_BACKUP" "$APP_SRC"
  cp "$ADMIN_BACKUP" "$ADMIN_SRC"

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
  if timeout 120 node --import tsx --test test/admin.test.ts >/tmp/zyvora-mutations/admin-mut.log 2>&1; then
    echo "  SURVIVED     $label"
    SURVIVED=$((SURVIVED + 1))
  else
    local ran failed
    ran=$(grep -oE '^. (tests) [0-9]+' /tmp/zyvora-mutations/admin-mut.log | tail -1 | grep -oE '[0-9]+' | head -1)
    failed=$(grep -cE '^[ ]*✖' /tmp/zyvora-mutations/admin-mut.log)

    if [ -z "${ran:-}" ] || [ "$ran" -eq 0 ]; then
      echo "  BROKE-BUILD  $label (no tests executed - not a valid catch)"
      FAILED_MUTANT=$((FAILED_MUTANT + 1))
    else
      echo "  caught ($failed)  $label"
      PASSED=$((PASSED + 1))
    fi
  fi
}

echo "=== mutation gate: admin security surface (E10: ZYV-84, ZYV-94, ZYV-85) ==="

# 1. Flip admin role check (ZYV-84)
run_mutation "$RBAC_SRC" "security: flip role check logic (!roles.includes -> roles.includes)" \
  "if (!roles.includes(user.role)) {" \
  "if (roles.includes(user.role)) {"

# 2. Remove 403 path (ZYV-94)
run_mutation "$RBAC_SRC" "security: remove 403 FORBIDDEN rejection path entirely" \
  "if (!roles.includes(user.role)) {
      next(
        new AppError(
          'FORBIDDEN',
          'You do not have permission to perform this action',
        ),
      );
      return;
    }" \
  "// 403 bypassed"

# 3. Change required role from admin to customer
run_mutation "$RBAC_SRC" "security: requireAdmin downgraded to requireRole('customer')" \
  "export const requireAdmin: RequestHandler = requireRole('admin');" \
  "export const requireAdmin: RequestHandler = requireRole('customer');"

# 4. Remove requireAdmin from admin mount in app.ts
run_mutation "$APP_SRC" "security: remove requireAdmin middleware from /api/admin mount" \
  "    requireAuth(),
    requireAdmin," \
  "    requireAuth(),"

# 5. Disable order status transition state machine validation (ZYV-85)
run_mutation "$ADMIN_SRC" "orders: remove valid order status transition enforcement" \
  "if (!allowed.includes(targetStatus)) {" \
  "if (false && !allowed.includes(targetStatus)) {"

# 6. Leak password hash in customers API (ZYV-86)
run_mutation "$ADMIN_SRC" "customers: leak password_hash in admin customer listing" \
  "'users.full_name as fullName'," \
  "'users.full_name as fullName', 'users.password_hash',"

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
