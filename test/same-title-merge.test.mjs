import test from 'node:test';
import assert from 'node:assert/strict';
import { unifiedOpportunities } from '../src/v2/unified-opportunities.mjs';
const pub = (id, extra = {}) => ({ id: id.repeat(64), company: 'Example Labs Inc.', title: 'Data Analyst Intern', location: 'Toronto, ON', term: 'Summer 2027', url: `https://example.test/jobs/${id}`, jd: 'Analyze datasets.', classification: { track: 'data' }, ...extra });
const school = (schoolId, extra = {}) => ({ schoolId, updated: 1, row: { id: schoolId, company: 'Example Labs', title: 'NEW Data Analyst Intern [123456]', location: 'Toronto, ON', term: 'Summer 2027', ...extra } });
const run = (jobs, schools) => unifiedOpportunities('owner', { jobs, finishedAt: null }, schools, []);

test('one school row and one public posting with the same employer and title become one card', () => {
  const list = run([pub('a')], [school('900001')]);
  assert.equal(list.length, 1);
  assert.equal(list[0].hasPublic, true);
  assert.equal(list[0].hasSchool, true);
  assert.equal(list[0].schoolSources[0].match, 'title');
});
test('same-name postings stay separate when either side is not unique or facts conflict', () => {
  assert.equal(run([pub('a'), pub('b')], [school('900001')]).length, 3, 'two public postings share the title');
  assert.equal(run([pub('a')], [school('900001'), school('900002')]).length, 3, 'two school rows share the title');
  assert.equal(run([pub('a')], [school('900001', { location: 'Vancouver, BC' })]).length, 2, 'location conflict');
  assert.equal(run([pub('a')], [school('900001', { term: 'Fall 2027' })]).length, 2, 'term conflict');
  assert.equal(run([pub('a')], [school('900001', { title: 'Data Analyst Intern - 8 months' })]).length, 2, 'different title');
  assert.equal(run([pub('a', { company: 'Other Labs' })], [school('900001')]).length, 2, 'different employer');
});
test('month words and acronym asides do not hide the same posting', () => {
  const list = run([pub('a', { title: 'Geographic Information Systems Co-op', company: 'Elk Valley Resources' })], [school('900003', { title: 'May 2027 Geographic Information Systems (GIS) Co-op', company: 'Elk Valley Resources (EVR)' })]);
  assert.equal(list.length, 1);
});
