# Jira: authentication, sprints, and transitions

How this project talks to Jira, and the specific calls used to create sprints
and move cards.

## Read the provenance labels

This document mixes things I verified with things I am taking on trust, and
collapsing the two would be worse than useless. Every claim is marked:

| Mark                 | Meaning                                                                       |
| -------------------- | ----------------------------------------------------------------------------- |
| ✅ **VERIFIED**      | I ran this on 2026-10-19 and it returned this                                 |
| 📋 **RECORDED**      | From the earlier session that created the sprints. Not re-run here            |
| ⚠️ **RECONSTRUCTED** | Standard Jira REST, written from documentation. **Not executed in this repo** |

The honest headline: **I did not create any sprint in the session that produced
this file.** Sprints 5 and 6 were created before a context checkpoint, and the
exact `curl` used is not in my current context. Rather than reconstruct a
command and present it as history, the reconstruction is labelled as such.

---

## The two ways in

### ✅ The path in use now — the Atlassian MCP server

No credential is handled by me at all. OAuth happens in the harness, and the
first call in any session resolves the site:

```js
// Code Mode, inside this session
const r = await tools['atlassian'].getAccessibleAtlassianResources();
```

✅ Returns:

```
cloudId  38635099-1a5d-498d-9449-0d6a4a02063c
url      https://sathiyaseelank326.atlassian.net
products jira (read-write), confluence (read-write), ...
```

**Cache that `cloudId`.** Every other call requires it explicitly as a
top-level argument; it is never silently auto-resolved.

✅ Identity:

```js
await tools['atlassian'].atlassianUserInfo();
// accountId  712020:9023eaaf-d344-406f-8d7d-bab0b503f41f
```

### 📋 The path used earlier — raw REST with Basic auth

Recorded from the session that created Sprints 5 and 6:

> Jira: Basic auth with email+token. `Bearer` returns 401.

⚠️ Reconstructed shape:

```bash
curl -sS -u "$JIRA_EMAIL:$JIRA_API_TOKEN" \
  -H 'Accept: application/json' \
  https://sathiyaseelank326.atlassian.net/rest/agile/1.0/board/36/sprint
```

**Why `Bearer` fails here.** A Jira **API token** is not a personal access
token. Atlassian's API tokens are only accepted as the password half of HTTP
Basic auth, paired with the account email. Sending one as `Authorization:
Bearer …` returns `401`, because that header is interpreted as an OAuth 2.0
access token and the API token is not one.

📋 The credential lived in the environment, never in a committed file, and is
not in this repository.

---

## The board

✅ Board **36**, `ZYV board`, type **`simple`**.

That word matters. `simple` is Jira's team-managed project type, and it changes
the API surface:

|                  | Team-managed (`simple`) | Company-managed        |
| ---------------- | ----------------------- | ---------------------- |
| Workflow         | Fixed, 4 statuses       | Per-project, arbitrary |
| Sprint endpoints | **Agile API**           | Core REST works too    |
| Issue search     | No JQL                  | Full JQL               |

Because board 36 is team-managed, **sprints do not exist in core REST at all.**
`POST /rest/api/3/sprint` does not exist. Sprints are an Agile concept and live
only under `/rest/agile/1.0/`.

---

## Creating a sprint

⚠️ **RECONSTRUCTED — not executed in this repo.** This is the endpoint Jira
documents for a team-managed board, and it is what the recorded outcome is
consistent with, but I did not run it.

```bash
curl -sS -X POST \
  -u "$JIRA_EMAIL:$JIRA_API_TOKEN" \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -d '{
        "name":        "ZYV Sprint 6",
        "originBoardId": 36,
        "startDate":   "2026-12-21",
        "endDate":     "2027-01-03"
      }' \
  https://sathiyaseelank326.atlassian.net/rest/agile/1.0/sprint
```

`originBoardId` is required. Omit it and the sprint is created unattached,
which then does not appear on board 36.

Via MCP today, the equivalent would be an `executeWrite` against the sprint
operation. ⚠️ I could not confirm the operation name: `discover` stopped
returning results partway through this session, and I will not guess an
operation name and call it — the instructions are explicit that a name must come
from `discover`, never from inference.

### ✅ Evidence that sprints were made programmatically

Listing board 36 today:

```
id   name            state    start                    end
2    ZYV Sprint 1    active   2026-10-11T09:00:00.000Z 2026-10-25T09:00:00.000Z
3    ZYV Sprint 2    active   2026-10-26T09:00:00.000Z 2026-11-08T09:00:00.000Z
4    ZYV Sprint 3    active   2026-11-09T09:00:00.000Z 2026-11-22T09:00:00.000Z
5    ZYV Sprint 4    future   2026-11-23T00:00:00.000Z 2026-12-06T00:00:00.000Z
38   ZYV Sprint 5    future   2026-12-07T00:00:00.000Z 2026-12-20T00:00:00.000Z
39   ZYV Sprint 6    future   2026-12-21T00:00:00.000Z 2027-01-03T00:00:00.000Z
```

Two things to notice.

**The id jump from 5 to 38.** Sprints 1–4 took ids 2–5. Sprint 5 got 38. That
gap is what creating through the API looks like: the id sequence advanced well
past the last sprint while the board was otherwise untouched. A sprint created
in the UI is the next integer.

**The start-time fingerprint.** Sprints 1–3 start at `09:00:00.000Z`; Sprints
4, 5 and 6 all start at exactly `00:00:00.000Z`. Midnight is what you get when a
date-only value is sent to the API and the time component is left to default.
09:00 is a real local time, which is what a human picking dates in the UI
produces. So the split is consistent with: **1–3 created in the UI, 4–6 created
programmatically.**

This is an observation drawn from the data, not a verified account of what
happened. It is consistent with the recorded provenance and nothing more.

### ✅ Sprint 1–3 are still `active`

They are `2026-10-11`, `2026-10-26` and `2026-11-09` starts, and their end dates
have all passed or are passing. They were never closed, which is why roughly 19
cards look "stuck". ⚠️ **Unfixed** — the recorded state is three `active`
sprints sitting behind the active one.

---

## Moving a card — always discover, never assume

📋 The rule learned the hard way: **transitions differ per source status.** The
same target is not reachable by the same id from everywhere, and a transition's
**name** is not the **status it leads to**. `transitionJiraIssue` takes a
transition id, not a status name.

### ✅ Verified on 2026-10-19

Reading what is actually available, from **To Do**:

```js
await tools['atlassian'].executeRead({
  name: 'listJiraIssueTransitions',
  cloudId: '38635099-1a5d-498d-9449-0d6a4a02063c',
  inputs: { issueIdOrKey: 'ZYV-105' },
});
```

```
id 2   "Start progress"  → In Progress   (indeterminate)
```

**That is the only option.** There is no direct To Do → In Review. Moving
ZYV-105 and ZYV-106 to In Review took two hops:

```
To Do ── id 2 ──▶ In Progress ── id 3 ──▶ In Review
```

From **In Progress** the available moves are:

```
id 3    "Submit for Review"  → In Review
id 10   "Pull Back"          → To Do
```

So the full walk used:

```js
// hop 1
await tools['atlassian']['transitionJiraIssue']({
  cloudId,
  issueIdOrKey: 'ZYV-105',
  transitionId: '2',
}); // → statusName: "In Progress"

// re-discover: the option list is different now
// hop 2
await tools['atlassian']['transitionJiraIssue']({
  cloudId,
  issueIdOrKey: 'ZYV-105',
  transitionId: '3',
}); // → statusName: "In Review"
```

✅ Both ZYV-105 and ZYV-106 confirmed at `In Review`, status id `10056`, read
back from the issue rather than taken from the transition's own success message.

⚠️ **Note that "In Review" has statusCategory `new`** in this workflow. That is
counter-intuitive — it sits in the same category as To Do — and it means a
category-based query will not separate the two. Filter on status name or id.

---

## The trap that costs an hour

📋 `listJiraIssueTransitions` needs **both** `cloudId` and a real issue key.

- A bare `ZYV-105` is fine.
- A numeric id alone is **not** — pass `PROJ-123`, never just `123`.

✅ Two other failures worth not repeating:

- `getGraphObject` with an ARI like
  `ari:cloud:jira::issue/ZYV-105` returned an **empty array** — no error, just
  nothing. A full browse URL works:
  `https://sathiyaseelank326.atlassian.net/browse/ZYV-105`.
- `getGraphObject` returns `data.data.objects`, and the issue body is under
  `.raw`. Reading `result.data` directly yields nothing.

---

## Card conventions on this project

📋 The status ladder, and what each one actually means here:

| Status        | Means                                                         |
| ------------- | ------------------------------------------------------------- |
| To Do         | Not started                                                   |
| In Progress   | Being worked on                                               |
| **In Review** | Implemented and self-verified. **Where finished work lands.** |
| Done          | Independently reviewed and accepted                           |

Cards land at **In Review**, not Done, because no independent review exists.
Developer, reviewer and tester roles were all self-performed on every epic, so
the evidence attached to a card is `observed`, never independently `verified`.
Marking that Done would assert a review that did not happen.

📋 Authoritative mappings live outside the repo, in `~/Desktop/zyv/`:
`JIRA_MAP.md`, `STORIES.md`, `TASKS.md`, `SUBTASKS.md`,
`REPARENT_PROMPT.md` (75 mis-parented E8–E14 stories).

📋 Board id `36`. Sprint 6 is `id=39`. Sprint 4 `id=5`, Sprint 5 `id=38`.
