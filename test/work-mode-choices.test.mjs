import test from 'node:test';
import assert from 'node:assert/strict';
import { workModes, workModeText } from '../web/job-facts.js';
import { matchesFilters } from '../web/job-view.js';
import { extractFacts } from '../src/discovery.mjs';
import { evaluateJob } from '../src/core.mjs';
import { discoveryCoverage } from '../src/discovery-records.mjs';
import { jobHighlights } from '../web/job-summary.js';

const choice = { title: 'Software Developer Intern Summer 2027', workMode: 'onsite', location: 'Remote, Canada',
  jd: 'This position can be on-site in our Toronto office, hybrid or entirely remote in Ontario.', fullJd: true };
test('explicit JD choices match each offered mode without losing geography restrictions', () => {
  const job = extractFacts(choice);
  assert.deepEqual(workModes(job), ['onsite', 'hybrid', 'remote']);
  for (const mode of ['onsite', 'hybrid', 'remote']) assert.equal(matchesFilters(job, { workMode: mode }), true);
  assert.equal(matchesFilters(job, { workMode: 'unknown' }), false);
  assert.equal(job.workMode, 'unknown'); assert.equal(job.remoteEligible, undefined);
  assert.equal(job.fieldEvidence.workMode.status, 'options');
  assert.match(workModeText(job), /可选/); assert.match(jobHighlights(job), /可选/);
  assert.equal(discoveryCoverage([job])[0].workMode, 1);
  assert.ok(evaluateJob(job).reasons.some(r => /所选方式/.test(r)));
});
test('unknown, conflicts and incidental or negated wording do not become choices', () => {
  for (const jd of ['We collaborate with remote teams on-site and hybrid teams.',
    'This position can be on-site but not hybrid or remote.', 'This position cannot be on-site or remote.',
    'This position can be on-site. Other jobs can be hybrid or remote.']) {
    const job = { ...choice, jd, workMode: 'unknown', fieldEvidence: { workMode: { status: 'ambiguous' } } };
    assert.deepEqual(workModes(job), []); assert.equal(matchesFilters(job, { workMode: 'remote' }), false);
    assert.equal(matchesFilters(job, { workMode: 'unknown' }), true);
  }
});
test('two offered modes and existing single mode filters remain distinct; stale choices are not stored', () => {
  const job = { ...choice, jd: 'This role can be hybrid or remote in Ontario.' };
  assert.equal(matchesFilters(job, { workMode: 'onsite' }), false);
  assert.deepEqual(workModes({ ...job, jd: 'This role is on-site.' }), ['onsite']);
  assert.deepEqual(workModes({ workMode: 'hybrid' }), ['hybrid']);
  assert.equal(matchesFilters(choice, { workMode: 'remote', location: 'toronto' }), false);
});
test('Vena production wording with duration and start month exposes all three explicit choices', () => {
  for (const region of ['Canada', 'Ontario']) {
    const job = { ...choice, jd: `This is a 12-16 month co-op position starting in May 2027 and can be on-site in our Toronto office, hybrid or entirely remote in ${region}.` };
    assert.deepEqual(workModes(job), ['onsite', 'hybrid', 'remote']);
    assert.equal(extractFacts(job).fieldEvidence.workMode.status, 'options');
  }
});
