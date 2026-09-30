import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { dashboardServer } from '../src/dashboard.mjs';
import { runDiscoveryCommand } from '../src/automation-client.mjs';

async function listen(t, server) {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => server.close(r)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('scheduled busy check defers without consuming a search attempt or releasing the other operation lock', async t => {
  let release, entered, searches = 0, writes = 0;
  const held = new Promise(r => { entered = r; });
  const gate = new Promise(r => { release = r; });
  t.after(() => release());
  const base = await listen(t, dashboardServer({ root: resolve('output/test-runs', randomUUID()),
    clock: () => new Date('2026-09-29T13:00:00Z'), onlineImpl: async () => true,
    discoverImpl: async () => { searches++; return { results: [], finishedAt: '2026-09-29T13:00:00Z', errors: [] }; },
    automationImpl: { status: async () => ({ connected: true, enabled: true }),
      setEnabled: async () => { writes++; entered(); await gate; return { connected: true, enabled: true }; } } }));
  const { csrf } = await (await fetch(base + '/api/status')).json();
  const post = (path, body = {}) => fetch(base + path, { method: 'POST', headers: { 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const write = post('/api/automation/enabled', { enabled: true });
  await held;
  try {
    const deferred = await runDiscoveryCommand('tick', base);
    assert.equal(deferred.deferred, true); assert.equal(deferred.reason, 'operation-busy');
    assert.equal(deferred.runId, undefined); assert.equal(deferred.status, undefined);
    await assert.rejects(runDiscoveryCommand('discover', base), /另一个操作/);
    const secondWrite = await post('/api/automation/enabled', { enabled: false });
    assert.equal(secondWrite.status, 409); assert.equal((await secondWrite.json()).code, 'OPERATION_BUSY');
    assert.equal(writes, 1); assert.equal(searches, 0);
    assert.equal((await (await fetch(base + '/api/automation')).json()).runs.length, 0);
  } finally { release(); await write; }
  const result = await runDiscoveryCommand('tick', base);
  assert.equal(result.status, 'done'); assert.equal(searches, 1);
  assert.equal((await runDiscoveryCommand('tick', base)).skipped, true); assert.equal(searches, 1);
});

test('only the explicit busy code with HTTP 409 on tick is deferred; real errors and manual requests still fail', async t => {
  let status = 409, code = 'OPERATION_BUSY', posts = 0;
  const base = await listen(t, createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET') return res.end(JSON.stringify({ csrf: 'fixture' }));
    posts++; res.writeHead(status); res.end(JSON.stringify({ code, error: 'Synthetic failure' }));
  }));
  assert.equal((await runDiscoveryCommand('tick', base)).deferred, true);
  assert.equal(posts, 1); // No hidden retry or second POST.
  for (const [http, errorCode] of [[409, 'STALE_INPUT'], [403, 'OPERATION_BUSY'], [500, 'OPERATION_BUSY'], [400, 'DISK_FAILURE']]) {
    status = http; code = errorCode;
    await assert.rejects(runDiscoveryCommand('tick', base), /Synthetic failure/);
  }
  status = 409; code = 'OPERATION_BUSY';
  await assert.rejects(runDiscoveryCommand('discover', base), /Synthetic failure/);
  assert.equal(posts, 6);
});
