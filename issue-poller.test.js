'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateIssue, fetchTasks } = require('./issue-poller');
const good = () => ({ number: 2, state: 'open', user: { login: 'theXresearch' },
 labels: [{ name: 'nova-approved' }],
 body: 'NOVA_TASK_V1\ntask_id: inspect-readme\nsummary: Inspect README only' });
test('accepts only tightly structured owner approved issues', () => {
 assert.deepEqual(validateIssue(good()), { issue: 2, taskId: 'inspect-readme', summary: 'Inspect README only' });
 for (const change of [
  { user: { login: 'attacker' } }, { state: 'closed' }, { labels: [] },
  { pull_request: {} }, { body: 'NOVA_TASK_V1\ntask_id: x\nsummary: run; rm -rf /' },
  { body: 'NOVA_TASK_V1\ntask_id: x\nsummary: safe\ncommand: whoami' },
 ]) assert.equal(validateIssue({ ...good(), ...change }), null);
});
test('fetches and filters without executing or writing', async () => {
 let requested = false;
 const tasks = await fetchTasks({ token: 'dummy-test-token', fetchImpl: async (url, options) => {
   requested = true;
   assert.match(url, /^https:\/\/api\.github\.com\/repos\/theXresearch\/galaxy-fold8-local-ai\/issues\?/);
   assert.equal(options.method, 'GET');
   return { ok: true, json: async () => [good(), { ...good(), number: 3, user: { login: 'other' } }] };
 } });
 assert.equal(requested, true);
 assert.equal(tasks.length, 1);
});
test('fails closed on missing token, API errors and malformed data', async () => {
 await assert.rejects(fetchTasks(), /token required/);
 await assert.rejects(fetchTasks({ token: 'test', fetchImpl: async () => ({ ok: false, status: 403 }) }), /403/);
 await assert.rejects(fetchTasks({ token: 'test', fetchImpl: async () => ({ ok: true, json: async () => ({}) }) }), /Unexpected/);
});
