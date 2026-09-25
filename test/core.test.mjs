import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalUrl, normalizeJob, evaluateJob, newRecord, markReady, markSubmitted } from '../src/core.mjs';

const now = new Date('2026-09-24T16:00:00Z');
const base = { company: 'Example', title: 'Software Intern', url: 'https://example.com/jobs/123', jd: 'A test fixture, not a real job.',
  term: 'Summer 2027', location: 'Toronto, ON', workMode: 'hybrid', durationMonths: 4,
  isIntern: true, relevant: true, paid: true, meetsMinimumWage: true, postedAt: '2026-09-24T12:00:00Z' };
const assess = changes => evaluateJob(normalizeJob({ ...base, ...changes }), now);

test('GTA 4 / 8 / 12 / 16 months accepted; exactly 8 outside GTA accepted', () => {
  for (const durationMonths of [4, 8, 12, 16]) assert.equal(assess({ durationMonths }).decision, 'PASS');
  assert.equal(assess({ inGta: false, location: 'Vancouver', durationMonths: 8 }).decision, 'PASS');
  assert.equal(assess({ inGta: false, location: 'Vancouver', durationMonths: 4 }).decision, 'REJECT');
});
test('remote four months allowed regardless of employer location, eligibility unknown retained', () => {
  assert.equal(assess({ location: 'Vancouver', inGta: false, workMode: 'remote', remoteEligible: true }).decision, 'PASS');
  assert.equal(assess({ location: 'Vancouver', inGta: false, workMode: 'remote' }).decision, 'REVIEW');
  assert.equal(assess({ inGta: false, workMode: 'unknown' }).decision, 'REVIEW');
});
test('undisclosed pay retained; unpaid and confirmed below minimum excluded', () => {
  assert.equal(assess({ paid: null, meetsMinimumWage: null }).decision, 'REVIEW');
  assert.equal(assess({ paid: false }).decision, 'REJECT');
  assert.equal(assess({ meetsMinimumWage: false }).decision, 'REJECT');
});
test('publication age is not an eligibility rejection; unknown dates remain explicit', () => {
  for (const postedAt of [null, '2026-09-24', 'invalid', '2026-09-24T17:00:00Z']) assert.equal(assess({ postedAt }).decision, 'REVIEW');
  assert.equal(assess({ postedAt: '2026-09-23T16:00:00Z' }).decision, 'PASS');
  assert.equal(assess({ postedAt: '2026-09-23T15:59:59Z' }).decision, 'PASS');
  assert.equal(assess({ postedAt: '2026-08-01T15:59:59Z', deadline: '2026-11-01' }).decision, 'REVIEW');
  assert.equal(assess({ postedAt: '2026-09-24T12:00:00Z', deadline: '2026-09-23' }).decision, 'REJECT');
});
test('non-intern and wrong term excluded; citizenship/year uncertainties treated separately', () => {
  for (const changes of [{ isIntern: false }, { term: 'Winter 2026' }, { term: 'Spring 2027' }, { citizenOnly: true }, { graduateOnly: true }]) assert.equal(assess(changes).decision, 'REJECT');
  assert.equal(assess({ citizenOnly: false, eligibilityNotes: 'Requires third year; academic standing unconfirmed' }).decision, 'REVIEW');
});

test('Winter 2027 is accepted while pay, duration and deadline restrictions still apply', () => {
  assert.equal(assess({ term: 'Winter 2027' }).decision, 'PASS');
  for (const changes of [{ paid: false }, { durationMonths: 3 }, { deadline: '2026-09-22' }]) {
    assert.equal(assess({ ...changes, term: 'Winter 2027' }).decision, 'REJECT');
  }
  assert.notEqual(normalizeJob(base).key, normalizeJob({ ...base, term: 'Winter 2027' }).key);
});
test('URL tracking deduplicates; distinct terms and job query IDs remain separate', () => {
  assert.equal(normalizeJob(base).key, normalizeJob({ ...base, url: `${base.url}/?utm_source=test#apply` }).key);
  assert.notEqual(normalizeJob(base).key, normalizeJob({ ...base, term: 'Fall 2027' }).key);
  assert.notEqual(normalizeJob({ ...base, url: 'https://example.com/apply?id=1' }).key, normalizeJob({ ...base, url: 'https://example.com/apply?id=2' }).key);
  assert.throws(() => canonicalUrl('javascript:alert(1)'));
});
test('application transitions require all materials and explicit submission confirmation', () => {
  const record = newRecord(normalizeJob(base), now);
  assert.throws(() => markReady(record, {}));
  const materials = { resume: 'resume.pdf', reviewNotes: 'review.md' };
  assert.throws(() => markReady({ ...record, coverLetterRequired: true }, materials));
  const ready = markReady(record, materials);
  assert.equal(ready.status, '待提交');
  assert.equal(ready.applicationDate, null);
  assert.throws(() => markSubmitted(ready, '2026-09-24', false, now));
  assert.throws(() => markSubmitted(ready, '2026-09-25', true, now));
  assert.throws(() => markSubmitted(ready, '2026-02-30', true, now));
  const submitted = markSubmitted(ready, '2026-09-24', true, now);
  assert.equal(submitted.status, '已投递');
  assert.throws(() => markReady(submitted, materials));
});
