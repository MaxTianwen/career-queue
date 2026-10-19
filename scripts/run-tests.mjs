import {spawn} from 'node:child_process';
import {readdir, rm} from 'node:fs/promises';
import {resolve} from 'node:path';

// Runs node:test, then removes only the output/test-runs entries created by this run.
// Artifacts are kept when tests fail or are interrupted, or when CQ_KEEP_TEST_ARTIFACTS=1.
const runs = resolve('output/test-runs');
const list = async () => new Set(await readdir(runs).catch(() => []));
const serial = process.argv.includes('--serial');
const before = await list();
const child = spawn(process.execPath, ['--test', ...(serial ? ['--test-concurrency=1'] : []), 'test/*.test.mjs'], {stdio: 'inherit'});
const forward = signal => child.kill(signal);
process.on('SIGINT', forward);
process.on('SIGTERM', forward);
const [code, signal] = await new Promise(done => child.on('exit', (...result) => done(result)));
const created = [...await list()].filter(name => !before.has(name));
if (code === 0 && !signal && process.env.CQ_KEEP_TEST_ARTIFACTS !== '1') {
  const failed = (await Promise.all(created.map(name => rm(resolve(runs, name), {recursive: true, force: true, maxRetries: 3}).then(() => null, () => name)))).filter(Boolean);
  console.log(`test-runs: removed ${created.length - failed.length} of ${created.length} new entries${failed.length ? `; could not remove ${failed.length} (locked files)` : ''}`);
} else if (created.length) console.log(`test-runs: kept ${created.length} new entries under output/test-runs`);
process.exitCode = signal ? 1 : code;
