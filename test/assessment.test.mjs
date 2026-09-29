import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { assessJob, assessmentSnapshot, jobInputHash, materialFreshness, availabilityState, requireAvailable } from '../src/assessment.mjs';
import { buildResumeProfile } from '../src/matching.mjs';
import { dashboardServer } from '../src/dashboard.mjs';
import { DemoStore } from '../src/demo-store.mjs';
import { complete } from '../src/pipeline.mjs';

const now = new Date('2026-09-29T12:00:00Z');
const sample = { company: 'Synthetic Company', title: 'Software Developer Intern', url: 'https://example.com/jobs/1',
  term: 'Summer 2027', location: 'Toronto, ON', jd: 'Required qualifications\nPython required.\nMust be enrolled in a degree program.', fullJd: true };
function profiles(version = 'v1') {
  return Object.fromEntries(['cs', 'data'].map(track => [track, buildResumeProfile(
    'Synthetic applicant built Python and SQL projects for a university course.',
    { track, name: `${track}.pdf`, version, sha256: `${track}-${version}` })]));
}

test('assessment identity follows JD and active resumes, not assessment time or unrelated notes', () => {
  const first = assessJob(sample, profiles(), now);
  const again = assessJob({ ...sample, notes: 'User reminder', status: '待提交' }, profiles(), new Date(now.getTime() + 1000));
  assert.equal(first.assessment.id, again.assessment.id);
  assert.notEqual(first.assessment.assessedAt, again.assessment.assessedAt);
  assert.equal(jobInputHash(sample), jobInputHash({ ...sample, notes: 'Different note' }));
  for (const changed of [{ ...sample, jd: sample.jd + '\nJava required.' }, { ...sample, deadline: '2027-02-01' }, { ...sample, fullJd: false }]) {
    assert.notEqual(assessJob(changed, profiles(), now).assessment.id, first.assessment.id);
  }
  assert.notEqual(assessJob(sample, profiles('v2'), now).assessment.id, first.assessment.id);
  const unavailable = profiles();
  unavailable.cs = { available: false, source: { track: 'cs' }, reason: 'Synthetic unreadable resume' };
  const result = assessJob(sample, unavailable, now);
  assert.notEqual(result.assessment.id, first.assessment.id);
  assert.equal(result.match.score, null);
});

test('material freshness distinguishes legacy, JD, resume, rule, and qualification changes', () => {
  const assessed = assessJob(sample, profiles(), now), material = assessmentSnapshot(sample, assessed);
  assert.deepEqual(materialFreshness(material, assessed.assessment), { status: 'current', reasons: [], needsReview: false });
  assert.equal(materialFreshness({}, assessed.assessment).status, 'unknown');
  for (const [field, value, reason] of [['jdHash', 'changed', /JD/], ['resumes', [], /简历/], ['ruleVersion', 'new-rule', /规则/], ['id', 'new-confirmation', /资格/]]) {
    const result = materialFreshness(material, { ...assessed.assessment, [field]: value });
    assert.equal(result.status, 'stale'); assert.equal(result.needsReview, true); assert.match(result.reasons[0], reason);
  }
  assert.equal(material.assessment.id, assessed.assessment.id);
  assert.equal(material.job.jd, sample.jd);
});

test('a manually selected Data resume produces Data evidence while retaining the same input identity', () => {
  const current = profiles();
  current.data = buildResumeProfile('Synthetic applicant builds SQL reports, with no experience with Python.',
    { track: 'data', name: 'data.pdf', version: 'v1', sha256: 'data-v1' });
  const automatic = assessJob(sample, current, now);
  const selected = assessJob(sample, current, now, 'data');
  assert.equal(automatic.resumeClassification.track, 'cs');
  assert.equal(automatic.match.source.track, 'cs');
  assert.equal(selected.assessment.id, automatic.assessment.id);
  assert.equal(selected.match.source.track, 'data');
  assert.equal(selected.eligibility.source.track, 'data');
  assert.equal(selected.eligibilityComparisons.length, 1);
  assert.equal(selected.match.score, 0);
  assert.ok(automatic.match.score > selected.match.score);
  const saved = assessmentSnapshot(sample, selected);
  assert.equal(saved.match.source.track, 'data');
  assert.equal(saved.eligibility.requirements.find(r => /Python/.test(r.quote)).status, 'not-demonstrated');
});

test('availability allows only a recent matching check and scopes manual confirmation to the exact check and JD', () => {
  const checkedAt = new Date(now.getTime() - 60000).toISOString();
  const checked = { ...sample, availability: { status: 'unknown', checkedAt, jdHash: jobInputHash(sample), evidence: 'Temporary outage' } };
  assert.throws(() => requireAvailable(checked, now), /暂无法确认/);
  checked.availability.manual = { checkedAt, jdHash: jobInputHash(sample), confirmedAt: now.toISOString(), note: 'Verified on the employer website' };
  assert.doesNotThrow(() => requireAvailable(checked, now));
  assert.equal(availabilityState(checked, now).manual, true);
  assert.throws(() => requireAvailable({ ...checked, jd: sample.jd + '\nSQL required.' }, now), /暂无法确认/);
  assert.throws(() => requireAvailable({ ...checked, availability: { ...checked.availability, checkedAt: now.toISOString() } }, now), /暂无法确认/);
  assert.throws(() => requireAvailable(checked, new Date(now.getTime() + 15 * 60000)), /暂无法确认/);
  assert.throws(() => requireAvailable({ ...checked, availability: { ...checked.availability, checkedAt: new Date(now.getTime() + 1000).toISOString() } }, now), /暂无法确认/);
  assert.doesNotThrow(() => requireAvailable({ ...checked, availability: { ...checked.availability, status: 'open', manual: undefined } }, now));
});

test('explicit closure and elapsed deadline cannot be bypassed by an earlier manual confirmation', () => {
  const checkedAt = new Date(now.getTime() - 30 * 60000).toISOString();
  const job = { ...sample, availability: { status: 'closed', checkedAt, jdHash: jobInputHash(sample),
    manual: { checkedAt, jdHash: jobInputHash(sample) }, evidence: 'Employer explicitly closed posting' } };
  assert.equal(availabilityState(job, now).status, 'closed');
  assert.throws(() => requireAvailable(job, now), /已关闭或截止/);
  const expired = { ...sample, deadline: '2026-09-28', availability: { status: 'open', checkedAt: now.toISOString() } };
  assert.equal(availabilityState(expired, now).status, 'closed');
  assert.throws(() => requireAvailable(expired, now), /已关闭或截止/);
});

async function setup(t, { discovery = false } = {}) {
  const root = resolve('output/test-runs', randomUUID()), store = new DemoStore();
  await mkdir(root, { recursive: true });
  await writeFile(resolve(root, 'career_knowledge_base.md'), '# Synthetic test facts only');
  const key = (await store.list())[0].key;
  await store.updateState({ ...await store.find(key), jd: sample.jd, fullJd: true });
  let discoveryRows = [await store.find(key)];
  const discoveryReport = () => ({ finishedAt: new Date(Date.now() - 6 * 60000).toISOString(), results: structuredClone(discoveryRows),
    dataVersion: 4, targetTerms: ['Winter 2027', 'Summer 2027', 'Fall 2027'] });
  if (discovery) {
    await mkdir(resolve(root, 'output/discovery'), { recursive: true });
    await writeFile(resolve(root, 'output/discovery/latest.json'), JSON.stringify(discoveryReport()));
  }
  let activeProfiles = profiles(), result = { status: 'unknown', evidence: 'Synthetic maintenance response' }, calls = 0;
  const server = dashboardServer({ root, storeOverride: store, profilesImpl: async () => activeProfiles,
    discoverImpl: async () => discoveryReport(),
    availabilityImpl: async job => ({ ...result, sourceUrl: job.url, checkedAt: new Date(Date.now() - 10000 + ++calls * 100).toISOString() }) });
  let url, csrf;
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${server.address().port}`;
    try { csrf = (await (await fetch(url + '/api/status')).json()).csrf; break; }
    catch (error) {
      await new Promise(r => server.close(r));
      if (error.cause?.message !== 'bad port' || attempt === 9) throw error;
    }
  }
  t.after(() => new Promise(r => server.close(r)));
  const request = async (path, body) => {
    const res = await fetch(url + path, body === undefined ? {} : { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(body) });
    return { status: res.status, data: await res.json() };
  };
  return { root, store, key, request, setProfiles: value => { activeProfiles = value; }, setCheck: value => { result = value; },
    setDiscovery: value => { discoveryRows = value; }, calls: () => calls };
}

test('upload races cannot replace reviewed materials after JD or qualification evidence changes', async t => {
  for (const kind of ['jd', 'qualification']) await t.test(kind, async () => {
    const root = resolve('output/test-runs', randomUUID()), store = new DemoStore();
    await mkdir(root, { recursive: true });
    const resume = resolve(root, 'resume.pdf');
    await writeFile(resume, '%PDF-1.7 Synthetic signature fixture');
    const first = (await store.list())[0], existing = { ...first, status: kind === 'jd' ? 'Queue' : '待提交',
      materials: kind === 'jd' ? null : { resume: 'original-reviewed.pdf' }, materialVersion: { version: 'original-version' } };
    await store.updateState(existing);
    const assessment = assessJob(existing, profiles()).assessment;
    let uploads = 0;
    store.upload = async () => {
      uploads++;
      const changed = kind === 'jd' ? { jd: existing.jd + '\nA newly added required qualification.' }
        : { eligibilityConfirmations: [{ requirementId: 'new-confirmation', jdHash: jobInputHash(existing), outcome: 'conflict',
          note: 'Synthetic concurrent user update', confirmedAt: new Date().toISOString() }] };
      await store.updateState({ ...await store.find(existing.key), ...changed });
      return { demo: true };
    };
    await assert.rejects(complete(store, existing.key, { resume }, true, { version: 'new-version', assessment }), /变化|核对/);
    const after = await store.find(existing.key);
    assert.equal(uploads, 1);
    assert.equal(after.status, existing.status);
    assert.deepEqual(after.materials, existing.materials);
    assert.deepEqual(after.materialVersion, existing.materialVersion);
    if (kind === 'jd') assert.notEqual(after.jd, existing.jd);
    else assert.equal(after.eligibilityConfirmations[0].note, 'Synthetic concurrent user update');
  });
});

test('discovery refresh preserves same-JD human evidence and discards it when the JD changes', async t => {
  const { root, store, key, request, setDiscovery } = await setup(t, { discovery: true });
  const first = (await request(`/api/assessment?source=discovery&key=${key}`)).data;
  const requirement = first.eligibility.requirements.find(r => /degree/.test(r.quote));
  const qualified = await request('/api/assessment/eligibility', { source: 'discovery', key, assessmentId: first.assessment.id,
    requirementId: requirement.id, confirmed: true, outcome: 'met', note: 'Synthetic enrollment confirmation' });
  assert.equal(qualified.status, 200);
  const check = (await request('/api/assessment/recheck', { source: 'discovery', key })).data;
  assert.equal((await request('/api/assessment/confirm', { source: 'discovery', key, assessmentId: check.assessment.id,
    checkedAt: check.availabilityView.checkedAt, confirmed: true, note: 'Synthetic open posting confirmation' })).status, 200);
  const saved = JSON.parse(await readFile(resolve(root, 'output/discovery/latest.json'), 'utf8')).results[0];
  assert.equal((await store.find(key)).availability, undefined);
  const refresh = async () => {
    assert.equal((await request('/api/discovery', {})).status, 202);
    for (let attempt = 0; attempt < 100; attempt++) {
      const result = (await request('/api/discovery')).data;
      if (result.state === 'done') return result.report.results[0];
      if (result.state === 'error') throw new Error(result.error);
      await new Promise(r => setTimeout(r, 5));
    }
    throw new Error('Synthetic discovery refresh did not complete');
  };
  const same = await refresh();
  assert.equal(same.availabilityView.manual, true);
  assert.deepEqual(same.eligibilityConfirmations, saved.eligibilityConfirmations);
  assert.deepEqual(same.availability, saved.availability);
  setDiscovery([{ ...await store.find(key), jd: sample.jd + '\nJava required.' }]);
  const revised = await refresh();
  assert.equal(revised.availabilityView.status, 'unknown');
  assert.equal(revised.availabilityView.manual, false);
  assert.equal(revised.eligibilityConfirmations, undefined);
  assert.equal(revised.eligibility.requirements.find(r => /degree/.test(r.quote)).status, 'unknown');
});

test('discovery resume-files evaluates the selected discovery JD without accessing an application store', async t => {
  const { store, key, request } = await setup(t, { discovery: true });
  store.find = async () => { throw new Error('Application store should not be accessed'); };
  const result = await request(`/api/resume/files?source=discovery&key=${key}`);
  assert.equal(result.status, 200);
  assert.ok(result.data.assessment.id);
  assert.equal(result.data.generatedMaterial, null);
  assert.deepEqual(result.data.files, []);
  const assessed = await request(`/api/assessment?source=discovery&key=${key}`);
  assert.equal(result.data.assessment.id, assessed.data.assessment.id);
});

test('evidence API requires explicit human confirmation of the latest unknown check; rechecks and JD changes invalidate it', async t => {
  const { store, key, request, calls } = await setup(t);
  const details = (await request(`/api/jobs/${key}`)).data;
  assert.equal(calls(), 0);
  const base = { source: 'queue', key }, confirmation = { ...base, assessmentId: details.assessment.id,
    confirmed: true, note: 'Synthetic user verified that the official application remains open' };
  assert.equal((await request('/api/assessment/confirm', confirmation)).status, 400);
  const first = await request('/api/assessment/recheck', base);
  assert.equal(first.status, 200); assert.equal(first.data.availabilityView.status, 'unknown');
  const body = { ...confirmation, checkedAt: first.data.availabilityView.checkedAt };
  assert.equal((await request('/api/assessment/confirm', { ...body, confirmed: false })).status, 400);
  assert.equal((await request('/api/assessment/confirm', { ...body, note: '' })).status, 400);
  assert.equal((await request('/api/assessment/confirm', body)).status, 200);
  assert.doesNotThrow(() => requireAvailable(store.rows.get(key)));
  const second = await request('/api/assessment/recheck', base);
  assert.equal(second.data.availabilityView.manual, false);
  assert.equal((await request('/api/assessment/confirm', body)).status, 400);
  await store.updateState({ ...await store.find(key), jd: sample.jd + '\nJava required.' });
  assert.equal((await request('/api/assessment/confirm', { ...body, checkedAt: second.data.availabilityView.checkedAt })).status, 409);
  assert.equal((await store.find(key)).status, 'Queue');
});

test('closed evidence cannot be overridden or used to generate, while an open refreshed JD requires renewed review', async t => {
  const { store, key, request, setCheck } = await setup(t);
  const initial = (await request(`/api/jobs/${key}`)).data;
  setCheck({ status: 'closed', evidence: 'Synthetic employer closure' });
  const closed = await request('/api/assessment/recheck', { source: 'queue', key });
  assert.equal(closed.data.decision, 'REJECT');
  assert.equal((await request('/api/assessment/confirm', { source: 'queue', key, confirmed: true,
    assessmentId: closed.data.assessment.id, checkedAt: closed.data.availabilityView.checkedAt, note: 'Attempt to override closure' })).status, 400);
  const blocked = await request('/api/resume/generate', { source: 'queue', key, assessmentId: initial.assessment.id });
  assert.equal(blocked.status, 400); assert.match(blocked.data.error, /已关闭或截止/);
  setCheck({ status: 'open', evidence: 'Synthetic active posting', job: { jd: sample.jd + '\nJava required.', fullJd: true } });
  const updated = await request('/api/assessment/recheck', { source: 'queue', key });
  assert.notEqual(updated.data.assessment.id, initial.assessment.id);
  assert.match((await store.find(key)).jd, /Java/);
  const stale = await request('/api/resume/generate', { source: 'queue', key, assessmentId: initial.assessment.id });
  assert.equal(stale.status, 409); assert.match(stale.data.error, /已变化/);
});

test('qualification confirmations change eligibility but not skill coverage and expire when the JD changes', async t => {
  const { store, key, request, setProfiles } = await setup(t);
  const initial = (await request(`/api/jobs/${key}`)).data;
  const requirement = initial.eligibility.requirements.find(r => /degree/.test(r.quote));
  assert.equal(requirement.status, 'unknown');
  const body = { source: 'queue', key, assessmentId: initial.assessment.id, requirementId: requirement.id,
    confirmed: true, outcome: 'conflict', note: 'Synthetic user confirms no enrollment' };
  const confirmed = await request('/api/assessment/eligibility', body);
  assert.equal(confirmed.status, 200); assert.equal(confirmed.data.eligibility.summary.hardConflict, true);
  assert.equal(confirmed.data.match.score, initial.match.score);
  assert.notEqual(confirmed.data.assessment.id, initial.assessment.id);
  assert.equal((await request('/api/assessment/eligibility', body)).status, 409);
  setProfiles(profiles('v2'));
  assert.equal((await request('/api/assessment/eligibility', { ...body, assessmentId: confirmed.data.assessment.id })).status, 409);
  await store.updateState({ ...await store.find(key), jd: sample.jd + '\nPreferred qualifications\nJava' });
  const revised = (await request(`/api/jobs/${key}`)).data;
  assert.equal(revised.eligibility.summary.hardConflict, false);
  assert.equal(revised.eligibility.requirements.find(r => /degree/.test(r.quote)).status, 'unknown');
  assert.equal((await store.find(key)).eligibilityConfirmations.length, 1);
});

test('changing resumes requires acknowledgement for reviewed material; submitted snapshots survive later JD and profile changes', async t => {
  const { store, key, request, setProfiles, setCheck } = await setup(t);
  const initial = (await request(`/api/jobs/${key}`)).data;
  const pdf = Buffer.from('%PDF-1.7 Synthetic signature fixture, not Word output').toString('base64');
  const body = { checked: true, assessmentId: initial.assessment.id, files: { resume: pdf } };
  setProfiles(profiles('v2'));
  assert.equal((await request(`/api/jobs/${key}/complete`, body)).status, 409);
  setProfiles(profiles());
  const ready = await request(`/api/jobs/${key}/complete`, body);
  assert.equal(ready.status, 200);
  const oldVersion = structuredClone(ready.data.materialVersion);
  assert.equal(JSON.parse(await readFile(oldVersion.snapshotPath, 'utf8')).job.jd, sample.jd);
  setProfiles(profiles('v2'));
  const changed = (await request(`/api/jobs/${key}`)).data;
  assert.equal(changed.materialFreshness.status, 'stale');
  const submit = { date: '2026-09-28', confirmed: true, assessmentId: changed.assessment.id, receipt: 'SYNTHETIC-RECEIPT' };
  assert.equal((await request(`/api/jobs/${key}/submitted`, submit)).status, 400);
  const submitted = await request(`/api/jobs/${key}/submitted`, { ...submit, staleReviewed: true });
  assert.equal(submitted.status, 200);
  assert.deepEqual(submitted.data.materialVersion, oldVersion);
  assert.deepEqual(submitted.data.externalSubmission.materials.version, oldVersion);
  const frozen = structuredClone(submitted.data.externalSubmission);
  setProfiles(profiles('v3'));
  setCheck({ status: 'open', evidence: 'Synthetic later posting update', job: { jd: 'A different official JD', fullJd: true } });
  assert.equal((await request('/api/assessment/recheck', { source: 'queue', key })).status, 200);
  const record = await store.find(key);
  assert.equal(record.jd, sample.jd);
  assert.deepEqual(record.externalSubmission, frozen);
  assert.deepEqual(record.materialVersion, oldVersion);
  assert.equal((await request(`/api/jobs/${key}/complete`, { ...body, assessmentId: (await request(`/api/jobs/${key}`)).data.assessment.id })).status, 400);
});
