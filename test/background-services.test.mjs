import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { dashboardReady, portListening, serviceMonitor, workspaceId } from '../src/background-services.mjs';
import { dashboardServer } from '../src/dashboard.mjs';
import { automationAdapter } from '../src/automation.mjs';
import { automationView } from '../web/automation-view.js';

test('readiness requires the correct application, workspace and ready response, not just an open port', async t => {
  const root = resolve('output/test-runs', randomUUID());
  let body = { service: 'another-app', workspaceId: workspaceId(root), ready: true };
  const foreign = createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); });
  await new Promise(r => foreign.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => foreign.close(r)));
  const port = foreign.address().port;
  assert.equal(await portListening(port), true);
  assert.equal(await dashboardReady(root, port), false);
  body.service = 'career-queue'; body.workspaceId = workspaceId(root + '-other');
  assert.equal(await dashboardReady(root, port), false);
  body.workspaceId = workspaceId(root); body.ready = false;
  assert.equal(await dashboardReady(root, port), false);
  body.ready = true;
  assert.equal(await dashboardReady(root, port), true);
  const app = dashboardServer({ root });
  await new Promise(r => app.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => app.close(r)));
  assert.equal(await dashboardReady(root, app.address().port), true);
});

function monitorFixture() {
  let now = 0, occupied = false, ready = false, launches = 0, child, saved;
  const monitor = serviceMonitor({ clock: () => now, listening: async () => occupied,
    save: async value => { saved = structuredClone(value); }, services: [{ name: 'gateway', port: 1,
      ready: async () => ready, launch: () => { launches++; child = new EventEmitter(); return child; } }] });
  return { monitor, set: values => { if ('now' in values) now = values.now; if ('occupied' in values) occupied = values.occupied; if ('ready' in values) ready = values.ready; },
    launches: () => launches, child: () => child, state: () => saved.services.gateway };
}
test('an occupied but unverified port is left alone; healthy existing service is reused', async () => {
  const f = monitorFixture(); f.set({ occupied: true }); await f.monitor.check();
  assert.equal(f.state().reason, 'port-unverified'); assert.equal(f.launches(), 0);
  f.set({ ready: true }); await f.monitor.check();
  assert.equal(f.state().state, 'ready'); assert.equal(f.launches(), 0);
});
test('slow startup and concurrent checks do not launch duplicates; readiness and owned-child exit recover', async () => {
  const f = monitorFixture(); await Promise.all([f.monitor.check(), f.monitor.check(), f.monitor.check()]);
  assert.equal(f.launches(), 1); assert.equal(f.state().state, 'starting');
  f.set({ now: 60000, occupied: true }); await f.monitor.check();
  assert.equal(f.state().state, 'starting'); assert.equal(f.launches(), 1);
  f.set({ now: 100000 }); await f.monitor.check();
  assert.equal(f.state().state, 'unavailable'); assert.equal(f.launches(), 1);
  f.set({ ready: true }); await f.monitor.check(); assert.equal(f.state().state, 'ready');
  f.child().emit('exit', 1); f.set({ occupied: false, ready: false });
  await Promise.all([f.monitor.check(), f.monitor.check()]);
  assert.equal(f.launches(), 2); assert.equal(f.state().state, 'starting');
});
test('a failed spawn is reported and can recover on the next check', async () => {
  let attempts = 0, state;
  const monitor = serviceMonitor({ listening: async () => false, save: async s => { state = s; },
    services: [{ name: 'gateway', port: 1, ready: async () => false, launch: () => { if (++attempts === 1) throw new Error('spawn failed'); return new EventEmitter(); } }] });
  await monitor.check(); assert.equal(state.services.gateway.reason, 'launch-failed');
  await monitor.check(); assert.equal(state.services.gateway.state, 'starting'); assert.equal(attempts, 2);
});
async function adapterFixture(call) {
  const root = resolve('output/test-runs', randomUUID());
  await mkdir(resolve(root, 'private'), { recursive: true });
  await writeFile(resolve(root, 'private/automation.json'), JSON.stringify({ jobId: 'fixture-job' }));
  let now = 100000;
  return { root, adapter: automationAdapter(root, { call, clock: () => now }), setTime: value => { now = value; } };
}
test('Gateway failure is unknown rather than paused, and startup hints expire', async () => {
  const f = await adapterFixture(async () => { throw new Error('unreachable'); });
  let status = await f.adapter.status();
  assert.equal(status.state, 'unavailable'); assert.equal(status.enabled, null); assert.equal(status.connected, false);
  await mkdir(resolve(f.root, 'output/automation'), { recursive: true });
  await writeFile(resolve(f.root, 'output/automation/background.json'), JSON.stringify({ checkedAt: 100000, services: { gateway: { state: 'starting' } } }));
  assert.equal((await f.adapter.status(true)).state, 'starting');
  f.setTime(200000); assert.equal((await f.adapter.status()).state, 'unavailable');
});
test('status calls share one check; enabled changes require a fresh verified result', async () => {
  let calls = 0, enabled = false;
  const f = await adapterFixture(async (root, args) => {
    calls++; await new Promise(r => setImmediate(r));
    if (args[1] === 'enable') { enabled = true; return {}; }
    return { id: 'fixture-job', enabled };
  });
  const values = await Promise.all([f.adapter.status(), f.adapter.status(), f.adapter.status()]);
  assert.equal(calls, 1); assert.ok(values.every(v => v.state === 'paused'));
  assert.equal((await f.adapter.setEnabled(true)).state, 'enabled'); assert.equal(calls, 3);
  assert.equal((await f.adapter.status()).enabled, true); assert.equal(calls, 3);
});
test('mismatched or incomplete Gateway records cannot verify the schedule', async () => {
  for (const result of [{ id: 'other', enabled: true }, { id: 'fixture-job' }]) {
    const f = await adapterFixture(async () => result);
    assert.equal((await f.adapter.status()).enabled, null);
    await assert.rejects(f.adapter.setEnabled(true), /无法确认/);
  }
});
test('Dashboard distinguishes unknown, startup, paused, catch-up and exhausted retries while retaining partial results', () => {
  const render = (schedule, extra = {}) => automationView({ schedule, ...extra });
  const unknown = render({ connected: false, enabled: null, state: 'unavailable' });
  assert.match(unknown, /后台连接待核实/); assert.doesNotMatch(unknown, /自动发现已暂停/);
  assert.match(unknown, /automation-toggle" disabled/);
  assert.match(render({ state: 'starting' }), /后台正在启动/);
  assert.match(render({ connected: true, enabled: false }), /自动发现已暂停/);
  const enabled = { connected: true, enabled: true };
  assert.match(render(enabled, { runs: [{ status: 'running', catchUp: true }] }), /正在当天补跑/);
  assert.match(render(enabled, { waiting: '等待网络恢复', retryAt: '2026-09-29T13:05:00Z' }), /等待重试 \/ 网络恢复/);
  const html = render(enabled, { waiting: '今日自动尝试已达 3 次', runs: [{ status: 'failed' }, { status: 'partial', finishedAt: '2026-09-29T13:00:00Z' }] });
  assert.match(html, /自动重试已停止/); assert.match(html, /部分来源失败，结果不完整/); assert.match(html, /已保留这次结果/);
});
