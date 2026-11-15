'use strict';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const http = require('node:http');
const test = require('node:test');
const { randomBytes } = require('node:crypto');
const testTokens = new WeakMap();
const { createServer } = require('./server');

test('GET /health is public and reveals only liveness', async (t) => {
  const server = createServer();
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  assert.equal(server.address().address, '127.0.0.1');

  const result = await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: server.address().port, path: '/health' }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ response, body }));
      response.on('error', reject);
    }).on('error', reject);
  });
  assert.equal(result.response.statusCode, 200);
  assert.equal(result.response.headers['content-type'], 'application/json');
  const payload = JSON.parse(result.body);
  assert.deepEqual(payload, { status: 'ok' });
});

async function startServer(t, directory) {
  const token = randomBytes(32).toString('hex');
  const server = createServer(directory, { token, allowlist: ['README.md', 'src/example.txt'] });
  testTokens.set(server, token);
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server;
}

async function get(server, route, method = 'GET') {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1', port: server.address().port, path: route, method, headers: { authorization: `Bearer ${testTokens.get(server)}` },
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({
        status: response.statusCode, type: response.headers['content-type'],
        body: JSON.parse(body),
      }));
      response.on('error', reject);
    });
    request.on('error', reject);
    request.end();
  });
}

test('GET /status returns runtime details and current timestamp', async (t) => {
  const server = await startServer(t);
  const before = Date.now();
  const uptimeBefore = process.uptime();
  const result = await get(server, '/status');
  assert.equal(result.status, 200);
  assert.equal(result.type, 'application/json');
  assert.equal(result.body.project, 'NOVA Remote Development Bridge');
  assert.equal(result.body.nodeVersion, process.version);
  assert.ok(result.body.uptime >= uptimeBefore && result.body.uptime <= process.uptime());
  const timestamp = Date.parse(result.body.timestamp);
  assert.equal(new Date(timestamp).toISOString(), result.body.timestamp);
  assert.ok(timestamp >= before && timestamp <= Date.now());
});

test('GET /files lists nested regular files and excludes sensitive entries and symlinks', async (t) => {
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const directory = await fs.mkdtemp(path.join(__dirname, '.files-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  for (const name of ['src', 'node_modules', '.git', '.hidden', 'credentials', 'secrets']) {
    await fs.mkdir(path.join(directory, name));
    await fs.writeFile(path.join(directory, name, 'example.txt'), 'fixture');
  }
  for (const name of ['README.md', '.env', 'credentials.json', 'service-account.credentials.json', 'private.key', 'id_rsa', 'secret.txt', 'tokens.json']) {
    await fs.writeFile(path.join(directory, name), 'fixture');
  }
  await fs.writeFile(path.join(directory, 'unapproved.md'), 'not approved');
  await fs.symlink(path.join(directory, 'README.md'), path.join(directory, 'linked-file'));
  await fs.symlink(path.join(directory, 'src'), path.join(directory, 'linked-directory'));
  const server = await startServer(t, directory);
  const result = await get(server, '/files');
  assert.equal(result.status, 200);
  assert.equal(result.type, 'application/json');
  assert.deepEqual(result.body, ['README.md', 'src/example.txt']);
});

test('GET /files returns a controlled error when listing fails', async (t) => {
  const server = await startServer(t, require('node:path').join(__dirname, 'server.js'));
  const result = await get(server, '/files');
  assert.equal(result.status, 500);
  assert.deepEqual(result.body, { error: 'Unable to list project files' });
});

test('unknown routes and write methods return 404', async (t) => {
  const server = await startServer(t);
  for (const route of ['/health', '/status', '/files']) {
    assert.equal((await get(server, route, 'POST')).status, 404);
  }
  assert.equal((await get(server, '/unknown')).status, 404);
});
