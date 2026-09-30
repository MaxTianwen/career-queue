import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DiscoveryRunner, scheduledAt, atomicJson } from '../src/discovery-runner.mjs';
import { dashboardServer } from '../src/dashboard.mjs';
import { automationView } from '../web/automation-view.js';

const report = (results = []) => ({ dataVersion: 5, targetTerms: ['Winter 2027', 'Summer 2027', 'Fall 2027'], results, finishedAt: new Date().toISOString(), errors: [] });
async function fixture(options = {}) {
  const root = resolve('output/test-runs', randomUUID()); await mkdir(root, { recursive: true });
  let now = new Date('2026-09-29T13:00:00Z'), count = 0;
  const config = { root, clock: () => now, discover: async () => { count++; return report(); }, ...options };
  const runner = new DiscoveryRunner(config); await runner.ready;
  return { root, runner, config, setTime: date => { now = new Date(date); }, count: () => count };
}
async function finish(runner, trigger = 'scheduled') { const result = await runner.start(trigger); await runner.pending; return result; }

test('a refresh during final ledger persistence waits, then starts a new run instead of returning old results', async () => {
  let release, reached;
  const atCommit = new Promise(r => { reached = r; });
  let hold = true;
  const f = await fixture({ save: async (path, value) => {
    if (hold && path.endsWith('runs.json') && value.runs.at(-1)?.status === 'done') {
      hold = false; reached(); await new Promise(r => { release = r; });
    }
    await atomicJson(path, value);
  } });
  const first = await f.runner.start('manual'); await atCommit;
  assert.equal(f.runner.search.state, 'done');
  f.setTime('2026-09-30T13:00:00Z'); // Outside the normal five-minute result cache.
  const refresh = f.runner.start('manual');
  release();
  const next = await refresh; await f.runner.pending;
  assert.notEqual(next.runId, first.runId);
  assert.equal(f.count(), 2);
  const disk = JSON.parse(await readFile(f.runner.file, 'utf8'));
  assert.equal(disk.runId, next.runId);
  assert.equal(f.runner.info().runs.filter(r => r.status === 'done').length, 2);
});

test('Toronto 09:00 follows DST including transition days', () => {
  assert.equal(scheduledAt('2026-09-29'), '2026-09-29T13:00:00.000Z');
  assert.equal(scheduledAt('2026-11-01'), '2026-11-01T14:00:00.000Z');
  assert.equal(scheduledAt('2027-03-14'), '2027-03-14T13:00:00.000Z');
});
test('before 09:00 skips, successful day survives restart, multi-day outage catches only current day', async () => {
  const f = await fixture(); f.setTime('2026-09-29T12:59:00Z');
  assert.equal((await finish(f.runner)).skipped, true);
  f.setTime('2026-09-29T13:00:00Z'); await finish(f.runner); assert.equal(f.count(), 1);
  const restart = new DiscoveryRunner(f.config); await restart.ready;
  assert.equal((await finish(restart)).skipped, true);
  f.setTime('2026-10-03T19:00:00Z'); await finish(restart);
  assert.equal(f.count(), 2); assert.equal(restart.info().runs[0].catchUp, true);
  assert.equal(restart.info().runs[0].day, '2026-10-03'); assert.equal(restart.info().runs.length, 2);
});
test('concurrent manual and scheduler callers share one in-flight run', async () => {
  let release, count = 0;
  const f = await fixture({ discover: async () => { count++; await new Promise(r => { release = r; }); return report(); } });
  const first = await f.runner.start('manual'); const second = await f.runner.start('scheduled');
  assert.equal(first.runId, second.runId); assert.equal(count, 1);
  release(); await f.runner.pending; assert.equal((await f.runner.start('scheduled')).skipped, true);
});
test('offline checks do not consume search attempts and resume once network returns', async () => {
  let online = false; const f = await fixture({ online: async () => online });
  assert.equal((await finish(f.runner)).waiting, true); assert.equal(f.count(), 0);
  assert.match(f.runner.info().waiting, /网络/); assert.equal(f.runner.info().runs.length, 0);
  f.setTime('2026-09-29T13:05:00Z'); online = true; await finish(f.runner);
  assert.equal(f.count(), 1); assert.equal(f.runner.info().waiting, null);
});
test('failed fetch preserves disk and displayed snapshot; automatic retries are bounded, manual retry remains available', async () => {
  let fail = false; const f = await fixture({ discover: async () => { if (fail) throw new Error('Source offline'); return report(); } });
  await finish(f.runner); const snapshot = await readFile(f.runner.file, 'utf8'); fail = true;
  f.setTime('2026-09-30T13:00:00Z'); await finish(f.runner);
  assert.equal(f.runner.search.state, 'error'); assert.deepEqual(f.runner.search.report, JSON.parse(snapshot));
  assert.equal(await readFile(f.runner.file, 'utf8'), snapshot);
  assert.equal((await finish(f.runner)).skipped, true);
  f.setTime('2026-09-30T13:15:00Z'); await finish(f.runner);
  f.setTime('2026-09-30T13:30:00Z'); await finish(f.runner);
  f.setTime('2026-09-30T14:30:00Z'); assert.equal((await finish(f.runner)).skipped, true);
  fail = false; await finish(f.runner, 'manual'); assert.equal(f.runner.search.state, 'done');
});
test('partial result has explicit source errors and first baseline differs from zero new jobs', async () => {
  const f = await fixture({ discover: async () => ({ ...report(), partial: true, errors: ['Synthetic source failed'] }) });
  await finish(f.runner); assert.equal(f.runner.info().runs[0].status, 'partial');
  assert.equal(f.runner.info().runs[0].added, null);
  f.setTime('2026-09-30T13:00:00Z'); await finish(f.runner);
  assert.equal(f.runner.info().runs[0].added, 0);
  assert.deepEqual(f.runner.info().runs[0].errors, ['Synthetic source failed']);
});
test('restart marks interrupted run; committed snapshot reconciles crash without a duplicate search', async () => {
  const f = await fixture();
  const run = { id: 'crash', day: '2026-09-29', trigger: 'scheduled', status: 'running', startedAt: '2026-09-29T13:00:00Z' };
  await atomicJson(f.runner.stateFile, { runs: [run], lastSuccessDay: null });
  const interrupted = new DiscoveryRunner(f.config); await interrupted.ready;
  assert.equal(interrupted.info().runs[0].status, 'interrupted');
  await atomicJson(f.runner.stateFile, { runs: [run], lastSuccessDay: null });
  await atomicJson(f.runner.file, { ...report(), runId: 'crash' });
  const committed = new DiscoveryRunner(f.config); await committed.ready;
  assert.equal(committed.info().runs[0].status, 'done'); assert.equal((await finish(committed)).skipped, true);
});
test('snapshot disk failure retains previous results and records failure', async () => {
  let fail = false; const f = await fixture({ save: async (path, value) => { if (fail && path.endsWith('latest.json')) throw new Error('Disk full'); await atomicJson(path, value); } });
  await finish(f.runner); const before = f.runner.search.report; fail = true;
  f.setTime('2026-09-30T13:00:00Z'); await finish(f.runner);
  assert.equal(f.runner.search.report, before); assert.match(f.runner.info().runs[0].error, /Disk full/);
});
test('corrupt run ledger stops automation rather than forgetting daily deduplication', async () => {
  const f = await fixture(); await mkdir(resolve(f.root, 'output/discovery'), { recursive: true }); await writeFile(f.runner.stateFile, 'broken');
  const restart = new DiscoveryRunner(f.config); await restart.ready;
  assert.equal(restart.info().broken, true); await assert.rejects(restart.start(), /运行记录/);
});
test('failure to persist the start prevents a search and never leaves a phantom running job', async () => {
  let count = 0;
  const f = await fixture({ discover: async () => { count++; return report(); }, save: async () => { throw new Error('Disk unavailable'); } });
  await assert.rejects(f.runner.start('scheduled'), /Disk unavailable/);
  assert.equal(count, 0); assert.equal(f.runner.info().runs[0].status, 'failed');
  assert.equal(f.runner.info().broken, true); assert.equal(f.runner.pending, null);
});
test('automation endpoints enforce CSRF and demo boundaries, paused tasks skip; Gateway errors do not report success', async t => {
  const f = await fixture(); let enabled = false, fail = false, count = 0;
  const server = dashboardServer({ root: f.root, clock: f.config.clock, onlineImpl: async () => true,
    discoverImpl: async () => { count++; return report(); }, automationImpl: {
      status: async () => ({ connected: true, enabled }), setEnabled: async value => { if (fail) throw new Error('Gateway unavailable'); enabled = value; return { enabled }; }
    } });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => new Promise(r => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const { csrf } = await (await fetch(base + '/api/status')).json();
  const post = (path, body = {}, token = csrf) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: JSON.stringify(body) });
  assert.equal((await post('/api/automation/tick', {}, 'bad')).status, 403);
  assert.equal((await post('/api/automation/enabled?mode=demo', { enabled: true })).status, 400);
  assert.equal((await (await post('/api/automation/tick')).json()).skipped, true); assert.equal(count, 0);
  await post('/api/automation/enabled', { enabled: true }); await post('/api/automation/tick');
  for (let n = 0; n < 20 && !count; n++) await new Promise(r => setTimeout(r, 10));
  assert.equal(count, 1); fail = true;
  assert.equal((await post('/api/automation/enabled', { enabled: false })).status, 400); assert.equal(enabled, true);
});
test('run summary escapes hostile source errors and identifies catch-up versus manual', () => {
  const html = automationView({ schedule: { connected: true, enabled: true }, runs: [{ id: '<script>', status: 'failed', trigger: 'scheduled', catchUp: true, startedAt: '2026-09-29T14:00:00Z', error: '<img src=x onerror=bad>' }] });
  assert.ok(!html.includes('<img')); assert.match(html, /当天补跑/); assert.match(html, /&lt;script&gt;/);
});
