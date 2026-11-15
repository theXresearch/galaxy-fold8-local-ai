'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { listFiles, readFile, prepareAllowlist } = require('./safe-files');
async function fixture(t) {
  const base = await fs.mkdtemp(path.join(__dirname, '.security-test-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'project');
  await fs.mkdir(root);
  return { base, root };
}
test('allowlist configuration rejects sensitive paths, globs, traversal, and encodings', () => {
  for (const name of ['.env', '.git/info.txt', 'node_modules/file.js', 'credentials.json', 'tokens.txt',
    'private.key', 'id_ed25519', 'config.json', 'settings.yaml', 'src/app.config.js', 'auth.json',
    'api-key.txt', 'certificate.pem', 'service-account.json', '../README.md', '/etc/passwd',
    'src/../README.md', './README.md', 'src//file.js', 'src\\file.js', '%2e%2e/file.js', 'src/*.js',
    'name\0.txt', 'src/\u202efile.js']) {
    assert.throws(() => prepareAllowlist([name]), undefined, name);
  }
  for (const value of [null, {}, 'README.md', [null], Array(1001).fill('README.md')]) {
    assert.throws(() => prepareAllowlist(value));
  }
  assert.deepEqual(prepareAllowlist(['src/index.js', 'README.md', 'README.md']), ['README.md', 'src/index.js']);
});
test('allowlisted files cannot escape via intermediate or final symlinks or hard links', async t => {
  const { base, root } = await fixture(t);
  await fs.writeFile(path.join(base, 'outside.txt'), 'outside root, still inside test project fixture');
  await fs.mkdir(path.join(base, 'external'));
  await fs.writeFile(path.join(base, 'external', 'data.txt'), 'outside');
  await fs.symlink(path.join(base, 'outside.txt'), path.join(root, 'link.txt'));
  await fs.symlink(path.join(base, 'external'), path.join(root, 'nested'));
  await fs.link(path.join(base, 'outside.txt'), path.join(root, 'hard.txt'));
  const allowlist = ['link.txt', 'nested/data.txt', 'hard.txt'];
  assert.deepEqual(await listFiles(root, allowlist), []);
  for (const file of allowlist) await assert.rejects(readFile(root, file, allowlist));
  // A previously safe name replaced by a symlink must fail on the next access.
  const target = path.join(root, 'README.md');
  await fs.writeFile(target, 'safe');
  assert.equal((await readFile(root, 'README.md', ['README.md'])).content, 'safe');
  await fs.rename(target, path.join(root, 'old.md'));
  await fs.symlink(path.join(base, 'outside.txt'), target);
  await assert.rejects(readFile(root, 'README.md', ['README.md']));
});
test('file reads enforce exact allowlist, UTF-8, byte limits and regular-file type', async t => {
  const { root } = await fixture(t);
  for (const [name, data] of [['empty.txt', ''], ['boundary.txt', 'x'.repeat(65536)],
    ['large.txt', 'x'.repeat(65537)], ['binary.txt', Buffer.from([255])], ['nul.txt', 'a\0b'],
    ['unapproved.txt', 'secret under ordinary name']]) await fs.writeFile(path.join(root, name), data);
  await fs.mkdir(path.join(root, 'directory.txt'));
  const allowlist = ['empty.txt', 'boundary.txt', 'large.txt', 'binary.txt', 'nul.txt', 'directory.txt'];
  assert.equal((await readFile(root, 'empty.txt', allowlist)).content, '');
  assert.equal((await readFile(root, 'boundary.txt', allowlist)).content.length, 65536);
  for (const file of ['large.txt', 'binary.txt', 'nul.txt', 'directory.txt', 'unapproved.txt', '../outside.txt']) {
    await assert.rejects(readFile(root, file, allowlist), undefined, file);
  }
  assert.deepEqual(await listFiles(root, allowlist), ['binary.txt', 'boundary.txt', 'empty.txt', 'nul.txt']);
});
test('default policy admits only reviewed exact project files', async t => {
  const { root } = await fixture(t);
  await fs.writeFile(path.join(root, 'README.md'), 'approved');
  await fs.writeFile(path.join(root, 'new-source.js'), 'not reviewed');
  await fs.writeFile(path.join(root, 'config.json'), 'sensitive');
  assert.deepEqual(await listFiles(root), ['README.md']);
  await assert.rejects(readFile(root, 'new-source.js'));
  await assert.rejects(readFile(root, 'config.json'));
});
