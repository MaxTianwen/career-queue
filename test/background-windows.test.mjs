import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { openclawArgs } from '../src/automation.mjs';

const exec = promisify(execFile);
const guard = resolve('scripts/hide-background-windows.cjs');

test('background OpenClaw entry adds the preload without changing CLI arguments', () => {
  const root = resolve('output/with spaces');
  const args = ['automations', 'list', '--json'];
  assert.deepEqual(openclawArgs(root, args), ['--require', resolve(root, 'scripts/hide-background-windows.cjs'),
    resolve(root, 'private/openclaw-runtime/node_modules/openclaw/openclaw.mjs'), ...args]);
  assert.deepEqual(args, ['automations', 'list', '--json']);
});

test('background protection covers CJS and ESM spawn and preserves caller options', { skip: process.platform !== 'win32' }, async () => {
  const { stdout } = await exec(process.execPath, ['--input-type=module', '-e', `
    import { createRequire } from 'node:module';
    import assert from 'node:assert/strict';
    const require = createRequire(import.meta.url);
    const cp = require('node:child_process');
    const calls = [];
    cp.spawn = (...args) => { calls.push(args); return 'child'; };
    require(${JSON.stringify(guard)});
    const esm = await import('node:child_process');
    const options = { cwd: 'example', stdio: ['ignore', 'pipe', 'pipe'], env: { TEST: 'value' } };
    assert.equal(cp.spawn('node.exe', ['worker.js'], options), 'child');
    esm.spawn('node.exe', options);
    cp.spawn('node.exe');
    cp.spawn('node.exe', [], { windowsHide: false });
    for (const call of calls) assert.equal(call[2].windowsHide, true);
    assert.deepEqual(calls[0][2], { ...options, windowsHide: true });
    assert.deepEqual(calls[1][2], { ...options, windowsHide: true });
    assert.deepEqual(calls[1][1], []);
    assert.equal(options.windowsHide, undefined);
    console.log('ok');
  `], { windowsHide: true, timeout: 10000 });
  assert.equal(stdout.trim(), 'ok');
});

test('hidden native child preserves stdout, stderr and nonzero exit status', async () => {
  const { stdout, stderr } = await exec(process.execPath, ['--require', guard, '--input-type=module', '-e', `
    import { spawn } from 'node:child_process';
    const child = spawn(process.execPath, ['-e', 'console.log("child-out"); console.error("child-err"); process.exitCode=7'], { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
    child.on('exit', code => console.log('exit=' + code));
  `], { windowsHide: true, timeout: 10000 });
  assert.match(stdout, /child-out/);
  assert.match(stdout, /exit=7/);
  assert.match(stderr, /child-err/);
});
