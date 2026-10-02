import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const app = await readFile(new URL('../web/app.js', import.meta.url), 'utf8');
const submit = app.slice(app.indexOf("document.addEventListener('submit', async event => {"), app.indexOf('\nrender();', app.indexOf("document.addEventListener('submit', async event => {")));
function fixture({ id = 'notes-form', anotherDirty = false, refreshFails = false, readFails = false } = {}) {
  let handler, writes = 0, refreshes = 0, reads = 0, otherFeedback = 0;
  const pending = [], messages = [], notices = [];
  const other = { inert: false };
  const dialog = { dataset: { dirty: 'true', state: 'ready' }, querySelectorAll: () => [form, other], querySelector: () => anotherDirty ? other : null };
  const form = { id, dataset: { dirty: 'true' }, inert: false, isConnected: true, elements: {}, classList: { contains: () => false }, closest: () => dialog, getAttribute: () => id, nextElementSibling: { append() {} } };
  const button = { textContent: '保存', disabled: false, isConnected: true };
  const context = { source: 'queue', key: 'job', job: { key: 'job' } };
  const document = { addEventListener: (_, fn) => { handler = fn; }, createElement: () => ({ dataset: {}, setAttribute() {} }) };
  const state = runInNewContext(`let selected={key:'job'}, jobs=[{key:'job'}], detailContext=context, view='queue'; ${submit}; ({selected:()=>selected,jobs:()=>jobs})`, {
    document, context, FormData: class { *[Symbol.iterator]() { yield ['notes', 'kept input']; yield ['nextStep', 'follow up']; } },
    $: selector => selector === '#detail' ? dialog : { prepend: box => notices.push(box.textContent) },
    api: () => { writes++; return new Promise((resolve, reject) => pending.push({ resolve, reject })); },
    formFeedback: (_, message, kind) => messages.push({ message, kind }),
    detailNotice: message => notices.push(message),
    refresh: async () => { refreshes++; if (refreshFails) throw Error('read unavailable'); },
    detail: async () => { reads++; form.isConnected = false; dialog.dataset.state = readFails ? 'failed' : 'ready'; return !readFails; },
    render() {}, renderSearch() {}, dialogError: () => { otherFeedback++; }
  });
  return { ...state, form, other, button, dialog, pending, messages, notices,
    counts: () => ({ writes, refreshes, reads, otherFeedback }),
    save: () => handler({ preventDefault() {}, target: form, submitter: button }) };
}

test('notes save stays in the detail, updates the list and clears only its own dirty state', async () => {
  const f = fixture(), saving = f.save();
  assert.equal(f.form.inert, true); assert.equal(f.other.inert, true); assert.equal(f.button.disabled, true);
  assert.equal(f.messages.at(-1).kind, 'saving');
  f.pending[0].resolve({}); await saving;
  assert.equal(f.selected().notes, 'kept input'); assert.equal(f.jobs()[0].nextStep, 'follow up');
  assert.equal(f.dialog.dataset.dirty, undefined); assert.equal(f.form.isConnected, true);
  assert.equal(f.form.inert, false); assert.equal(f.button.textContent, '保存');
  assert.deepEqual(f.counts(), { writes: 1, refreshes: 0, reads: 0, otherFeedback: 0 });
});
test('saving notes preserves protection for another edited form', async () => {
  const f = fixture({ anotherDirty: true }), saving = f.save(); f.pending[0].resolve({}); await saving;
  assert.equal(f.form.dataset.dirty, undefined); assert.equal(f.dialog.dataset.dirty, 'true');
});
test('repeated submission during a pending save cannot issue a second write', async () => {
  const f = fixture(), saving = f.save(); await f.save(); assert.equal(f.counts().writes, 1);
  f.pending[0].resolve({}); await saving;
});
test('failed save keeps inputs and dirty protection, unlocks retry and does not refresh', async () => {
  const f = fixture(), saving = f.save(); f.pending[0].reject(Error('offline')); await saving;
  assert.equal(f.form.isConnected, true); assert.equal(f.form.dataset.dirty, 'true');
  assert.equal(f.dialog.dataset.dirty, 'true'); assert.equal(f.form.inert, false); assert.equal(f.button.disabled, false);
  assert.match(f.messages.at(-1).message, /输入已保留/); assert.equal(f.messages.at(-1).kind, 'error');
  const retry = f.save(); f.pending[1].resolve({}); await retry;
  assert.equal(f.selected().notes, 'kept input'); assert.equal(f.counts().refreshes, 0);
});
test('successful state write with failed list refresh locks the stale form and offers a read retry', async () => {
  const f = fixture({ id: 'progress-form', refreshFails: true }), saving = f.save();
  f.pending[0].resolve({}); await saving;
  assert.equal(f.form.inert, true); assert.equal(f.dialog.dataset.saving, undefined);
  assert.match(f.messages.at(-1).message, /已保存.*重新读取/); assert.equal(f.counts().writes, 1);
});
test('successful write followed by failed detail read explicitly reports the saved result', async () => {
  const f = fixture({ id: 'progress-form', readFails: true }), saving = f.save();
  f.pending[0].resolve({}); await saving;
  assert.equal(f.dialog.dataset.state, 'failed'); assert.ok(f.notices.some(text => /更改已保存.*无需再次提交/.test(text)));
  assert.equal(f.counts().writes, 1); assert.equal(f.counts().otherFeedback, 0);
});
