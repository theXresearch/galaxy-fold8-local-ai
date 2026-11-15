'use strict';
const { createHash, timingSafeEqual } = require('node:crypto');
const { performance } = require('node:perf_hooks');

function send(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

function createAccessControl(token, options = {}) {
  const limit = options.limit ?? 120;
  const windowMs = options.windowMs ?? 60000;
  const now = options.now ?? (() => performance.now());
  if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(windowMs) || windowMs < 1
      || typeof now !== 'function') throw Error('Invalid rate limit configuration');
  // No token is generated, persisted, or logged by the server. Length checks
  // cannot establish entropy: operators must supply a securely generated secret.
  const configured = typeof token === 'string' && /^[\x21-\x7e]{32,1024}$/.test(token);
  const digest = configured ? createHash('sha256').update(`Bearer ${token}`).digest() : null;
  const valid = { start: now(), count: 0 };
  const invalid = { start: now(), count: 0 };
  function consume(bucket, maximum, response) {
    const current = now();
    if (current - bucket.start >= windowMs) { bucket.start = current; bucket.count = 0; }
    if (bucket.count >= maximum) {
      response.setHeader('Retry-After', String(Math.max(1, Math.ceil((windowMs - (current - bucket.start)) / 1000))));
      send(response, 429, { error: 'Too many requests' });
      return false;
    }
    bucket.count++;
    return true;
  }
  return (request, response) => {
    if (!configured) {
      send(response, 503, { error: 'Authentication not configured' });
      return false;
    }
    const presented = createHash('sha256').update(request.headers.authorization || '').digest();
    if (!timingSafeEqual(digest, presented)) {
      // Failed authentication has a separate budget and cannot consume the
      // authorized caller's quota. Ignore caller-controlled forwarding headers.
      if (consume(invalid, 30, response)) {
        response.setHeader('WWW-Authenticate', 'Bearer');
        send(response, 401, { error: 'Unauthorized' });
      }
      return false;
    }
    return consume(valid, limit, response);
  };
}
module.exports = { createAccessControl };
