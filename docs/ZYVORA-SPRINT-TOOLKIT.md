# ZYVORA — Sprint Creation Toolkit & Command Flow

**Written:** 2026-10-12
**What this is:** the exact tools and command sequence used to create and
schedule Jira sprints, plus what failed and what to do instead. Every command
below was actually run.

---

## 1. The tools — and when each one applies

Three different tools were used. Picking the wrong one is the main trap.

| Tool | Covers | Used for |
|---|---|---|
| **Atlassian MCP server** | Core Jira: issues, JQL, comments, transitions | Reading issues, commenting evidence, `transitionJiraIssue` |
| **`jira_sprint.py`** | Agile: boards, sprints, create/update | **All sprint operations** |
| **curl + REST Agile API** | Everything else | Adding issues to a sprint (no script support) |

### 1.1 Why sprints could NOT use the MCP server

The MCP server is connected and healthy — 20 tools registered. It wraps
**core Jira REST**, which has no concept of a sprint.

Proven by querying the server's own 319-operation catalog:

```
query "sprint"  -> 0 matches
query "epic"    -> 0 matches
query "board"   -> 0 matches
query "backlog" -> 0 matches
query "create a jira issue" -> 1 match   (control: search works)
```

The whole Jira **Agile** family is absent. Sprints live in `/rest/agile/1.0/`.
So sprint work goes through the REST API.

### 1.2 What the MCP server IS good for

```
getJiraIssue · searchJiraIssuesUsingJql · transitionJiraIssue
addOrEditJiraIssueComment · getAccessibleAtlassianResources
```

```bash
# read a card
curl -s -u "$EM:$TOK" -H 'Accept: application/json' \
  "https://api.atlassian.com/ex/jira/$CID/rest/api/3/issue/ZYV-21?fields=status,summary"
```

---

## 2. Credentials

```bash
cd ~/.hermes
TOK=$(grep -m1 '^ATLASSIAN_API_TOKEN=' .env | cut -d= -f2-)
EM=$(grep -m1 '^ATLASSIAN_EMAIL=' .env | cut -d= -f2-)
CID=$(grep -m1 '^ATLASSIAN_CLOUD_ID=' .env | cut -d= -f2-)
```

```bash
CID=38635099-1a5d-498d-9449-0d6a4a02063c   # site cloud ID
BASE="https://api.atlassian.com/ex/jira/$CID"
```

> Basic auth = `base64(email:token)`. `jira_sprint.py` does this internally.

---

## 3. The script — `~/.hermes/scripts/jira_sprint.py`

Covers boards, listing, create, update. Stdlib only, no install needed.
Reads `~/.hermes/.env` automatically, never prints the token.

```bash
S=~/.hermes/scripts/jira_sprint.py
```

### 3.1 Its interface

```bash
$S boards [--project KEY]                    # find the board ID
$S sprints --board 36 [--state future|active|closed]
$S create --board 36 --name "ZYV Sprint 2" \
        [--start YYYY-MM-DD] [--end YYYY-MM-DD] [--goal TEXT]
$S update --sprint 2 [--name T] [--goal T] \
        [--state future|active|closed] [--start YYYY-MM-DD] [--end YYYY-MM-DD]
```

### 3.2 I had to add `--start`

The update path supported `--name/--goal/--state/--end` but **not** `--start`,
so a sprint's dates could not be set. Jira's
`POST /rest/agile/1.0/sprint/{id}` accepts `startDate`, so it was added to
`cmd_update` and the argparse block.

**If you extend the script, re-check `cmd_update` for the same gap.**

---

## 4. The command flow, exactly as run

### Step 1 — list boards, get the ID
```bash
$ jira_sprint.py boards
ID     NAME                                   TYPE      LOCATION
1      KAN board                              simple    My Team
35     HERMES board                           simple    Hermes Bots
36     ZYV board                              simple    zyvora
```

Board **36** is ZYVORA's.

### Step 2 — CHECK BEFORE CREATING
```bash
$ jira_sprint.py sprints --board 36
ID     STATE        NAME             START   END
2      future       ZYV Sprint 1     -       -
```

**A sprint named "ZYV Sprint 1" already existed** — id 2, `future`, no dates.

This is the step that matters. Creating here would have produced two "Sprint 1"
on one board.

Also checked board 35 and board 1:
```bash
$ jira_sprint.py sprints --board 35
1  active  HERMES Sprint 1  2026-10-11T11:15:45  2026-10-25T11:15:35

$ jira_sprint.py sprints --board 1
error: HTTP 400  ['The board does not support sprints']
```
Board 1 is Kanban — sprints are not a concept there. Expected, not an error.

### Step 3 — schedule + activate the existing sprint
```bash
$ jira_sprint.py update --sprint 2 \
    --name "ZYV Sprint 1" \
    --start 2026-10-11 --end 2026-10-25 \
    --state active \
    --goal "E1 Foundation and E2 Database complete and verified: Option A (React + Express + PostgreSQL) building on the four quality gates, with the catalog API and storefront rendering live data."
updated sprint 2: ZYV Sprint 1 (active)
```

Dates were aligned to the **active `HERMES Sprint 1`** window, because the
E1/E2 work was done 2026-10-12 and belongs to that same period.

### Step 4 — verify it took
```bash
$ jira_sprint.py sprints --board 36
2  active  ZYV Sprint 1  2026-10-11T09:00:00  2026-10-25T09:00:00

$ curl -s -u "$EM:$TOK" -H 'Accept: application/json' "$BASE/rest/agile/1.0/sprint/2"
  id            2
  state         active
  startDate     2026-10-11T09:00:00.000Z
  endDate       2026-10-25T09:00:00.000Z
  originBoardId 36
  goal          E1 Foundation and E2 Database complete and verified…
```

### Step 5 — the sprint was EMPTY
```bash
$ curl -s -u "$EM:$TOK" -H 'Accept: application/json' \
    "$BASE/rest/agile/1.0/sprint/2/issue?maxResults=100"
total: 0
```

An empty sprint cannot be used for tracking, so the scope was loaded.

### Step 6 — add issues to the sprint

**No script subcommand exists for this** — raw API:

```bash
$ curl -s -X POST -u "$EM:$TOK" \
    -H 'Accept: application/json' -H 'Content-Type: application/json' \
    -d '{"issues":["ZYV-1","ZYV-2","ZYV-15","ZYV-16","ZYV-17","ZYV-18",
                   "ZYV-19","ZYV-20","ZYV-21","ZYV-22","ZYV-23","ZYV-24",
                   "ZYV-25","ZYV-26","ZYV-27"]}' \
    "$BASE/rest/agile/1.0/sprint/2/issue"
http=204
```

`204 No Content` = success.

### Step 7 — verify contents
```bash
$ curl -s -u "$EM:$TOK" -H 'Accept: application/json' \
    "$BASE/rest/agile/1.0/sprint/2/issue?maxResults=100&fields=key,summary,status"
ZYV Sprint 1 contents — 15 issues

  ZYV-1    Epic   In Test     E1 — Project Foundation & Tooling
  ZYV-15   Story  In Test     Scaffold backend application (Node + Express +…
  ZYV-16   Story  In Test     Set up environment variables and .env.example
  ZYV-17   Story  In Test     Scaffold frontend application (React + TypeScr…
  ZYV-18   Story  In Review   Set up migration runner
  ZYV-19   Story  In Test     Inspect existing project directory and preserve
  ZYV-2    Epic   In Review   E2 — Database Schema & Migrations
  ZYV-20   Story  In Test     Create shared types and configuration package
  ZYV-21   Story  In Test     Configure lint, format and typecheck scripts
  ZYV-22   Story  In Review   Write database seed script with sample product
  ZYV-23   Story  In Review   Create commerce tables (inventory, carts, cart…
  ZYV-24   Story  In Review   Create order and payment tables (orders, order…
  ZYV-25   Story  In Review   Create catalog tables (users, roles, products,…
  ZYV-26   Story  In Review   Create engagement and audit tables (reviews, coup…
  ZYV-27   Story  In Review   Snapshot order item price data at purchase tim

by status: {'In Review': 8, 'In Test': 7}
```

---

## 5. Result

```
ZYV Sprint 1  (id 2, board 36, project zyvora)
  state  active
  dates  2026-10-11 → 2026-10-25
  goal   E1 Foundation and E2 Database complete and verified
  issues 15 — In Review 8, In Test 7, Done 0
```

---

## 6. Reusable playbook for the next sprint

```bash
S=~/.hermes/scripts/jira_sprint.py

# 1. board id
$S boards

# 2. does the sprint already exist?   <-- never skip
$S sprints --board 36

# 3a. does NOT exist -> create
$S create --board 36 --name "ZYV Sprint 2" \
   --start 2026-10-26 --end 2026-11-08 \
   --goal "E3 Backend API Core"

# 3b. EXISTS but undated -> schedule + activate
$S update --sprint <id> --start 2026-10-26 --end 2026-11-08 --state active

# 4. load scope (raw API — no script subcommand)
curl -s -X POST -u "$EM:$TOK" \
  -H 'Content-Type: application/json' \
  -d '{"issues":["ZYV-28","ZYV-29", …]}' \
  "$BASE/rest/agile/1.0/sprint/<id>/issue" -w '\nhttp=%{http_code}\n'

# 5. verify both, always
$S sprints --board 36
curl -s -u "$EM:$TOK" -H 'Accept: application/json' \
  "$BASE/rest/agile/1.0/sprint/<id>/issue?maxResults=100" | jq '.total'

# 6. move issues forward — ONLY arrows you own
curl -s -u "$EM:$TOK" -H 'Accept: application/json' \
  "$BASE/rest/api/3/issue/ZYV-30/transitions"
#   To Do -> "Start progress" (2)
curl -s -X POST -u "$EM:$TOK" -H 'Content-Type: application/json' \
  -d '{"transition":{"id":"2"}}' "$BASE/rest/api/3/issue/ZYV-30/transitions" -w '%{http_code}\n'
```

---

## 7. What failed, and the fix

| Failure | Fix |
|---|---|
| `Cannot find package 'semver'` in `mcp test` | Mixed npm+pnpm install produced a hybrid `node_modules`. Clean install fixed it. |
| `/rest/api/3/search` → **HTTP 410 Gone** | Use `/rest/api/3/search/jql` — the old path is retired. |
| `curl -X POST …/sprint/2/issue` → no script | No subcommand existed; raw API used instead. Worth adding to the script. |
| `update --start` unknown flag | `--start` was missing from `cmd_update`; added. |
| Board 1: `The board does not support sprints` | Kanban board — expected. Not an error. |
| Sprint already existed, undated | Scheduled and loaded it instead of creating a duplicate. |

---

## 8. The rule that matters most

> **List before you create.**

Sprints are cheap to create and expensive to duplicate. Two "Sprint 1"s on one
board is a mess nobody downstream will catch for you.

And when the sprint is already there, **an empty sprint is still useless** —
Step 5 caught that `total: 0` and the scope was loaded.

---

*Credential variable names only — no secret values in this file.*