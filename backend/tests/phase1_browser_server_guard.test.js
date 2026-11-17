'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { assertPortsAvailable, viteLaunchSource } = require('./helpers/phase1BrowserServerGuard');

test('occupied frontend/API port is rejected rather than probing an unrelated app', async () => {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, resolve));
  try {
    await assert.rejects(assertPortsAvailable([server.address().port]), /refusing to use an existing server/);
    assert.equal(server.listening, true, 'unrelated server must remain running');
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('successful preflight releases its owned listener', async () => {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  await assertPortsAvailable([port]);
  await assertPortsAvailable([port]);
});

test('real Vite refuses an occupied frontend port instead of incrementing it', async () => {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', viteLaunchSource(port, 35101)], {
      cwd: path.resolve(__dirname, '../../frontend'), encoding: 'utf8', timeout: 15000
    });
    assert.ifError(result.error);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /already in use/);
    assert.equal(server.listening, true);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
