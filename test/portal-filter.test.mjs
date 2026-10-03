import test from 'node:test';
import assert from 'node:assert/strict';
import { portalDiscovery, previewPortal } from '../src/portal.mjs';
import { portalFilterGroup, applyPortalFilter } from '../web/portal-import.js';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const school = { id: 'S123', company: 'Example', title: 'Software Intern', requisitionId: 'R1', term: 'Summer 2027', location: 'Toronto' };
const job = { ...school, key: 'job1', url: 'https://example.com/jobs/R1', fullJd: true };
const report = { finishedAt: '2026-10-02T20:00:00Z', sources: [{ name: 'Example', status: 'complete' }], results: [job] };
const item = (search = report, records = [], row = school) => ({ ...previewPortal([row], records)[0], discovery: portalDiscovery(row, search) });

test('existing application linkage is independent of official discovery', () => {
  const unlinked = item();
  assert.equal(unlinked.category, 'unmatched');
  assert.equal(portalFilterGroup(unlinked).key, 'found');
  const linked = item({ ...report, results: [] }, [{ ...job, portal: { id: school.id } }]);
  assert.equal(linked.category, 'linked');
  assert.equal(portalFilterGroup(linked).key, 'not-found');
  assert.match(portalFilterGroup(linked).reason, /不代表岗位关闭/);
});

test('unknown search, incomplete sources and uncovered employers need review, not a false absence', () => {
  for (const [search, status] of [[null, 'not-searched'], [{ ...report, results: [], sources: [{ name: 'Example', status: 'failed' }] }, 'source-incomplete'], [{ ...report, results: [], sources: [] }, 'source-uncovered']]) {
    const result = item(search);
    assert.equal(result.discovery.status, status);
    assert.equal(portalFilterGroup(result).key, 'review');
  }
  assert.equal(portalFilterGroup({ ...item(), discovery: undefined }).key, 'review');
  assert.equal(portalFilterGroup({ ...item(), discovery: { candidates: [] } }).key, 'review');
});

test('prefiltered, expired, excluded and incomplete JD candidates remain reviewable', () => {
  for (const [search, code] of [
    [{ ...report, results: [], filteredJobs: [job] }, 'prefiltered'],
    [{ ...report, results: [{ ...job, deadline: '2020-01-01' }] }, 'expired'],
    [{ ...report, results: [{ ...job, decision: 'REJECT' }] }, 'excluded'],
    [{ ...report, results: [{ ...job, fullJd: false, fetchError: 'HTTP 503' }] }, 'incomplete']
  ]) {
    const result = item(search);
    assert.equal(result.discovery.candidates[0].stateCode, code);
    assert.equal(portalFilterGroup(result).key, 'review');
  }
});

test('field errors, multiple candidates, conflicting IDs and school IDs cannot look resolved', () => {
  assert.equal(portalFilterGroup(previewPortal([{ ...school, id: '' }], [])[0]).key, 'review');
  assert.equal(portalFilterGroup(item({ ...report, results: [job, { ...job, requisitionId: 'R2' }] })).key, 'review');
  assert.equal(portalFilterGroup(item({ ...report, results: [{ ...job, location: 'Ottawa' }] })).key, 'review');
  assert.equal(portalFilterGroup({ ...item(), relatedSchoolIds: ['S999'] }).key, 'review');
  assert.equal(portalFilterGroup(item(report, [{ ...job, term: 'Winter 2027' }])).key, 'review');
});

// Minimal DOM stand-in: verify hiding never reconstructs or renumbers rows.
function fixture(items) {
  const nodes = new Map();
  for (const item of items) {
    const checkbox = item.row ? { checked: false } : null;
    nodes.set(`[data-school-index="${item.index}"]`, { hidden: false, checkbox, target: 'kept target', open: true, querySelector: () => checkbox });
  }
  for (const name of ['school-filter-count', 'school-filter-empty', 'school-selection-count', 'school-clear-filter']) nodes.set('#' + name, {});
  const buttons = ['all', 'not-found', 'review'].map(key => ({ dataset: { schoolFilter: key }, setAttribute(name, value) { this[name] = value; } }));
  return { nodes, buttons, querySelector: key => nodes.get(key), querySelectorAll: () => buttons };
}

test('filtering preserves hidden checked rows, targets, expansion and original non-contiguous indices', () => {
  const items = [{ ...item(), index: 2 }, { ...item({ ...report, results: [] }), index: 8 }, { index: 11, category: 'invalid' }];
  const root = fixture(items), found = root.querySelector('[data-school-index="2"]');
  found.checkbox.checked = true;
  root.querySelector('[data-school-index="8"]').checkbox.checked = true;
  assert.deepEqual(applyPortalFilter(root, items, 'not-found'), { visible: 1, selected: 2, hiddenSelected: 1 });
  assert.equal(found.hidden, true); assert.equal(found.target, 'kept target'); assert.equal(found.open, true);
  assert.match(root.querySelector('#school-selection-count').textContent, /2 条.*1 条/);
  assert.deepEqual(applyPortalFilter(root, items, 'review'), { visible: 1, selected: 2, hiddenSelected: 2 });
  assert.deepEqual(applyPortalFilter(root, items, 'all'), { visible: 3, selected: 2, hiddenSelected: 0 });
  assert.equal(found.checkbox.checked, true); assert.equal(root.querySelector('#school-clear-filter').disabled, true);
  assert.equal(root.buttons[0]['aria-pressed'], 'true');
});

test('empty filtered view still counts hidden selections and clears without losing them', () => {
  const items = [item()], root = fixture(items);
  root.querySelector('[data-school-index="0"]').checkbox.checked = true;
  assert.deepEqual(applyPortalFilter(root, items, 'review'), { visible: 0, selected: 1, hiddenSelected: 1 });
  assert.equal(root.querySelector('#school-filter-empty').hidden, false);
  assert.equal(root.querySelector('#school-clear-filter').disabled, false);
  applyPortalFilter(root, items, 'all');
  assert.equal(root.querySelector('#school-filter-empty').hidden, true);
  assert.equal(root.querySelector('[data-school-index="0"]').checkbox.checked, true);
});

const source = readFileSync(new URL('../web/portal-import.js', import.meta.url), 'utf8');
const submit = source.slice(source.indexOf("  host.addEventListener('submit'"), source.indexOf('  // Changes to the pasted input'));
function saveFixture() {
  let handler, payload, reject;
  const inputs = [2, 8].map(index => ({ dataset: { choice: String(index) }, checked: true, disabled: false }));
  const button = { disabled: false }, textarea = { disabled: false }, clear = { disabled: true };
  const host = { dataset: {}, addEventListener: (_, fn) => { handler = fn; }, querySelector: () => textarea,
    querySelectorAll: () => [...inputs, button, textarea, clear] };
  const error = {}, result = { innerHTML: 'original form with hidden selected row' };
  const form = { id: 'school-save-form', querySelectorAll: () => inputs, querySelector: selector => ({ value: selector.includes('2') ? 'job-2' : '__new__' }) };
  runInNewContext(submit, { host, error, result, preview: { token: 'preview-token' },
    api: async (path, body) => { payload = { path, body }; return new Promise((_, fail) => { reject = fail; }); } });
  return { host, inputs, button, clear, error, result, send: () => handler({ target: form, submitter: button, preventDefault() {}, stopPropagation() {} }), payload: () => payload, fail: () => reject(new Error('Synthetic connection failure')) };
}

test('save includes hidden selections at original indices and locks controls until a failed request settles', async () => {
  const f = saveFixture(), pending = f.send();
  assert.deepEqual(JSON.parse(JSON.stringify(f.payload())), { path: '/api/portal/link', body: { token: 'preview-token', confirmed: true, selections: [{ index: 2, key: 'job-2' }, { index: 8, key: '__new__' }] } });
  assert.ok(f.inputs.every(input => input.disabled)); assert.equal(f.button.disabled, true);
  await f.send(); // Busy submit is ignored, with the first payload still intact.
  f.fail(); await pending;
  assert.equal(f.error.textContent, 'Synthetic connection failure');
  assert.equal(f.result.innerHTML, 'original form with hidden selected row');
  assert.ok(f.inputs.every(input => input.checked && !input.disabled));
  assert.equal(f.button.disabled, false); assert.equal(f.clear.disabled, true);
});

test('retry after a failed save sends the same explicit selections without reindexing', async () => {
  const f = saveFixture(), first = f.send(); f.fail(); await first;
  const before = JSON.stringify(f.payload());
  const retry = f.send(); assert.equal(JSON.stringify(f.payload()), before);
  f.fail(); await retry;
  assert.equal(f.host.dataset.busy, undefined);
});
