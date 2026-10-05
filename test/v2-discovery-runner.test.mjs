import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { WorkspaceStore } from '../src/v2/store.mjs';
import { CatalogueRunner } from '../src/v2/discovery-runner.mjs';
import { scheduledAt } from '../src/discovery-runner.mjs';

function fixture(t) {
  let time = Date.parse('2026-10-05T13:00:00Z'), calls = 0, online = true, failed = false;
  const store = new WorkspaceStore(resolve('output/test-runs', randomUUID(), 'workspace.sqlite'), { now: () => time }); t.after(() => store.close());
  const options = { configured: true, online: async () => online, discover: async () => { calls++; return { jobs: [], sources: [{ id: 'test', status: failed ? 'failed' : 'complete' }], finishedAt: new Date(time).toISOString() }; } };
  const runner = new CatalogueRunner(store, options); runner.setEnabled(true);
  return { store, runner, options, calls: () => calls, time: value => { time = value; }, advance: n => { time += n; }, online: value => { online = value; }, failed: value => { failed = value; } };
}
test('v2 daily discovery runs once per Toronto day, skips before 09:00 and catches up without old days', async t => {
  const f = fixture(t); f.advance(-1); assert.equal((await f.runner.start('scheduled')).skipped, true);
  f.advance(2 * 3600000); await f.runner.start('scheduled'); assert.equal(f.calls(), 1); assert.equal(f.runner.status().runs[0].catchUp, true);
  assert.equal((await f.runner.start('scheduled')).skipped, true);
  const restored = new CatalogueRunner(f.store, f.options); assert.equal((await restored.start('scheduled')).skipped, true);
  f.advance(3 * 86400000); await restored.start('scheduled'); assert.equal(f.calls(), 2);
  assert.equal(scheduledAt('2026-11-01'), '2026-11-01T14:00:00.000Z');
  assert.equal(scheduledAt('2026-03-08'), '2026-03-08T13:00:00.000Z');
});
test('v2 offline waiting does not consume attempts, failures retry at most three times, manual recovery counts today', async t => {
  const f = fixture(t); f.online(false); assert.equal((await f.runner.start('scheduled')).waiting, true); assert.equal(f.calls(), 0);
  f.online(true); f.failed(true); f.advance(5 * 60000);
  for (let i = 0; i < 3; i++) { await assert.rejects(f.runner.start('scheduled'), /搜索未完成/); f.advance(15 * 60000); }
  assert.equal((await f.runner.start('scheduled')).skipped, true); assert.equal(f.calls(), 3);
  f.failed(false); await f.runner.start('manual'); assert.equal(f.runner.status().lastSuccessDay, '2026-10-05');
});
test('v2 manual and automatic share a lock, pausing while offline check pending prevents new work', async t => {
  const f = fixture(t); let release; f.runner.online = () => new Promise(resolve => { release = resolve; });
  const pending = f.runner.start('scheduled'); await Promise.resolve();
  assert.throws(() => f.runner.start('manual'), /正在刷新/); f.runner.setEnabled(false); release(true);
  assert.equal((await pending).skipped, true); assert.equal(f.calls(), 0);
});
test('v2 catalogue and completion commit atomically and restart marks interrupted runs', async t => {
  const f = fixture(t), before = f.store.catalogue();
  f.store.db.exec("CREATE TRIGGER reject_catalogue BEFORE INSERT ON catalogue BEGIN SELECT RAISE(ABORT, 'synthetic disk failure'); END");
  await assert.rejects(f.runner.start('manual')); assert.deepEqual(f.store.catalogue(), before); assert.equal(f.runner.status().lastSuccessDay, null);
  assert.equal(f.runner.status().runs[0].status, 'failed');
  f.runner.state.runs[0].status = 'running'; f.runner.persist();
  const restored = new CatalogueRunner(f.store, f.options); assert.equal(restored.status().runs[0].status, 'interrupted');
  assert.equal((await restored.start('scheduled')).waiting, true);
});

test('v2 partial success keeps failed-source cache and storage failure stops further searches', async t => {
  const f = fixture(t);
  f.store.saveCatalogue({ jobs:[{id:'old',source:{id:'old-source'},jd:'old text'}],sources:[{id:'old-source',status:'complete'}],finishedAt:'old'});
  f.runner.discover = async () => ({jobs:[],sources:[{id:'new-source',status:'complete'},{id:'old-source',status:'failed'}],finishedAt:'new'});
  const result = await f.runner.start('scheduled'); assert.equal(result.jobs[0].stale,true); assert.equal(f.runner.status().runs[0].status,'partial');
  f.advance(86400000);
  f.store.db.exec("CREATE TRIGGER reject_ledger BEFORE UPDATE ON discovery_state BEGIN SELECT RAISE(ABORT, 'synthetic full disk'); END");
  await assert.rejects(f.runner.start('scheduled')); assert.equal(f.runner.status().broken,true);
  assert.throws(()=>f.runner.start('manual'),/运行记录异常/);
});
