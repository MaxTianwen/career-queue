import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeJob } from '../src/core.mjs';
import { postingUrl, mergeDiscoveryJobs, discoveryCoverage } from '../src/discovery-records.mjs';
import { jobHighlights, skillHighlights } from '../web/job-summary.js';

const job = (extra = {}) => normalizeJob({ company: 'Example', title: 'Data Intern', location: 'Toronto', term: 'Summer 2027',
  url: 'https://job-boards.greenhouse.io/example/jobs/1', jd: 'SQL', fullJd: true, ...extra });

test('known application URL aliases merge without collapsing unrelated query identifiers', () => {
  assert.equal(postingUrl('https://boards.greenhouse.io/example/jobs/1/apply?gh_src=x'), job().url);
  assert.notEqual(postingUrl('https://example.com/job?id=1'), postingUrl('https://example.com/job?id=2'));
  assert.throws(() => postingUrl('https://user:secret@example.com/job'));
  const a = job(), b = job({ url: 'https://boards.greenhouse.io/example/jobs/1?utm_source=test' });
  const merged = mergeDiscoveryJobs([a, b]);
  assert.equal(merged.duplicates, 1); assert.equal(merged.results.length, 1);
  assert.deepEqual(new Set(merged.results[0].sourceLinks), new Set([a.url, b.url]));
});

test('confirmed employer requisitions merge across URLs; titles alone and different terms or IDs do not', () => {
  const a = job({ requisitionId: 'REQ1', sourceEvidence: { requisitionIdField: 'requisition_id' } });
  const b = job({ ...a, url: 'https://job-boards.greenhouse.io/example/jobs/2' });
  assert.equal(mergeDiscoveryJobs([a, b]).duplicates, 1);
  for (const extra of [{ requisitionId: 'REQ2' }, { term: 'Fall 2027' }, { sourceEvidence: {} }]) {
    const result = mergeDiscoveryJobs([a, job({ ...b, ...extra })]);
    assert.equal(result.duplicates, 0); assert.equal(result.results.length, 2);
  }
  const similar = mergeDiscoveryJobs([job(), job({ url: b.url })]).results;
  assert.ok(similar.every(row => row.duplicateNote));
});

test('conflicting location or index terms stay separately selectable and blocked from silent Queue deduplication', () => {
  const a = job({ requisitionId: 'REQ1', sourceEvidence: { requisitionIdField: 'requisition_id' } });
  const conflict = mergeDiscoveryJobs([a, job({ ...a, location: 'Vancouver' })]);
  assert.equal(conflict.duplicates, 0);
  assert.equal(new Set(conflict.results.map(row => row.key)).size, 2);
  assert.ok(conflict.results.every(row => row.identityConflict && row.duplicateNote));
  const contradictoryIds = mergeDiscoveryJobs([a, job({ ...a, requisitionId: 'REQ2' })]);
  assert.equal(contradictoryIds.results.length, 2);
  assert.ok(contradictoryIds.results.every(row => row.identityConflict));
  const terms = mergeDiscoveryJobs(['Summer 2027', 'Winter 2027'].map(term => job({ term: 'Unknown', indexEvidence: { terms: [term] } })));
  assert.equal(terms.duplicates, 0); assert.equal(new Set(terms.results.map(row => row.key)).size, 2);
});

test('coverage separates failed/unsupported reads and does not infer publication from index timestamps', () => {
  const rows = discoveryCoverage([
    job({ postedAt: '2026-09-25', durationMonths: 8, salary: 'CAD 25 / hour', workMode: 'hybrid' }),
    { ...job(), fullJd: false, jd: '', fetchError: 'HTTP 429', indexEvidence: { addedAt: '2026-09-25' } },
    { url: 'https://employer.wd3.myworkdayjobs.com/job/123', fullJd: false }, {}
  ]);
  assert.deepEqual(rows.find(row => row.name === 'Greenhouse'), { name: 'Greenhouse', total: 2, fullJd: 1, failed: 1, unsupported: 0, published: 1, duration: 1, salary: 1, workMode: 1 });
  assert.equal(rows.find(row => row.name === 'Workday').unsupported, 1);
  assert.equal(rows.find(row => row.name === '来源待核实').total, 1);
});

test('summary preserves duration ranges, unknown facts, basic skill level and escapes untrusted text', () => {
  const facts = jobHighlights(job({ title: 'Intern 8-12 months', workMode: 'remote', salary: '<img src=x>', location: 'Toronto' }));
  assert.match(facts, /8–12 个月/); assert.match(facts, /&lt;img src=x&gt;/);
  assert.match(facts, /Toronto 市内/); assert.match(facts, /Remote 不代表允许从加拿大/);
  assert.match(jobHighlights({ fullJd: false }), /时长待核实/);
  const skills = skillHighlights({ match: { score: 50, matched: [
    { kind: 'skill', name: 'Power BI', level: .5, evidence: '" onmouseover="evil' },
    { kind: 'experience', name: 'Reporting experience' }
  ], gaps: [{ kind: 'skill', name: '<script>' }] } });
  assert.match(skills, /Power BI · 基础/); assert.doesNotMatch(skills, /Reporting experience|<script>|title="" onmouseover/);
  assert.match(skills, /知识库未证实/);
});
