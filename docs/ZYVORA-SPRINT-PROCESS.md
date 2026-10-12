# ZYVORA — Sprint & Delivery Process

**Written:** 2026-10-12
**Purpose:** Reference for all agents working the ZYVORA project. Everything
below is what was actually done and observed — not an aspiration. Commands are
copy-pasteable and were run as written.

---

## 1. Where things live

| What | Path |
|---|---|
| **Implementation (canonical)** | `~/Desktop/zyv/zyvora` |
| Git remote | `https://github.com/sathiyaseelank-dot/zyvora` (public) |
| **Governance & handover** | `~/Desktop/zyv/hermes-sprint-1/` |
| Planning artifacts | `~/Desktop/zyv/` (`STORIES.md`, `TASKS.md`, `SUBTASKS.md`, `work_queue.json`, `JIRA_MAP.md`) |
| **Superseded** | `~/Downloads/zyvora-e-commerce-website-development/` — Next.js scaffold, **not** carried forward |
| Jira CLI helper | `~/.hermes/scripts/jira_sprint.py` |
| Jira credentials | `~/.hermes/.env` → `ATLASSIAN_API_TOKEN`, `ATLASSIAN_EMAIL`, `ATLASSIAN_CLOUD_ID` |

**Do not edit the Downloads tree.** It was a Next.js App Router app; Option A
rejected Next.js. Its product copy was recovered into the React storefront, the
code was not.

---

## 2. Architecture — ADR-002 was resolved

`governance/ADR-002-STACK-CONFLICT.md` was **OPEN, blocking all of E1**. The
human chose **Option A** on 2026-10-12:

> **Option A — React + Express + PostgreSQL.** Two separate deployables,
> exactly as `requirements.md` §3 specifies. Next.js was **not** adopted.

Consequences now settled:

- ZYV-15 (Express backend) is valid as written
- The ~20 API stories built on the Express assumption stand unchanged
- `JIRA_MAP.md` and the 1300-issue breakdown need no rework
- E1 Foundation is unblocked

**Still open (deliberately not decided by the implementer):**
- ID type contract (ZYV-20) — Architect
- Seed image accuracy (ZYV-40) — Product Owner

---

## 3. Jira access

The **Atlassian MCP server is connected and working** — 20 tools registered,
including `getJiraIssue`, `searchJiraIssuesUsingJql`, `transitionJiraIssue`,
`addOrEditJiraIssueComment`. It covers core Jira (issues, JQL, transitions).

It does **NOT** cover Jira Agile. Verified by querying the server's own
319-operation catalog: `sprint`, `epic`, `board`, `backlog` all return **0
matches**. Sprint work therefore goes through the REST Agile API via
`jira_sprint.py`.

### 3.1 Boards

| ID | Name | Project | Sprints |
|---|---|---|---|
| 1 | KAN board | My Team | ❌ rejects sprints (Kanban) |
| 35 | HERMES board | Hermes Bots | ✅ HERMES Sprint 1 (active) |
| **36** | **ZYV board** | **zyvora** | ✅ **ZYV Sprint 1 (active)** — use this one |

### 3.2 `jira_sprint.py`

```bash
S=~/.hermes/scripts/jira_sprint.py

$S boards                        # list boards, find the board ID
$S sprints --board 36            # list sprints on a board
$S sprints --board 36 --state closed

# create
$S create --board 36 --name "ZYV Sprint 2" \
   --start 2026-10-26 --end 2026-11-08 --goal "…"

# update (rename / schedule / start / close)
$S update --sprint 2 --name "ZYV Sprint 1" \
   --start 2026-10-11 --end 2026-10-25 --state active --goal "…"

# add issues to a sprint  (NOT in the script — use the API, see 3.4)
```

Money/dates are normalised for you: `--start 2026-10-11` becomes
`2026-10-11T09:00:00.000+0000`. Reads credentials from the environment, falling
back to `~/.hermes/.env`. Never prints the token.

### 3.3 Raw API (for anything the script lacks)

```bash
cd ~/.hermes
TOK=$(grep -m1 '^ATLASSIAN_API_TOKEN=' .env | cut -d= -f2-)
EM=$(grep -m1 '^ATLASSIAN_EMAIL=' .env | cut -d= -f2-)
CID=$(grep -m1 '^ATLASSIAN_CLOUD_ID=' .env | cut -d= -f2-)
```

Base URLs:
- Agile: `https://api.atlassian.com/ex/jira/$CID/rest/agile/1.0/…`
- Core:  `https://api.atlassian.com/ex/jira/$CID/rest/api/3/…`

| Task | Call |
|---|---|
| Sprint detail | `GET /rest/agile/1.0/sprint/{id}` |
| Sprint issues | `GET /rest/agile/1.0/sprint/{id}/issue?maxResults=100` |
| **Add issues to sprint** | `POST /rest/agile/1.0/sprint/{id}/issue` body `{"issues":["ZYV-1",…]}` → `204` |
| Remove issue | `POST /rest/agile/1.0/sprint/{id}/issue` body `{"issues":["KEY"],"rank":…}` or set sprint to 0 |
| Transitions | `GET/POST /rest/api/3/issue/{key}/transitions` |
| JQL search | `GET /rest/api/3/search/jql?jql=…` |

> ⚠️ **`/rest/api/3/search` returns HTTP 410 (Gone).** Use `/search/jql`.

---

## 4. How ZYV Sprint 1 was actually created

Recorded because the naive approach is wrong here.

1. **Checked first.** `sprints --board 36` showed **`ZYV Sprint 1` already
   existed — id 2, state `future`, with no start or end dates.**
2. **Did not create a duplicate.** Creating another sprint would have left two
   "Sprint 1"s on one board.
3. **Scheduled the existing sprint** to match the already-active
   `HERMES Sprint 1` window (2026-10-11 → 2026-10-25), because the E1/E2 work
   was done on 2026-10-12 and belongs to that period.
4. **Added `--start` to `jira_sprint.py`** — the update path supported
   `--name/--goal/--state/--end` but not `--start`, so dates could not be set.
5. **Activated it** (`--state active`) and set a goal.
6. **The sprint was empty** (`total: 0`), which makes it useless for tracking,
   so the E1/E2 scope was loaded in: the 2 epics + 13 stories = **15 issues**.

Result:

```
state     active
name      ZYV Sprint 1
start 2026-10-11T09:00:00Z
end       2026-10-25T09:00:00Z
goal      E1 Foundation and E2 Database complete and verified …
15 issues — In Review 8, In Test 7, Done 0
```

**Lesson for agents: list before you create.** Sprints are cheap to make and
expensive to duplicate.

---

## 5. Governance boundaries — read before touching Jira

From `governance/references/workflow-and-gates.md` and
`handover/JIRA-AUTHORITY-ADDENDUM.md`.

### 5.1 Workflow

```
To Do → In Progress → In Review → In Test → Verified → Done
```

One step at a time; no skipping.

| Move to | Owner | Transition |
|---|---|---|
| In Progress | scrum-master | `Start progress` |
| In Review | **developer** | `Submit for Review` |
| In Test | reviewer | `Send to Test` |
| Verified | tester | `Verify Pass` |
| Done | scrum-master | `Complete Work` |

Backward: `Reject Review`, `Test Defects`, `Verification Fails`, `Stop Progress`.

**Available transitions differ per issue.** Query them; do not hardcode:
```
GET /rest/api/3/issue/{key}/transitions
  To Do     -> "Start progress"                (id 2)  [only option]
  In Review -> "Send to Test" (4), "Changes Requested" (7)
  In Test   -> "Verify Pass" (5), "Verification Failed" (8)
```

### 5.2 What an agent producing code may do

- ✅ Post comments with **attributed, real evidence** — actual command output
- ✅ Move its own card `To Do → In Progress → In Review`
- ❌ **Never** move a card past its own gate. Developer owns In Review only.
- ❌ **Never** edit another role's summary / description / acceptance criteria
- ❌ **Never** comment to manufacture agreement for a gate you did not run
- ❌ **Never** claim a Jira call succeeded if it failed — report the failure

A producer can never satisfy its own gate. The implementer deliberately stopped
at **In Review** on ZYV-30/33/37/41 and left everything at In Test/In Review
for a reviewer and tester who did not write the code.

### 5.3 Evidence standard

`claimed` is not `observed`. Comment with real command output, attributed
(`ZYV-21:developer`). Record a gate as **unverified** rather than quietly
omitting it.

---

## 6. Repository state

`~/Desktop/zyv/zyvora` — npm workspaces, **not pnpm**.

```
apps/web     React 19 + Vite 5→8 + Tailwind 4 storefront   (port 5173)
apps/api     Express 4 + Kysely 0.29 + Zod + PostgreSQL    (port 4000)
packages/types   shared API contracts
packages/ui      brand-agnostic primitives
packages/config  shared tsconfig/tailwind/eslint/prettier
```

### 6.1 Commands

```bash
cd ~/Desktop/zyv/zyvora
npm install
npm run dev          # web + api together
npm run typecheck    # types → ui → api → web
npm run lint
npm run format       # prettier --write
npm run format:check
npm run build        # api (tsc) then web (tsc && vite build)
npm run migrate      # apply pending migrations
npm run seed         # idempotent — no-op if products exist
```

Individual workspace: `npm run <script> -w @zyvora/api`

### 6.2 Current gates — all PASS

```
typecheck     PASS
lint          PASS
format:check  PASS
build         PASS
npm audit     0 vulnerabilities
```

### 6.3 Gotchas that cost time — do not repeat

- **`pnpm` was removed.** It produced a broken hybrid `node_modules` (npm flat
  layout overlaid by pnpm) where `pnpm lint` died with
  `Cannot find module 'semver'`. That was defect D3 in disguise. If `lint`
  fails on a missing module, suspect a mixed install before anything else.
- **`workspace:*` is pnpm syntax.** npm cannot parse it; use `"*"`.
- **Vite must be a single version.** `@tailwindcss/vite` hoists to the root and
  its auto-installed peer will resolve a *different* vite than the app uses.
  `vite` is pinned in root `devDependencies` and `overrides` for this reason.
- **Kysely 0.29 moved the migration API.** `Migrator` / `FileMigrationProvider`
  now import from `kysely/migration`, not `kysely`.
- **ESLint globals come from the `globals` package**, not a hand-written list.
  A hand list silently omitted `AbortSignal`, `AbortController`,
  `URLSearchParams`, `Response` and produced spurious `no-undef`.
- **CORS:** Vite serves on `127.0.0.1`, developers open `localhost`. They are
  **different origins**. Both must be in `CORS_ORIGINS` or the browser blocks
  every API call.

---

## 7. Database

```bash
# start (after a reboot the service is stopped)
sudo systemctl start postgresql

psql -U postgres -h localhost -d zyvora -c '\dt'
```

Connection: `postgresql://postgres:postgres@localhost:5432/zyvora` (matches
`.env` and `.env.example`).

**17 tables.** Migration `001` created only the **5 catalog** tables; migration
`002_commerce_orders_engagement.ts` added the missing **12** (commerce, orders
and payments, engagement, audit). The Kysely `Database` interface in
`apps/api/src/db/client.ts` is the source of truth for what must exist — check
it against `information_schema` when in doubt.

Rebuild from scratch (fastest way to prove the whole chain):
```bash
psql -U postgres -h localhost -d postgres -c "DROP DATABASE IF EXISTS zyvora"
psql -U postgres -h localhost -d postgres -c "CREATE DATABASE zyvora"
npm run migrate && npm run seed
```

The seed is **idempotent** by explicit guard. An earlier version used
`onConflict(doNothing)` while inserting a fresh random UUID per row — which can
never conflict, so every re-run silently duplicated the catalogue.

---

## 8. API surface (implemented)

Public, unauthenticated:

| Story | Endpoint |
|---|---|
| ZYV-30 | `GET /api/categories` |
| ZYV-37 | `GET /api/products?category=&sort=price_asc\|desc&name_asc\|desc&page=&pageSize=` |
| ZYV-33 | `GET /api/products/:id` (uuid-validated, joins inventory) |
| ZYV-41 | `GET /api/products/search?q=` |
| — | `GET /health` |

Responses are `{ data, meta }`; errors are `{ error: { code, message } }`.
Money is **integer rupees** end to end — `₹1,999` is formatted only at the edge.

Verify:
```bash
curl -s localhost:4000/api/products?sort=price_asc&pageSize=3
curl -s 'localhost:4000/api/products?category=bike-flags'
curl -s -o/dev/null -w '%{http_code}\n' 'localhost:4000/api/products?category=nope'   # 400
curl -s -o/dev/null -w '%{http_code}\n'  localhost:4000/api/products/12345             # 400
curl -s -o/dev/null -w '%{http_code}\n'  localhost:4000/api/products/0000...-0000      # 404
```

---

## 9. Known defects — do not rediscover these

| Where | Problem |
|---|---|
| **Seed images (ZYV-40)** | Image URLs are invented Unsplash stock IDs that **do not depict the products** — cats for "Premium Car Flag", a Porsche for "Magnetic Mount Kit", hikers for "Telescopic Pole". 3 of 8 are additionally browser-blocked (ORB). Product imagery is a PO decision; local storage is ZYV-38. |
| **ID type (ZYV-20)** | `@zyvora/types` drafted `Product.id: number`; migrations create `uuid`. Resolved toward the DB (`ProductId = string`) with the deviation recorded in source. **Architect owns this.** |
| **No CI** | Nothing runs the four gates on push. They pass locally and would regress silently. |
| **Not a git repo** (governance tree) | `~/Desktop/zyv/` and `hermes-sprint-1/` are not version controlled. `~/Desktop/zyv/zyvora` is. |
| **`pg_hba.conf` is `trust`** | `postgres:postgres` authenticates anyone who can reach the port. Fine for dev, not for a shared host. |
| **braces advisory** | `braces <=3.0.3` (high, DoS) has **no upstream fix**. Removed `kysely-codegen` to clear it. Any future dep pulling `micromatch` reintroduces it — re-run `npm audit` periodically. |

---

## 10. Where the ZYV board stands

```
ZYV Sprint 1 (id 2, board 36) — active, 2026-10-11 → 2026-10-25
  15 issues: In Review 8, In Test 7, Done 0
```

Remaining: 81 issues in `To Do` (E3–E14).

The four catalog stories built during the vertical slice — **ZYV-30, ZYV-33,
ZYV-37, ZYV-41** — are In Review but deliberately **not** in Sprint 1; they are
E3 work. Move them in, or open a Sprint 2 for E3.

**Sprint 1 cannot close yet.** Nothing is Done. The remaining moves need a
reviewer and a tester who did not write the code.