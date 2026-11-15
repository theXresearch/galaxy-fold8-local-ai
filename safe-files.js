'use strict';
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const DEFAULT_ALLOWLIST = require('./file-policy');
const MAX_BYTES = 64 * 1024;
function allowed(name) {
  return /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(name) && name !== 'node_modules'
    && !/(secret|credential|password|token|private|api[._-]?key|auth|cookie|session|service.account|^id_|^env(?:\.|$)|config|settings|certificate)/i.test(name)
    && !/\.(pem|key|p12|pfx|keystore|sqlite|db|log)$/i.test(name);
}
function partsOf(relative) {
  if (typeof relative !== 'string' || !relative || relative.length > 1024
      || path.isAbsolute(relative)) throw Error('Denied');
  const parts = relative.split('/');
  if (parts.length > 17 || parts.some(p => !allowed(p))) throw Error('Denied');
  return parts;
}
function textFile(name) { return /\.(md|txt|json|js|cjs|mjs|ts|tsx|jsx|css|html|yml|yaml)$/i.test(name); }
function prepareAllowlist(entries = DEFAULT_ALLOWLIST) {
  if (!Array.isArray(entries) || entries.length > 1000) throw Error('Invalid file allowlist');
  return Object.freeze([...new Set(entries.map(entry => {
    const parts = partsOf(entry);
    if (!textFile(parts.at(-1))) throw Error('Invalid file allowlist');
    return entry;
  }))].sort());
}
async function openRoot(root) {
  return fs.open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
}
async function openChild(parent, name, directory) {
  // Linux descriptor-relative paths keep each lookup anchored to its open parent.
  return fs.open(`/proc/self/fd/${parent.fd}/${name}`, constants.O_RDONLY
    | constants.O_NOFOLLOW | constants.O_NONBLOCK | (directory ? constants.O_DIRECTORY : 0));
}
async function openFile(rootHandle, parts) {
  let handle = rootHandle;
  try {
    for (let i = 0; i < parts.length; i++) {
      const next = await openChild(handle, parts[i], i < parts.length - 1);
      if (handle !== rootHandle) await handle.close();
      handle = next;
    }
    return handle;
  } catch (error) {
    if (handle !== rootHandle) await handle.close();
    throw error;
  }
}
async function eligible(handle) {
  const stat = await handle.stat();
  return stat.isFile() && stat.nlink === 1 && stat.size <= MAX_BYTES;
}
async function listFiles(root, entries = DEFAULT_ALLOWLIST) {
  const allowlist = prepareAllowlist(entries);
  const files = [];
  const rootHandle = await openRoot(root);
  try {
    // Inspect only approved names; no directory enumeration or discovery of new files.
    for (const relative of allowlist) {
      let handle;
      try {
        handle = await openFile(rootHandle, partsOf(relative));
        if (await eligible(handle)) files.push(relative);
      } catch (error) {
        if (!['ENOENT', 'ENOTDIR', 'ELOOP', 'EACCES', 'EPERM'].includes(error.code)) throw error;
      } finally { if (handle) await handle.close(); }
    }
  } finally { await rootHandle.close(); }
  return files;
}
async function readFile(root, relative, entries = DEFAULT_ALLOWLIST) {
  const parts = partsOf(relative);
  if (!prepareAllowlist(entries).includes(relative)) throw Error('Denied');
  const rootHandle = await openRoot(root);
  let handle;
  try {
    handle = await openFile(rootHandle, parts);
    if (!await eligible(handle)) throw Error('Denied');
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const chunk = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
      if (!chunk.bytesRead) break;
      bytesRead += chunk.bytesRead;
    }
    if (bytesRead > MAX_BYTES || !await eligible(handle)) throw Error('Denied');
    const content = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead));
    if (content.includes('\0')) throw Error('Denied');
    return { path: relative, content };
  } finally {
    if (handle) await handle.close();
    await rootHandle.close();
  }
}
module.exports = { listFiles, readFile, prepareAllowlist };
