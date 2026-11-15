'use strict';
// Dry-run only. This module never executes instructions or writes files.
const { setTimeout: delay } = require('node:timers/promises');
const API = 'https://api.github.com';
const REPO = 'theXresearch/galaxy-fold8-local-ai';
const OWNER = 'theXresearch';
const MARKER = 'NOVA_TASK_V1';
function validateIssue(issue) {
  if (!issue || typeof issue !== 'object' || issue.pull_request ||
      issue.state !== 'open' || issue.user?.login !== OWNER ||
      !Number.isSafeInteger(issue.number) || issue.number < 1 ||
      !Array.isArray(issue.labels) ||
      !issue.labels.some(x => x?.name === 'nova-approved')) return null;
  if (typeof issue.body !== 'string' || issue.body.length > 4096) return null;
  const lines = issue.body.replace(/\r/g, '').trim().split('\n');
  if (lines.length !== 3 || lines[0] !== MARKER) return null;
  const id = /^task_id: ([a-z0-9-]{1,64})$/.exec(lines[1]);
  const summary = /^summary: ([A-Za-z0-9 .,()_/-]{1,160})$/.exec(lines[2]);
  if (!id || !summary) return null;
  return Object.freeze({ issue: issue.number, taskId: id[1], summary: summary[1] });
}
async function fetchTasks({ token, fetchImpl = fetch, signal } = {}) {
  if (!token || typeof token !== 'string') throw Error('GitHub token required');
  const response = await fetchImpl(`${API}/repos/${REPO}/issues?state=open&per_page=30`, {
    method: 'GET', redirect: 'error', signal,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'nova-dry-run/0.1' },
  });
  if (!response.ok) throw Error(`GitHub request failed (${response.status})`);
  const issues = await response.json();
  if (!Array.isArray(issues)) throw Error('Unexpected GitHub response');
  return issues.map(validateIssue).filter(Boolean);
}
async function main() {
  const token = process.env.NOVA_GITHUB_TOKEN;
  if (!token) throw Error('Set NOVA_GITHUB_TOKEN in the environment (never paste into chat)');
  const controller = new AbortController();
  const timeout = delay(10000, null, { signal: controller.signal }).then(() => controller.abort());
  try {
    const tasks = await fetchTasks({ token, signal: controller.signal });
    for (const task of tasks) console.log(JSON.stringify({ mode: 'dry-run', ...task }));
    console.log(`Dry-run complete: ${tasks.length} validated task(s); 0 executed.`);
  } finally { controller.abort(); await timeout.catch(() => {}); }
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { validateIssue, fetchTasks };
