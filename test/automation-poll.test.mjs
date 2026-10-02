import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { automationView } from '../web/automation-view.js';

// Exercise the actual page controller with deferred responses. This is not a
// browser/visual test; the small DOM stand-in only models replacement of panels.
const app = await readFile(new URL('../web/app.js', import.meta.url), 'utf8');
const controller = app.slice(app.indexOf('async function pollAutomation()'), app.indexOf('async function pollSearch()'));
const declarations = app.match(/^let automation\w* = .*;$/gm).join('\n');
const names = ['automation-history', 'automation-diagnostics'];
function fixture() {
  const pending = [], label = { textContent: '' };
  let html = '', panels = Object.fromEntries(names.map(name => [name, { open: false }]));
  const container = {
    get innerHTML() { return html; },
    set innerHTML(value) {
      html = value;
      panels = Object.fromEntries(names.filter(name => value.includes(`class="${name}"`)).map(name => [name, { open: false }]));
    }
  };
  const $ = selector => selector === '#automation' ? container : selector === '.local-label' ? label : panels[selector.split('.').at(-1)];
  const poll = runInNewContext(`${declarations}\n${controller}\npollAutomation`, {
    $, automationView, api: () => new Promise((resolve, reject) => pending.push({ resolve, reject }))
  });
  return { poll, pending, label, container, panel: name => panels[name] };
}
const info = enabled => ({ schedule: { connected: true, enabled, state: enabled ? 'enabled' : 'paused' },
  runs: [{ id: 'prior-success', status: 'done', finishedAt: '2026-09-29T13:00:00Z', count: 5 }] });

for (const fail of [false, true]) {
  test(`panel changes during a pending ${fail ? 'failed' : 'successful'} refresh are preserved independently`, async () => {
    const f = fixture();
    const first = f.poll(); f.pending[0].resolve(info(true)); await first;
    f.panel('automation-history').open = true;
    const next = f.poll();
    // The user closes history and opens diagnostics while the request is pending.
    f.panel('automation-history').open = false;
    f.panel('automation-diagnostics').open = true;
    if (fail) f.pending[1].reject(new Error('offline')); else f.pending[1].resolve(info(true));
    await next;
    assert.equal(f.panel('automation-history').open, false);
    assert.equal(f.panel('automation-diagnostics').open, true);
    assert.match(f.container.innerHTML, /上次完成搜索/);
    if (fail) assert.match(f.container.innerHTML, /automation-toggle" disabled/);
  });
}

for (const fail of [false, true]) {
  test(`late ${fail ? 'failure' : 'success'} cannot overwrite a newer confirmed schedule`, async () => {
    const f = fixture();
    const old = f.poll(), current = f.poll();
    f.pending[1].resolve(info(false)); await current;
    f.panel('automation-diagnostics').open = true;
    if (fail) f.pending[0].reject(new Error('old failure')); else f.pending[0].resolve(info(true));
    await old;
    assert.match(f.label.textContent, /已暂停/);
    assert.match(f.container.innerHTML, /自动发现已暂停/);
    assert.equal(f.panel('automation-diagnostics').open, true);
  });
}

test('a newer connection failure stays unverified even if an older healthy response arrives later', async () => {
  const f = fixture();
  const first = f.poll(); f.pending[0].resolve(info(true)); await first;
  const old = f.poll(), current = f.poll();
  f.pending[2].reject(new Error('offline')); await current;
  f.pending[1].resolve(info(true)); await old;
  assert.match(f.label.textContent, /连接待核实/);
  assert.match(f.container.innerHTML, /automation-toggle" disabled/);
  assert.match(f.container.innerHTML, /上次完成搜索/);
});
