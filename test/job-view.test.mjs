import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesTerm, matchesFilters, sortJobs } from '../web/job-view.js';
import { publication, recentPublication, locationRegion, validPublicationDate, durationText } from '../web/job-facts.js';
const job = (key, term, score, postedAt) => ({ key, company: 'Test', title: key, term, match: { score }, postedAt });
test('term selection prioritizes official starts; an eight-month Winter job is not a Summer start', () => {
  assert.equal(matchesTerm({ term: 'Winter 2027', durationMonths: 8, indexEvidence: { terms: ['Summer 2027'] } }, 'Summer 2027'), false);
  assert.equal(matchesTerm({ term: 'Summer/Fall 2027' }, 'Summer 2027'), true);
  assert.equal(matchesTerm({ term: 'Summer/Fall 2027' }, 'Fall 2027'), true);
  assert.equal(matchesTerm({ term: 'Unknown', indexEvidence: { terms: ['Winter 2027'] } }, 'Winter 2027'), true);
  assert.equal(matchesTerm({ term: 'Unknown' }, 'Unknown'), true);
  assert.equal(matchesTerm({ term: 'Unknown' }, 'Summer 2027'), false);
});
test('filter Summer then choose score or publication priority, with secondary sort and unknowns last', () => {
  const rows = [job('winter', 'Winter 2027', 100, '2026-09-24T16:00:00Z'), job('fit', 'Summer 2027', 95, '2026-09-22T16:00:00Z'),
    job('new', 'Summer 2027', 50, '2026-09-24T16:00:00Z'), job('unknown', 'Summer 2027', null, null), job('date-only', 'Summer 2027', 40, '2026-09-24')];
  const summer = rows.filter(j => matchesTerm(j, 'Summer 2027'));
  assert.deepEqual(sortJobs(summer, 'match').map(x => x.key), ['fit', 'new', 'date-only', 'unknown']);
  assert.deepEqual(sortJobs(summer, 'published').map(x => x.key), ['new', 'date-only', 'fit', 'unknown']);
  assert.equal(rows[0].key, 'winter');
});

test('publication metadata retains precision and republish meaning; index dates cannot enter recency or sorting', () => {
  const now = Date.parse('2026-09-24T16:00:00Z');
  const latest = { sourceEvidence: { lastPublishedAt: '2026-09-24T15:00:00Z' } };
  assert.equal(publication(latest).kind, 'latest');
  assert.equal(recentPublication(latest, now), true);
  for (const j of [{ postedAt: '2026-09-24' }, { indexEvidence: { addedAt: '2026-09-24T15:00:00Z' } }, { postedAt: '2026-09-24T17:00:00Z' }]) assert.equal(recentPublication(j, now), false);
  assert.equal(recentPublication({ postedAt: '2026-09-23T16:00:00Z' }, now), true);
  assert.equal(recentPublication({ postedAt: '2026-09-23T15:59:59Z' }, now), false);
  assert.equal(validPublicationDate('2026-02-30'), false);
  const rows = [job('late-prior-day', 'Summer 2027', 10, '2026-09-24T01:00:00Z'), job('date-only-today', 'Summer 2027', 5, '2026-09-24')];
  assert.equal(sortJobs(rows, 'published')[0].key, 'date-only-today');
});

test('term, duration, work mode and location filters combine without turning remote Canada into GTA', () => {
  const rows = [
    { key: 'north', term: 'Summer 2027', durationMonths: 8, workMode: 'hybrid', location: 'North York, ON' },
    { key: 'markham', term: 'Summer 2027', durationMonths: 4, workMode: 'onsite', location: 'Markham, ON' },
    { key: 'remote', term: 'Winter 2027', durationMonths: null, workMode: 'remote', location: 'Remote / Canada', inGta: false },
    { key: 'ottawa', term: 'Summer 2027', durationMonths: 12, workMode: 'hybrid', location: 'Ottawa, ON' }
  ];
  assert.deepEqual(rows.filter(j => matchesFilters(j, { term: 'Summer 2027', duration: '8plus', workMode: 'hybrid', location: 'gta' })).map(j => j.key), ['north']);
  assert.deepEqual(rows.filter(j => matchesFilters(j, { location: 'gta' })).map(j => j.key), ['north', 'markham']);
  assert.deepEqual(rows.filter(j => matchesFilters(j, { duration: '4', location: 'gta', city: 'MARKHAM' })).map(j => j.key), ['markham']);
  assert.equal(matchesFilters(rows[2], { duration: 'unknown', workMode: 'remote', location: 'unknown' }), true);
  assert.equal(locationRegion({ location: 'Canada', inGta: false }), 'unknown');
  assert.equal(locationRegion(rows[3]), 'outside');
  assert.equal(rows.filter(j => matchesFilters(j)).length, rows.length);
});

test('official duration ranges remain visible and match available lengths without invented exact values', () => {
  const range = { title: 'Developer Intern (12-16 months)', fullJd: true, durationMonths: null };
  assert.equal(durationText(range), '12–16 个月');
  assert.equal(matchesFilters(range, { duration: '12' }), true);
  assert.equal(matchesFilters(range, { duration: '8' }), false);
  assert.equal(matchesFilters(range, { duration: 'unknown' }), false);
  const minimum = { ...range, title: 'Developer Intern (8+ Months)' };
  assert.equal(durationText(minimum), '8+ 个月');
  assert.equal(matchesFilters(minimum, { duration: '8plus' }), true);
  assert.equal(matchesFilters(minimum, { duration: '4' }), false);
  assert.equal(durationText({ ...range, fullJd: false }), '时长待核实');
  assert.equal(durationText({ ...range, title: 'Developer Intern (16-12 months)' }), '时长待核实');
});
