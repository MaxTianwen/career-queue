import test from 'node:test';
import assert from 'node:assert/strict';
import { buildResumeProfile, buildProfile, matchJob } from '../src/matching.mjs';
import { assessEligibility, eligibilityJdHash } from '../src/eligibility.mjs';

const now = new Date('2026-09-29T16:00:00Z');
const profile = buildResumeProfile('Built a Python and SQL reporting project for analysts.\nJava (basic)\nNo experience with AWS.', { track: 'cs', version: 'resume-1' });
const assess = (jd, confirmations = [], p = profile) => assessEligibility({ jd }, p, confirmations, now);

test('eligibility distinguishes required and preferred evidence without changing Match Score', () => {
  const jd = 'Required qualifications\nExperience with Python and SQL.\nPreferred qualifications\nAWS experience.';
  const before = matchJob({ jd }, profile), result = assess(jd);
  assert.deepEqual(result.requirements.map(x => [x.kind, x.status]), [['required', 'met'], ['preferred', 'not-demonstrated']]);
  assert.equal(result.summary.hardConflict, false);
  assert.equal(result.summary.required.met, 1); assert.equal(result.summary.preferred['not-demonstrated'], 1);
  assert.ok(result.requirements[0].evidence.every(x => x.quote === profile.technical.find(s => s.name === x.name).evidence));
  assert.deepEqual(matchJob({ jd }, profile), before);
});

test('simple alternative requires one skill, while conjunction and basic exposure stay partial', () => {
  const result = assess('Required qualifications\nPython or AWS\nPython and AWS\nJava\nAt least one of Python, Java, AWS\nPython or Java and SQL');
  assert.deepEqual(result.requirements.map(x => [x.mode, x.status]), [['any', 'met'], ['all', 'partial'], ['all', 'partial'], ['any', 'met'], ['complex', 'unknown']]);
  assert.equal(result.summary.hardConflict, false);
});

test('missing skills and unavailable or knowledge-base profiles never prove inability', () => {
  const missing = assess('Required qualifications\nAWS');
  assert.equal(missing.requirements[0].status, 'not-demonstrated'); assert.equal(missing.summary.hardConflict, false);
  assert.match(missing.requirements[0].reason, /不代表/);
  const knowledge = buildProfile('## 5. 技能与证据范围\n| 工作技术 | AWS | Cloud employment |');
  for (const p of [knowledge, { available: false }, null]) {
    const result = assess('Required qualifications\nAWS', [], p);
    assert.equal(result.resumeAvailable, false); assert.equal(result.requirements[0].status, 'unknown');
    assert.deepEqual(result.requirements[0].evidence, []);
  }
});

test('negations, mixed requirements, unsupported clauses and proficiency cannot become fully met', () => {
  const result = assess('Requirements\nNo Python experience is required.\nPython required, SQL preferred.\nStrong Python proficiency required.\nPython and financial modeling required.\nPython or equivalent experience required.\nAbility to lead a team required.');
  assert.equal(result.requirements.length, 6);
  assert.ok(result.requirements.every(x => x.status !== 'met'));
  assert.equal(result.requirements[0].kind, 'unspecified'); assert.equal(result.requirements[1].kind, 'unspecified');
  assert.equal(result.summary.hardConflict, false);
});

test('education, enrollment, authorization and years stay unknown even with technical coverage', () => {
  const result = assess('Requirements\nBachelor degree in Computer Science.\nMust be enrolled as a student.\nMust be authorized to work in Canada.\nMust not require sponsorship.\n3 years Python experience required.');
  assert.equal(result.requirements.length, 5);
  assert.ok(result.requirements.every(x => x.status === 'unknown'));
  assert.equal(result.summary.hardConflict, false);
});

test('return-to-school requirements are excluded as requested and cannot create confirmations or conflicts', () => {
  const jd = 'Requirements\nMust return to school after the internship.\nMust be returning to university after the placement.\nMust return to full-time studies after this role.\n返校安排必须确认。';
  const result = assess(jd);
  assert.deepEqual(result.requirements, []); assert.equal(result.summary.hardConflict, false);
  assert.equal(assess(`${jd}\nPython required.`).requirements.length, 1);
});

test('excluding return arrangements preserves separable current-enrollment requirements', () => {
  const result = assess('Requirements\nCurrently enrolled in CS and returning after internship.\nMust be enrolled in a degree program and return to school after the placement.');
  assert.deepEqual(result.requirements.map(x => x.quote), ['Currently enrolled in CS', 'Must be enrolled in a degree program']);
  assert.ok(result.requirements.every(x => x.status === 'unknown'));
  assert.equal(result.summary.hardConflict, false);
});

test('only explicit current-JD confirmed required conflicts become hard conflicts', () => {
  const jd = 'Requirements\nMust be authorized to work in Canada.\nPreferred qualifications\nAWS';
  const first = assess(jd), [requirement, bonus] = first.requirements;
  const confirmation = { requirementId: requirement.id, jdHash: first.jdHash, outcome: 'conflict', note: '本人确认目前不满足此项要求。', confirmedAt: '2026-09-29T15:00:00Z' };
  assert.equal(assess(jd, [confirmation]).summary.hardConflict, true);
  assert.equal(assess(jd, [{ ...confirmation, requirementId: bonus.id }]).summary.hardConflict, false);
  assert.equal(assess(jd, [{ ...confirmation, outcome: 'met' }]).requirements[0].status, 'met');
  for (const altered of [{ jdHash: 'old' }, { note: '' }, { confirmedAt: 'invalid' }, { confirmedAt: '2026-10-01' }, { requirementId: 'other' }]) {
    assert.equal(assess(jd, [{ ...confirmation, ...altered }]).summary.hardConflict, false);
  }
  assert.equal(assess(`${jd}\nSQL`, [confirmation]).summary.hardConflict, false);
});

test('JD hash binds content, role identity and full-text status, not only keywords', () => {
  const job = { jd: 'Python required', title: 'Developer Intern', company: 'Synthetic Co', term: 'Summer 2027', location: 'Toronto', url: 'https://example.com/jobs/1', deadline: '2026-10-01', fullJd: true };
  for (const key of ['jd', 'title', 'company', 'term', 'location', 'url', 'deadline', 'fullJd']) {
    assert.notEqual(eligibilityJdHash(job), eligibilityJdHash({ ...job, [key]: key === 'fullJd' ? false : `${job[key]} changed` }));
  }
  assert.equal(assessEligibility({ ...job, fullJd: false }, profile).available, false);
  assert.deepEqual(assessEligibility({ ...job, fullJd: false }, profile).requirements, []);
});

test('inferred and recorded identical deadlines share input hashes and current confirmations', () => {
  const raw = { jd: 'Required: Python\nApplication deadline: October 31, 2026' };
  const presented = { ...raw, deadline: '2026-10-31' };
  assert.equal(eligibilityJdHash(raw), eligibilityJdHash(presented));
  const first = assessEligibility(raw, profile, [], now);
  const confirmation = { requirementId: first.requirements[0].id, outcome: 'conflict', note: '本人确认此项不满足', confirmedAt: '2026-09-29T15:00:00Z', jdHash: first.jdHash };
  assert.equal(assessEligibility(presented, profile, [confirmation], now).summary.hardConflict, true);
  assert.notEqual(eligibilityJdHash(raw), eligibilityJdHash({ ...raw, deadline: '2026-11-01' }));
});

test('qualifications preserve original quotes, stop at benefits, and avoid overlapping technology names', () => {
  const jd = 'Qualifications\nSQL Server\nBenefits\nPython required for our weekly company quiz.';
  const result = assess(jd);
  assert.equal(result.requirements[0].quote, 'SQL Server');
  assert.equal(result.requirements[0].kind, 'unspecified');
  assert.deepEqual(result.requirements[0].skills, ['SQL Server']);
  assert.equal(result.requirements[0].status, 'not-demonstrated');
  assert.equal(result.requirements.length, 1);
});

test('inline labels retain required/preferred distinctions and exact JD evidence', () => {
  const result = assess('Required: Python\nPreferred: AWS\nRequirements: Python or Java');
  assert.deepEqual(result.requirements.map(x => [x.kind, x.mode, x.status]), [['required', 'all', 'met'], ['preferred', 'all', 'not-demonstrated'], ['required', 'any', 'met']]);
  assert.equal(result.requirements[0].quote, 'Required: Python');
});

test('preferred-only clauses cannot imply overall eligibility and negated resume statements are not evidence', () => {
  assert.equal(assess('Preferred qualifications\nAWS').summary.status, 'unknown');
  const negative = buildResumeProfile('AWS: no hands-on experience.\nWorked on a Python data reporting project with SQL.');
  const result = assess('Required: AWS', [], negative);
  assert.equal(result.requirements[0].status, 'not-demonstrated');
  assert.deepEqual(result.requirements[0].evidence, []);
  assert.equal(result.summary.hardConflict, false);
});
