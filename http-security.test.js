'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { randomBytes } = require('node:crypto');
const { createServer } = require('./server');

async function start(t, options = {}) {
  const token = randomBytes(32).toString('hex');
  const server = createServer(__dirname, { token, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  assert.equal(server.address().address, '127.0.0.1');
  t.after(() => new Promise(resolve => server.close(resolve)));
  async function request(route, { authorized = false, headers = {}, method = 'GET', body } = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: server.address().port, path: route, method,
        headers: { ...(authorized ? { authorization: `Bearer ${token}` } : {}), ...headers } }, res => {
        let data = '';
        res.on('data', c => { data += c; });
        res.on('error', reject);
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data ? JSON.parse(data) : null }));
      });
      req.on('error', reject);
      req.end(body);
    });
  }
  return { request };
}
const ping = { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' } };

test('all data routes require authorization and never disclose data on failed auth', async t => {
  const { request } = await start(t);
  for (const route of ['/status', '/files', '/mcp']) {
    for (const headers of [{}, { authorization: 'Bearer wrong' }, { authorization: 'Basic wrong' }, { authorization: 'Bearer' }]) {
      const response = await request(route, { headers });
      assert.equal(response.status, 401);
      assert.deepEqual(response.body, { error: 'Unauthorized' });
      assert.equal(response.headers['www-authenticate'], 'Bearer');
      assert.equal(response.headers['cache-control'], 'no-store');
    }
    for (const method of ['POST', 'HEAD', 'OPTIONS']) {
      assert.equal((await request(route, { method })).status, 401);
    }
  }
  for (const route of ['/status?token=not-a-token', '/files/', '/%73tatus', '/mcp?token=invalid']) {
    assert.equal((await request(route)).status, 404); // No alternate path dispatch.
  }
  assert.deepEqual((await request('/health')).body, { status: 'ok' });
});

test('authorized REST and MCP requests succeed with the existing file policy', async t => {
  const { request } = await start(t);
  const status = await request('/status', { authorized: true });
  assert.equal(status.status, 200);
  assert.equal(status.body.project, 'NOVA Remote Development Bridge');
  assert.equal(status.headers['cache-control'], 'no-store');
  const files = await request('/files', { authorized: true });
  assert.equal(files.status, 200);
  assert.ok(files.body.includes('README.md'));
  assert.ok(!files.body.includes('http-security.test.js')); // Not implicitly allowlisted.
  const result = await request('/mcp', { ...ping, authorized: true });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.result, {});
});

test('missing or malformed configured tokens fail closed while public health stays minimal', async t => {
  for (const token of ['', 'short', 'x'.repeat(32) + '\n', 'x'.repeat(1025)]) {
    const { request } = await start(t, { token });
    for (const route of ['/status', '/files', '/mcp']) {
      const response = await request(route);
      assert.equal(response.status, 503);
      assert.deepEqual(response.body, { error: 'Authentication not configured' });
    }
    const health = await request('/health');
    assert.equal(health.status, 200);
    assert.deepEqual(health.body, { status: 'ok' });
  }
});

test('authorized quota is shared across REST and MCP and recovers at window boundary', async t => {
  let clock = 0;
  const { request } = await start(t, { rateLimit: { limit: 2, windowMs: 1000, now: () => clock } });
  assert.equal((await request('/status', { authorized: true })).status, 200);
  assert.equal((await request('/mcp', { ...ping, authorized: true })).status, 200);
  for (const route of ['/status', '/files', '/mcp']) {
    const response = await request(route, { authorized: true, headers: { 'x-forwarded-for': randomBytes(8).toString('hex') } });
    assert.equal(response.status, 429);
    assert.equal(response.headers['retry-after'], '1');
    assert.deepEqual(response.body, { error: 'Too many requests' });
    assert.equal(response.headers['cache-control'], 'no-store');
  }
  assert.deepEqual((await request('/health')).body, { status: 'ok' });
  clock = 999;
  assert.equal((await request('/files', { authorized: true })).status, 429);
  clock = 1000;
  assert.equal((await request('/files', { authorized: true })).status, 200);
});

test('failed authentication is throttled separately and cannot drain authorized budget', async t => {
  let clock = 0;
  const { request } = await start(t, { rateLimit: { limit: 1, windowMs: 1000, now: () => clock } });
  for (let i = 0; i < 30; i++) assert.equal((await request('/status')).status, 401);
  assert.equal((await request('/files')).status, 429);
  assert.equal((await request('/status', { authorized: true })).status, 200);
  assert.equal((await request('/status', { authorized: true })).status, 429);
  clock = 1000;
  assert.equal((await request('/files')).status, 401);
  assert.equal((await request('/status', { authorized: true })).status, 200);
});

test('production environment token is used without requiring embedded credentials', async t => {
  const previous = process.env.NOVA_MCP_TOKEN;
  const token = randomBytes(32).toString('hex');
  let server;
  try {
    process.env.NOVA_MCP_TOKEN = token;
    server = createServer();
  } finally {
    if (previous === undefined) delete process.env.NOVA_MCP_TOKEN;
    else process.env.NOVA_MCP_TOKEN = previous;
  }
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const result = await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: server.address().port, path: '/status', headers: { authorization: `Bearer ${token}` } }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    }).on('error', reject);
  });
  assert.equal(result, 200);
});

test('invalid rate-limit configuration fails before opening a listener', () => {
  for (const rateLimit of [{ limit: 0 }, { limit: Infinity }, { windowMs: -1 }, { now: 1 }]) {
    assert.throws(() => createServer(__dirname, { rateLimit }), /Invalid rate limit configuration/);
  }
});
