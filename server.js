'use strict';

const http = require('node:http');
const { listFiles, prepareAllowlist } = require('./safe-files');
const { handleMcp } = require('./mcp');
const { createAccessControl } = require('./access-control');

function createServer(projectDirectory = __dirname, options = {}) {
  const allowlist = prepareAllowlist(options.allowlist);
  const authorize = createAccessControl(options.token ?? process.env.NOVA_MCP_TOKEN, options.rateLimit);
  const server = http.createServer(async (request, response) => {
    // Reject DNS rebinding and browser-origin requests, including legacy routes.
    const expectedHost = `127.0.0.1:${server.address()?.port}`;
    if (request.headers.host !== expectedHost || request.headers.origin) {
      response.writeHead(403, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ error: 'Forbidden' }));
      return;
    }
    if (['/mcp', '/status', '/files'].includes(request.url) && !authorize(request, response)) return;
    if (request.url === '/mcp') {
      try { await handleMcp(request, response, projectDirectory, allowlist); }
      catch {
        if (!response.headersSent) response.writeHead(500);
        response.end();
      }
      return;
    }
    if (request.method === 'GET' && request.url === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    if (request.method === 'GET' && request.url === '/status') {
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({
        project: 'NOVA Remote Development Bridge',
        nodeVersion: process.version,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      }));
      return;
    }

    if (request.method === 'GET' && request.url === '/files') {
      try {
        const files = await listFiles(projectDirectory, allowlist);
        response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify(files));
      } catch {
        response.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify({ error: 'Unable to list project files' }));
      }
      return;
    }

    response.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ error: 'Not found' }));
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.maxConnections = 32;
  return server;
}

if (require.main === module) {
  const server = createServer();
  server.on('error', (error) => {
    console.error('Server failed:', error.message);
    process.exitCode = 1;
  });
  server.listen(3000, '127.0.0.1', () => {
    console.log('NOVA Remote Development Bridge listening on http://127.0.0.1:3000');
  });
}

module.exports = { createServer };
