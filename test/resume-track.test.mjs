import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyResume, selectResumeTrack } from '../src/resume-track.mjs';

test('explicit JD duties classify generic titles and reveal mixed responsibilities', () => {
  assert.equal(classifyResume({ title: 'Technology Intern', jd: 'Develop web applications and test REST APIs.' }).track, 'cs');
  assert.equal(classifyResume({ title: 'Intern', jd: 'Analyze customer data. Build analytical reports.' }).track, 'data');
  const mixed = classifyResume({ title: 'Technology Intern', jd: 'Develop web applications. Build dashboards.' });
  assert.equal(mixed.track, 'mixed');
  assert.equal(mixed.requiresChoice, true);
  assert.equal(classifyResume({ title: 'Intern', fullJd: false, jd: 'Build dashboards.' }).track, 'unknown');
  assert.equal(classifyResume({ title: 'Software Developer', jd: 'Collaborate with data scientists. Develop web applications.' }).track, 'cs');
  assert.equal(classifyResume({ title: 'Intern', jd: 'Collaborate with software engineers and data analysts. Software engineering degree preferred.' }).track, 'unknown');
});

test('resume direction prioritizes role title over other roles mentioned in JD', () => {
  assert.equal(classifyResume({ title: 'Software Developer Intern', jd: 'Collaborate with data scientists.' }).track, 'cs');
  assert.equal(classifyResume({ title: 'Software Engineering Co-op', jd: 'Work with data analysts.' }).track, 'cs');
  assert.equal(classifyResume({ title: 'Platform Engineering Intern' }).track, 'cs');
  assert.equal(classifyResume({ title: 'Data Quality Intern' }).track, 'data');
  assert.equal(classifyResume({ title: 'Data Engineer Intern', jd: 'Software engineering background.' }).track, 'data');
  assert.equal(classifyResume({ title: 'Business Intelligence Co-op' }).track, 'data');
  assert.equal(classifyResume({ title: 'Intern', jd: 'Work on front-end development.' }).track, 'cs');
});

test('ambiguous or missing evidence requires a choice; summaries and degrees do not imply role', () => {
  for (const job of [
    { title: 'Intern', jd: 'Computer science degree. Python and SQL.' },
    { title: 'Intern', fullJd: false, jd: 'Software developer' },
    { title: 'Software Engineer / Data Analyst Intern' }
  ]) {
    assert.equal(classifyResume(job).requiresChoice, true);
    assert.throws(() => selectResumeTrack(job), /请选择/);
    assert.equal(selectResumeTrack(job, 'data').track, 'data');
  }
  assert.throws(() => selectResumeTrack({ title: 'Software Developer' }, '../../private'), /简历方向/);
});
