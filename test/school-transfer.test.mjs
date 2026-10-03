import test from 'node:test';
import assert from 'node:assert/strict';
import { schoolCandidate, schoolAssociation, schoolRevision, transferSchoolAssociation } from '../src/school-candidates.mjs';
import { normalizeJob, newRecord } from '../src/core.mjs';
import { DemoStore } from '../src/demo-store.mjs';
import { schoolAssociationView } from '../web/school-association.js';

const row = { id: 'TEST-123', company: 'Synthetic Employer', title: 'Software Developer Co-op', term: 'Summer 2027', location: 'Toronto', deadline: '2027-01-01' };
async function setup() {
  const store = new DemoStore(); store.rows.clear();
  const source = { ...schoolCandidate(row, []), notes: 'School notes' };
  const target = newRecord(normalizeJob({ ...row, url: 'https://example.com/jobs/test', jd: 'Python required.', fullJd: true }));
  Object.assign(target, { notes: 'Employer notes', status: '已投递', applicationDate: '2026-10-01',
    materialVersion: { id: 'version-3' }, materials: { resume: 'saved-resume' }, externalSubmission: { receipt: 'saved-receipt' } });
  await store.create(source); await store.create(target);
  const input = { confirmed: true, targetKey: target.key, sourceRevision: schoolRevision(source), targetRevision: schoolRevision(target) };
  return { store, source, target, input };
}
test('preview is read-only; confirmed transfer preserves both histories and submitted target materials', async () => {
  const { store, source, target, input } = await setup();
  const preview = schoolAssociation(source, target.url + '?utm_source=test', await store.list());
  assert.deepEqual(preview.conflicts, []); assert.equal(preview.target.hasMaterials, true);
  assert.equal((await store.find(target.key)).portal, undefined);
  const result = await transferSchoolAssociation(store, source.key, input);
  assert.equal(result.targetKey, target.key);
  const saved = await store.find(target.key), archived = await store.find(source.key);
  for (const field of ['notes', 'status', 'materials', 'materialVersion', 'externalSubmission', 'applicationDate', 'jd']) assert.deepEqual(saved[field], target[field]);
  assert.equal(saved.portal.id, row.id); assert.equal(saved.portal.deadline, row.deadline);
  assert.equal(archived.status, '已归档'); assert.equal(archived.notes, source.notes); assert.equal(archived.portal, null);
  assert.equal(archived.portalHistory.at(-1).portal.id, row.id);
  assert.equal(schoolCandidate(row, await store.list()).key, target.key);
  const snapshot = await store.list(); await transferSchoolAssociation(store, source.key, input);
  assert.deepEqual(await store.list(), snapshot);
});
test('partial transfer can resume after process restart or lost response without double history', async () => {
  for (const lostResponse of [false, true]) {
    const { store, source, target, input } = await setup();
    const update = store.updateState.bind(store); let writes = 0;
    store.updateState = async record => {
      writes++;
      if (writes === (lostResponse ? 1 : 2)) {
        if (lostResponse) await update(record);
        throw new Error('Synthetic connection lost');
      }
      return update(record);
    };
    await assert.rejects(transferSchoolAssociation(store, source.key, input));
    assert.equal((await store.find(target.key)).portal.id, row.id);
    assert.equal((await store.find(source.key)).portal.id, row.id);
    const restarted = new DemoStore(); restarted.rows.clear();
    for (const r of await store.list()) await restarted.create(r);
    const historyLength = (await restarted.find(target.key)).portalHistory.length;
    await transferSchoolAssociation(restarted, source.key, input);
    assert.equal((await restarted.find(target.key)).portalHistory.length, historyLength);
    assert.equal((await restarted.find(source.key)).status, '已归档');
  }
});
test('first write failure leaves both records unchanged and retry succeeds', async () => {
  const { store, source, input } = await setup(), snapshot = await store.list();
  const update = store.updateState.bind(store); store.updateState = async () => { throw new Error('Synthetic failure'); };
  await assert.rejects(transferSchoolAssociation(store, source.key, input)); assert.deepEqual(await store.list(), snapshot);
  store.updateState = update; await transferSchoolAssociation(store, source.key, input);
});
test('partial transfer permits fresh preview after note edits but refuses changed school facts', async () => {
  for (const changeSchool of [false, true]) {
    const { store, source, target, input } = await setup();
    const update = store.updateState.bind(store);
    store.updateState = async record => { if (record.key === source.key) throw new Error('Synthetic failure'); return update(record); };
    await assert.rejects(transferSchoolAssociation(store, source.key, input));
    store.updateState = update;
    const current = await store.find(source.key); current.notes = 'Later saved notes';
    if (changeSchool) current.portal.deadline = '2027-02-01';
    await store.create(current);
    const retry = { ...input, sourceRevision: schoolRevision(current) };
    if (changeSchool) await assert.rejects(transferSchoolAssociation(store, source.key, retry), /学校信息已变化/);
    else {
      await transferSchoolAssociation(store, source.key, retry);
      assert.equal((await store.find(source.key)).notes, current.notes);
      assert.equal((await store.find(target.key)).portal.id, row.id);
    }
  }
});
test('conflicts, school submissions, original candidate materials and stale inputs block writes', async () => {
  for (const change of [
    ({ source }) => source.portal.status = 'submitted',
    ({ source }) => source.materials = { resume: 'one' },
    ({ source }) => source.attachments = [{ name: 'Notion attachment' }],
    ({ target }) => target.term = 'Winter 2027',
    ({ source, target }) => { source.portal.requisitionId = 'A'; target.requisitionId = 'B'; },
    ({ target }) => target.portal = { id: 'another-school-id', status: 'submitted' },
    ({ source }) => source.notes = 'Changed since preview',
    ({ target }) => target.notes = 'Changed since preview'
  ]) {
    const fixture = await setup(); change(fixture);
    await fixture.store.create(fixture.source); await fixture.store.create(fixture.target);
    const snapshot = await fixture.store.list();
    await assert.rejects(transferSchoolAssociation(fixture.store, fixture.source.key, fixture.input));
    assert.deepEqual(await fixture.store.list(), snapshot);
  }
});
test('confirmation and unique target are required; history capacity checked before either write', async () => {
  const { store, source, target, input } = await setup();
  await assert.rejects(transferSchoolAssociation(store, source.key, { ...input, confirmed: false }), /确认/);
  assert.throws(() => schoolAssociation(source, target.url, [source, target, { ...target, key: 'other' }]), /多条/);
  source.portalHistory = Array.from({ length: 30 }, () => ({ action: 'old' })); await store.create(source);
  const snapshot = await store.list();
  await assert.rejects(transferSchoolAssociation(store, source.key, { ...input, sourceRevision: schoolRevision(source) }), /历史/);
  assert.deepEqual(await store.list(), snapshot);
});
test('a subsequent confirmed association retains the earlier transfer source and school snapshot', async () => {
  const { store, source, target, input } = await setup();
  const previous = { sourceKey: 'prior-source', portal: { id: 'prior-school' } };
  target.schoolAssociationTransfer = previous; await store.create(target);
  await transferSchoolAssociation(store, source.key, { ...input, targetRevision: schoolRevision(target) });
  assert.deepEqual((await store.find(target.key)).schoolAssociationHistory, [previous]);
});
test('comparison escapes pasted text and renders no transfer action for a conflict', async () => {
  const { store, source, target } = await setup();
  const preview = schoolAssociation(source, target.url, await store.list());
  preview.source.notes = '<img src=x onerror=alert(1)>';
  assert.match(schoolAssociationView(preview), /&lt;img/);
  assert.match(schoolAssociationView(preview), /name="transfer"/);
  assert.doesNotMatch(schoolAssociationView({ ...preview, conflicts: ['批次不同'] }), /name="transfer"/);
});
