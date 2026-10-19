#!/usr/bin/env node
import fs from 'node:fs';

function loadEnv() {
  const envPath = process.env.ENV_FILE || '/home/inkyank-08/.hermes/.env';
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

loadEnv();

const ATLASSIAN_EMAIL = process.env.ATLASSIAN_EMAIL;
const ATLASSIAN_API_TOKEN = process.env.ATLASSIAN_API_TOKEN;
const JIRA_SITE = (process.env.JIRA_SITE || 'https://sathiyaseelank326.atlassian.net').replace(/\/+$/, '');
const authHeader = `Basic ${Buffer.from(`${ATLASSIAN_EMAIL}:${ATLASSIAN_API_TOKEN}`).toString('base64')}`;

async function jiraFetch(endpoint, options = {}) {
  const url = endpoint.startsWith('http') ? endpoint : `${JIRA_SITE}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: authHeader,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (response.status === 204) return { success: true, status: 204 };
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const WORKFLOW = ['To Do', 'In Progress', 'In Review', 'In Test', 'Verified', 'Done'];

async function getTransitions(issueKey) {
  const data = await jiraFetch(`/rest/api/3/issue/${issueKey}/transitions`);
  return data.transitions || [];
}

async function transitionIssue(issueKey, targetStatus) {
  for (let step = 0; step < 10; step++) {
    const transitions = await getTransitions(issueKey);
    const direct = transitions.find(t => t.to?.name?.toLowerCase() === targetStatus.toLowerCase());
    if (direct) {
      await jiraFetch(`/rest/api/3/issue/${issueKey}/transitions`, {
        method: 'POST',
        body: JSON.stringify({ transition: { id: direct.id } }),
      });
      console.log(`Successfully transitioned ${issueKey} -> ${targetStatus}`);
      return;
    }

    const issue = await jiraFetch(`/rest/api/3/issue/${issueKey}?fields=status`);
    const currentName = issue.fields?.status?.name;
    if (currentName?.toLowerCase() === targetStatus.toLowerCase()) {
      console.log(`${issueKey} is already at ${targetStatus}`);
      return;
    }

    const curIdx = WORKFLOW.findIndex(s => s.toLowerCase() === currentName?.toLowerCase());
    const tgtIdx = WORKFLOW.findIndex(s => s.toLowerCase() === targetStatus.toLowerCase());

    if (curIdx === -1 || tgtIdx === -1) {
      throw new Error(`Unrecognized status ${currentName} or ${targetStatus}`);
    }

    const nextIdx = curIdx < tgtIdx ? curIdx + 1 : curIdx - 1;
    const nextStatus = WORKFLOW[nextIdx];
    const nextTransition = transitions.find(t => t.to?.name?.toLowerCase() === nextStatus.toLowerCase());

    if (!nextTransition) {
      throw new Error(`Cannot transition ${issueKey} from ${currentName} to ${nextStatus}. Available: ${transitions.map(t => t.to.name).join(', ')}`);
    }

    console.log(`Stepping ${issueKey} from ${currentName} -> ${nextStatus}`);
    await jiraFetch(`/rest/api/3/issue/${issueKey}/transitions`, {
      method: 'POST',
      body: JSON.stringify({ transition: { id: nextTransition.id } }),
    });
  }
}

const [action, ...args] = process.argv.slice(2);

if (action === 'transition') {
  const [key, target] = args;
  await transitionIssue(key, target);
} else if (action === 'status') {
  const [key] = args;
  const res = await jiraFetch(`/rest/api/3/issue/${key}?fields=summary,status`);
  console.log(`${res.key}: ${res.fields?.status?.name} — ${res.fields?.summary}`);
} else {
  console.log('Usage: node scripts/jira.mjs transition <key> <targetStatus>');
}
