import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const windows = process.platform === 'win32';
const run = promisify(execFile);
const host = resolve(process.env.SystemRoot || 'C:/Windows', 'System32/wscript.exe');
const launcher = resolve('scripts/run-background.vbs');

test('hidden task launcher waits for its child and preserves paths with spaces and Unicode', { skip: !windows }, async () => {
  const root = resolve('output/test-runs', randomUUID(), '后台 with spaces');
  await mkdir(root, { recursive: true });
  const script = resolve(root, 'child script.mjs'), marker = resolve(root, 'completed.txt');
  await writeFile(script, `import { writeFile } from 'node:fs/promises';
await new Promise(r => setTimeout(r, 300));
await writeFile(${JSON.stringify(marker)}, 'completed');
process.exitCode = 7;
`);
  await assert.rejects(run(host, ['//B', '//Nologo', launcher, process.execPath, script], { windowsHide: true, timeout: 10000 }), error => error.code === 7);
  assert.equal(await readFile(marker, 'utf8'), 'completed');
});

test('hidden task launcher reports missing arguments and a missing executable as failures', { skip: !windows }, async () => {
  for (const args of [[], [resolve('output', randomUUID(), 'missing.exe'), 'unused.mjs']]) {
    await assert.rejects(run(host, ['//B', '//Nologo', launcher, ...args], { windowsHide: true, timeout: 10000 }), error => error.code === 1);
  }
});
