import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { dashboardServer } from '../src/dashboard.mjs';
import { runDiscoveryCommand } from '../src/automation-client.mjs';
import { automationView } from '../web/automation-view.js';

const listen = async (server, port = 0) => {
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise((done, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => { server.off('error', reject); done(); });
    });
    const url = `http://127.0.0.1:${server.address().port}`;
    try { await fetch(url, { method: 'HEAD' }); return url; }
    catch (e) {
      await close(server);
      // Windows can allocate a Fetch-forbidden ephemeral port. Never hide
      // connection failures or change the explicitly requested recovery port.
      if (port || e.cause?.message !== 'bad port' || attempt === 9) throw e;
    }
  }
};
const close = async server => {
  if (!server?.listening) return;
  server.closeAllConnections();
  await new Promise(done => server.close(done));
};

// Real loopback connection loss; synthetic sources and clock. This does not
// simulate Windows login, suspend the computer, or disable its network adapter.
async function fixture(t) {
  const root = resolve('output/test-runs', randomUUID());
  await mkdir(root, { recursive: true });
  let now = new Date('2026-10-01T13:00:00Z'), searches = 0, server;
  const source = createServer((req, res) => { res.writeHead(204); res.end(); });
  const sourceUrl = await listen(source), sourcePort = source.address().port;
  const config = { root, clock: () => now,
    onlineImpl: async () => {
      try { await fetch(sourceUrl, { method: 'HEAD', signal: AbortSignal.timeout(1000) }); return true; }
      catch { return false; }
    },
    discoverImpl: async () => {
      searches++;
      return { dataVersion: 5, targetTerms: ['Winter 2027', 'Summer 2027', 'Fall 2027'],
        results: [], finishedAt: now.toISOString(), errors: [], acceptanceMarker: searches };
    },
    automationImpl: { status: async () => ({ connected: true, enabled: true }) }
  };
  t.after(async () => { await close(server); await close(source); });
  const api = {
    root, searches: () => searches, setTime: value => { now = new Date(value); },
    offline: () => close(source), online: () => listen(source, sourcePort),
    snapshot: () => readFile(resolve(root, 'output/discovery/latest.json'), 'utf8'),
    async restart() { await close(server); server = dashboardServer(config); api.base = await listen(server); },
    tick: () => runDiscoveryCommand('tick', api.base),
    info: () => runDiscoveryCommand('status', api.base)
  };
  await api.restart();
  return api;
}

test('HTTP scheduler preserves results through offline restart, waits five minutes and recovers exactly once', async t => {
  const f = await fixture(t);
  assert.equal((await f.tick()).status, 'done');
  const previous = await f.snapshot();
  f.setTime('2026-10-02T13:00:00Z'); await f.offline();
  assert.equal((await f.tick()).waiting, true);
  let state = await f.info();
  assert.equal(f.searches(), 1); assert.equal(state.runs.length, 1);
  assert.match(state.waiting, /等待网络恢复/);
  assert.equal(state.retryAt, '2026-10-02T13:05:00.000Z');
  assert.equal(await f.snapshot(), previous);
  assert.match(automationView(state), /等待网络恢复/);
  await f.restart();
  assert.equal((await f.tick()).skipped, true);
  assert.equal(await f.snapshot(), previous);
  f.setTime('2026-10-02T13:05:00Z');
  assert.equal((await f.tick()).waiting, true);
  assert.equal((await f.info()).runs.length, 1); // Offline probes use no attempts.
  await f.online(); f.setTime('2026-10-02T13:09:59Z');
  assert.equal((await f.tick()).skipped, true);
  f.setTime('2026-10-02T13:10:00Z');
  assert.equal((await f.tick()).status, 'done');
  await f.restart();
  const results = await Promise.all([f.tick(), f.tick()]);
  assert.ok(results.every(result => result.skipped || result.deferred));
  state = await f.info();
  assert.equal(state.lastSuccessDay, '2026-10-02');
  assert.equal(state.waiting, null); assert.equal(state.retryAt, null);
  assert.equal(state.runs.length, 2); assert.equal(f.searches(), 2);
  assert.equal(state.runs[0].catchUp, true);
});

test('HTTP scheduler after a multi-day gap only catches the current day and honors Toronto winter time', async t => {
  const f = await fixture(t);
  await f.tick();
  f.setTime('2026-11-02T13:59:59Z'); await f.restart();
  assert.equal((await f.tick()).skipped, true);
  assert.equal((await f.info()).nextScheduledAt, '2026-11-02T14:00:00.000Z');
  f.setTime('2026-11-02T15:30:00Z');
  assert.equal((await f.tick()).status, 'done');
  const state = await f.info();
  assert.deepEqual(state.runs.map(run => run.day), ['2026-11-02', '2026-10-01']);
  assert.equal(state.runs[0].catchUp, true); assert.equal(f.searches(), 2);
  await f.restart(); assert.equal((await f.tick()).skipped, true);
  assert.equal((await f.info()).nextScheduledAt, '2026-11-03T14:00:00.000Z');
});
