import test from 'node:test';
import assert from 'node:assert/strict';
import { extractDeadline, deadlineExpired } from '../src/deadlines.mjs';
import { normalizeJob, evaluateJob } from '../src/core.mjs';

test('explicit English/ISO closing dates are extracted; general project deadlines, invalid dates and contradictions are not guessed', () => {
  assert.equal(extractDeadline({ jd: 'Application Submission Deadline: October 15th, 2026' }).deadline, '2026-10-15');
  assert.equal(extractDeadline({ jd: 'Applications close on 2026-09-24T16:00:00Z' }).deadline, '2026-09-24T16:00:00Z');
  assert.equal(extractDeadline({ jd: 'Apply by September 24, 2026 at 11:59 PM EDT' }).deadline, '2026-09-24T23:59:00-04:00');
  for (const jd of ['Meet internal deadlines.', 'No application deadline. Project starts October 1, 2026.', 'Application deadline: February 30, 2027',
    'Application deadline: rolling', 'Application deadline: 2026-09-23\nClosing date: 2026-09-30']) assert.equal(extractDeadline({ jd }).deadline, null);
});
test('date-only deadlines expire after Toronto calendar day, while explicit timestamps use exact cutoff', () => {
  assert.equal(deadlineExpired('2026-09-24', new Date('2026-09-25T03:59:59Z')), false);
  assert.equal(deadlineExpired('2026-09-24', new Date('2026-09-25T04:00:00Z')), true);
  assert.equal(deadlineExpired('2026-09-24T12:00:00-04:00', new Date('2026-09-24T16:00:01Z')), true);
  assert.equal(deadlineExpired('2026-02-30'), false);
  assert.equal(deadlineExpired('2026-02-30T12:00:00Z'), false);
});
test('pasted JD deadlines participate in ingest evaluation', () => {
  const j = normalizeJob({ company: 'Synthetic', title: 'Software Intern', url: 'https://example.com/1', term: 'Summer 2027', jd: 'Application Deadline: September 20, 2026' });
  const result = evaluateJob(j, new Date('2026-09-24T16:00:00Z'));
  assert.equal(result.decision, 'REJECT'); assert.ok(result.reasons.includes('申请已截止'));
});
