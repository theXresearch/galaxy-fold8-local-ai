'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { randomBytes } = require('node:crypto');
const { createServer } = require('./server');
async function setup(t, token = randomBytes(32).toString('hex'), allowlist = ['README.md', 'src/index.js', 'safe.txt', 'binary.txt', 'large.txt', 'link.txt', 'linked/readable.md', 'hard.txt', 'readable.md']) {
  const root = await fs.mkdtemp(path.join(__dirname, '.mcp-test-'));
  const server = createServer(root, { token, allowlist });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise(r => server.close(r)); await fs.rm(root, { recursive: true, force: true }); });
  async function request(message, headers = {}, method = 'POST', raw = false) {
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: server.address().port, path: '/mcp', method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers } }, res => {
        let data = ''; res.on('data', c => { data += c; });
        res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
      }); req.on('error', reject); req.end(raw ? message : JSON.stringify(message));
    });
  }
  const call = (name, args = {}) => request({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  return { root, request, call };
}
test('MCP initialization, discovery, notifications, and read-only tools', async t => {
  const { root, request, call } = await setup(t);
  await fs.writeFile(path.join(root, 'README.md'), 'hello');
  await fs.mkdir(path.join(root, 'src'));
  await fs.writeFile(path.join(root, 'src', 'index.js'), 'module.exports = 1;');
  const init = await request({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
  assert.equal(init.body.result.protocolVersion, '2025-06-18');
  assert.equal((await request({ jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
  const discovery = await request({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.equal(discovery.body.result.tools.length, 4);
  assert.ok(discovery.body.result.tools.every(t => t.annotations.readOnlyHint));
  for (const name of ['get_health', 'get_project_info']) {
    const result = await call(name); assert.equal(result.status, 200);
    assert.equal(JSON.parse(result.body.result.content[0].text).project, 'NOVA Remote Development Bridge');
  }
  assert.deepEqual(JSON.parse((await call('list_project_files')).body.result.content[0].text), ['README.md', 'src/index.js']);
  assert.equal(JSON.parse((await call('read_project_file', { path: 'README.md' })).body.result.content[0].text).content, 'hello');
  assert.equal(JSON.parse((await call('read_project_file', { path: 'src/index.js' })).body.result.content[0].text).content, 'module.exports = 1;');
});
test('MCP authentication, origin, host, methods, and schemas fail closed', async t => {
  const { request, call } = await setup(t);
  const msg = { jsonrpc: '2.0', id: 1, method: 'ping' };
  assert.equal((await request(msg, { authorization: '' })).status, 401);
  assert.equal((await request(msg, { authorization: 'Bearer incorrect' })).status, 401);
  assert.equal((await request(msg, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await request(msg, { host: 'evil.example' })).status, 403);
  assert.equal((await request(msg, {}, 'GET')).status, 405);
  assert.equal((await request(msg, { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await request(msg, { accept: 'application/json' })).status, 406);
  assert.equal((await request(msg, { 'mcp-protocol-version': 'invalid' })).status, 400);
  assert.equal((await request({})).body.error.code, -32600);
  assert.equal((await call('execute_command')).body.error.code, -32602);
  assert.equal((await call('get_health', { command: 'anything' })).body.error.code, -32602);
  assert.equal((await request({ ...msg, params: { value: 'x'.repeat(17000) } })).status, 413);
  const disabled = await setup(t, '');
  assert.equal((await disabled.request(msg)).status, 503);
});
test('file tools reject traversal, hidden secrets, links, binaries, and oversized files', async t => {
  const { root, call } = await setup(t);
  for (const name of ['safe.txt', '.env', 'credentials.json', 'private.json', 'api-key.json', 'auth.json', 'service-account.json', 'archive.db', 'binary.txt', 'large.txt']) {
    await fs.writeFile(path.join(root, name), name === 'large.txt' ? 'x'.repeat(65537) : name === 'binary.txt' ? Buffer.from([0, 255]) : 'data');
  }
  await fs.mkdir(path.join(root, '.hidden'));
  await fs.writeFile(path.join(root, '.hidden', 'safe.txt'), 'hidden');
  await fs.symlink(path.join(root, 'safe.txt'), path.join(root, 'link.txt'));
  await fs.symlink(root, path.join(root, 'linked'));
  await fs.link(path.join(root, 'safe.txt'), path.join(root, 'hard.txt'));
  await fs.writeFile(path.join(root, 'readable.md'), 'visible');
  for (const file of ['../server.js', '/etc/passwd', './safe.txt', 'a/../safe.txt', 'a\\safe.txt', '%2e%2e/server.js', '.env', '.hidden/safe.txt', 'credentials.json', 'private.json', 'api-key.json', 'auth.json', 'service-account.json', 'archive.db', 'binary.txt', 'large.txt', 'link.txt', 'linked/readable.md', 'hard.txt', 'missing.txt']) {
    assert.equal((await call('read_project_file', { path: file })).body.result.isError, true, file);
  }
  const files = JSON.parse((await call('list_project_files')).body.result.content[0].text);
  assert.deepEqual(files, ['binary.txt', 'readable.md']);
});

test('JSON-RPC rejects malformed envelopes and parameters without reflecting invalid IDs', async t => {
  const { request } = await setup(t);
  for (const message of [null, true, 1, 'text', [], [{ jsonrpc: '2.0', id: 1, method: 'ping' }], {},
    { jsonrpc: '1.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', id: 1, method: '' },
    ...[null, {}, [], true, 1.5, 9007199254740992].map(id => ({ jsonrpc: '2.0', id, method: 'ping' })),
    { jsonrpc: '2.0', id: 1, method: 'ping', result: {} }]) {
    const response = await request(message);
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, -32600);
    if (message && Object.hasOwn(message, 'id') && !['string', 'number'].includes(typeof message.id)) assert.equal(response.body.id, null);
  }
  for (const params of [null, false, 0, '', [], { _meta: null }]) {
    const response = await request({ jsonrpc: '2.0', id: 'client-1', method: 'ping', params });
    assert.equal(response.body.error.code, -32602);
    assert.equal(response.body.id, 'client-1');
  }
  for (const id of [0, -1, '']) {
    const response = await request({ jsonrpc: '2.0', id, method: 'ping' });
    assert.equal(response.body.id, id);
    assert.deepEqual(response.body.result, {});
  }
  const malformed = await request('{"jsonrpc":', {}, 'POST', true);
  assert.equal(malformed.status, 400);
  const invalidUtf8 = await request(Buffer.from([123, 255, 125]), {}, 'POST', true);
  assert.equal(invalidUtf8.body.error.code, -32700);
  assert.deepEqual(malformed.body, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
  assert.equal((await request({ jsonrpc: '2.0', id: 9, method: 'unknown' })).body.error.code, -32601);
});

test('MCP version negotiation echoes supported offers and returns fallback for unsupported offers', async t => {
  const { request } = await setup(t);
  const initialize = version => ({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
    protocolVersion: version, clientInfo: { name: 'conformance-test', version: '1' }, capabilities: {},
  } });
  for (const version of ['2025-03-26', '2025-06-18', '2099-01-01']) {
    const response = await request(initialize(version));
    assert.equal(response.body.result.protocolVersion, version === '2099-01-01' ? '2025-06-18' : version);
  }
  const ping = { jsonrpc: '2.0', id: 2, method: 'ping' };
  for (const version of ['2025-03-26', '2025-06-18']) {
    assert.deepEqual((await request(ping, { 'mcp-protocol-version': version })).body.result, {});
  }
  assert.deepEqual((await request(ping)).body.result, {}); // documented 2025-03-26 fallback
  assert.equal((await request(ping, { 'mcp-protocol-version': '2099-01-01' })).status, 400);
  assert.equal((await request(ping, { 'mcp-protocol-version': '' })).status, 400);
  assert.equal((await request(initialize('2025-03-26'), { 'mcp-protocol-version': '2025-06-18' })).body.error.code, -32602);
  for (const params of [{}, { ...initialize('').params }, { ...initialize('2025-06-18').params, clientInfo: true },
    { ...initialize('2025-06-18').params, clientInfo: { name: 'test' } },
    { ...initialize('2025-06-18').params, capabilities: [] },
    { ...initialize('2025-06-18').params, capabilities: { roots: true } }]) {
    assert.equal((await request({ ...initialize('2025-06-18'), params })).body.error.code, -32602);
  }
});

test('MCP notifications, transport media types, and tool schemas are enforced', async t => {
  const { request } = await setup(t);
  const ping = { jsonrpc: '2.0', id: 1, method: 'ping' };
  for (const accept of ['application/json-bogus, text/event-stream', 'application/json, text/event-stream;q=0', 'application/json;q=0, text/event-stream', 'application/json, text/event-stream;q=invalid']) {
    assert.equal((await request(ping, { accept })).status, 406);
  }
  assert.equal((await request(ping, { accept: 'APPLICATION/JSON;q=1, text/event-stream;q=0.5', 'content-type': 'Application/JSON; charset=utf-8' })).status, 200);
  for (const message of [{ jsonrpc: '2.0', method: 'tools/call', params: { name: 'get_health' } },
    { jsonrpc: '2.0', id: 1, method: 'notifications/initialized' },
    { jsonrpc: '2.0', method: 'notifications/initialized', params: [] },
    { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: null } }]) {
    assert.equal((await request(message)).status, 400);
  }
  for (const method of ['notifications/initialized', 'notifications/unknown']) {
    const response = await request({ jsonrpc: '2.0', method });
    assert.equal(response.status, 202); assert.equal(response.body, null);
  }
  for (const params of [{ name: 'get_health', arguments: null }, { name: 'get_health', arguments: [] },
    { name: 'read_project_file', arguments: {} }, { name: 'get_health', root: '/etc' },
    { name: 'get_health', arguments: { toString: 'bad' } },
    { name: 'get_health', arguments: JSON.parse('{"__proto__":{}}') }]) {
    assert.equal((await request({ jsonrpc: '2.0', id: 3, method: 'tools/call', params })).body.error.code, -32602);
  }
  assert.equal((await request({ ...ping, method: 'tools/list', params: { cursor: 'unissued' } })).body.error.code, -32602);
});

test('MCP file listing and reads share exact allowlist with no implicit discovery', async t => {
  const { root, call } = await setup(t, undefined, ['README.md']);
  await fs.writeFile(path.join(root, 'README.md'), 'approved');
  await fs.writeFile(path.join(root, 'unapproved.md'), 'must stay private');
  assert.deepEqual(JSON.parse((await call('list_project_files')).body.result.content[0].text), ['README.md']);
  assert.equal((await call('read_project_file', { path: 'unapproved.md' })).body.result.isError, true);
  assert.equal((await call('list_project_files', { allowlist: ['unapproved.md'] })).body.error.code, -32602);
});
