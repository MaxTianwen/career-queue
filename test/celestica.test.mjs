import test from 'node:test';
import assert from 'node:assert/strict';
import { celesticaUrl, parseCelesticaList, parseCelesticaJob, fetchCelestica } from '../src/celestica.mjs';
import { EMPLOYER_SOURCES, readEmployerBoard } from '../src/discovery-sources.mjs';
import { discover, SOURCE, extractFacts } from '../src/discovery.mjs';
import { checkAvailability } from '../src/availability.mjs';
import { postingUrl, mergeDiscoveryJobs, sourceName } from '../src/discovery-records.mjs';
const source = EMPLOYER_SOURCES.find(s => s.id === 'celestica');
const url = id => `https://careers.celestica.com/job/Newmarket-Student-Intern-ON/${id}/`;
const row = id => `<tr class="data-row"><td><a class="jobTitle-link" href="${url(id)}">Student Intern, Test Development</a><a class="jobTitle-link" href="${url(id)}">Mobile title</a></td><td class="colLocation hidden-phone">Newmarket, ON, CA</td></tr>`;
const list = (start, end, total, rows) => `<span class="paginationLabel">Results <b>${start} – ${end}</b> of <b>${total}</b></span>${rows}`;
const detail = id => `<link rel="canonical" href="${url(id)}"><h1 itemprop="title">Student Intern, Test Development</h1><a href="/talentcommunity/apply/${id}/">Apply</a>
<meta itemprop="datePosted" content="Wed Sep 16 00:00:00 UTC 2026"><meta itemprop="addressLocality" content="Newmarket"><meta itemprop="addressRegion" content="ON"><meta itemprop="addressCountry" content="CA">
<span itemprop="description"><p>Req ID: 140848<br>Remote Position: Hybrid</p><h2>16 Month Internship</h2><p>Start Date: May 2027</p><ul><li>Build <span>Python <span>SQL</span> systems</span> and test software</li></ul><p>Hourly Wage: $24.00-30.00 CAD/hr</p></span><span>Unrelated navigation</span>`;

test('Celestica listing validates counts, deduplicates mobile markup and advances bounded pagination', async () => {
  const calls = [];
  const result = await readEmployerBoard(source, async (url, options) => {
    calls.push(url); assert.equal(options.redirect, 'error');
    return new Response(calls.length === 1 ? list(1, 2, 3, row(101) + row(102)) : list(3, 3, 3, row(103)));
  });
  assert.equal(result.status, 'complete'); assert.equal(result.jobs.length, 3); assert.equal(result.pages, 2);
  assert.equal(calls[1], source.url + '2/'); assert.equal(result.jobs[0].postedAt, null);
});

test('Celestica page or schema failures do not become empty successful lists', async () => {
  let count = 0;
  const partial = await readEmployerBoard(source, async () => ++count === 1 ? new Response(list(1, 1, 2, row(101))) : new Response('maintenance', { status: 503 }));
  assert.equal(partial.status, 'partial'); assert.equal(partial.jobs.length, 1);
  assert.equal((await readEmployerBoard(source, async () => new Response('<p>Please log in</p>'))).status, 'failed');
  assert.throws(() => parseCelesticaList(list(1, 2, 2, row(101))), /数量/);
  assert.throws(() => parseCelesticaList(list(1, 2, 2, row(101) + row(101))), /重复/);
  const repeated = await readEmployerBoard(source, async () => new Response(list(1, 1, 2, row(101))));
  assert.equal(repeated.status, 'partial'); assert.match(repeated.error, /分页/);
});

test('Celestica reads a complete nested description with explicit dates, salary, mode and employer ID', () => {
  const job = extractFacts(parseCelesticaJob(detail(101), { url: url(101) }));
  assert.equal(job.requisitionId, '140848'); assert.equal(job.postedAt, '2026-09-16'); assert.equal(job.postedAtKind, 'official');
  assert.match(job.jd, /Python SQL systems/); assert.ok(!job.jd.includes('Unrelated navigation'));
  assert.equal(job.term, 'Summer 2027'); assert.equal(job.durationMonths, 16); assert.equal(job.workMode, 'hybrid');
  assert.equal(job.salary, '$24.00-30.00 CAD/hr'); assert.equal(job.deadline, null); assert.equal(sourceName(job), 'Celestica');
  assert.equal(parseCelesticaJob(detail(101).replace('Req ID:', '\u200bReq ID:'), { url: url(101) }).requisitionId, '140848');
});

test('Celestica rejects wrong canonical pages, absent application IDs and truncated bodies', () => {
  assert.throws(() => parseCelesticaJob(detail(102), { url: url(101) }), /相符/);
  assert.throws(() => parseCelesticaJob(detail(101).replace('/talentcommunity/apply/101/', '/talentcommunity/apply/102/'), { url: url(101) }), /相符/);
  assert.throws(() => parseCelesticaJob(detail(101).split('<span itemprop="description">')[0], { url: url(101) }), /完整/);
  const unknown = parseCelesticaJob(detail(101).replace('Wed Sep 16 00:00:00 UTC 2026', 'Posted Today').replace('Remote Position: Hybrid', 'Remote Position: No'), { url: url(101) });
  assert.equal(unknown.postedAt, null); assert.equal(unknown.workMode, 'unknown');
});

test('Celestica canonical URLs stay on the allowlist; redirects, oversized content and encoded paths fail', async () => {
  assert.equal(postingUrl(url(101) + '?utm_source=test'), url(101));
  assert.equal(celesticaUrl(url(101).slice(0, -1)), url(101));
  for (const bad of [url(101).replace('https:', 'http:'), url(101).replace('.com', '.com.evil.test'), 'https://careers.celestica.com/job/a%2Fb/101/', 'https://user@careers.celestica.com/job/a/101/']) {
    assert.equal(celesticaUrl(bad), null); await assert.rejects(fetchCelestica({ url: bad }, () => assert.fail()));
  }
  await assert.rejects(fetchCelestica({ url: url(101) }, async () => new Response('a'.repeat(2_000_001))), /过大/);
  await assert.rejects(fetchCelestica({ url: url(101) }, async (_, opts) => { assert.equal(opts.redirect, 'error'); return new Response('', { status: 302 }); }), /302/);
});

test('Celestica recheck distinguishes open, explicit closure and unavailable content', async () => {
  const candidate = { url: url(101) };
  assert.equal((await checkAvailability(candidate, { fetchImpl: async () => new Response(detail(101)) })).status, 'open');
  assert.equal((await checkAvailability(candidate, { fetchImpl: async () => new Response('<h1>This job is no longer available</h1>') })).status, 'closed');
  assert.equal((await checkAvailability(candidate, { fetchImpl: async () => new Response('maintenance', { status: 503 }) })).status, 'unknown');
});

test('discovery includes Newmarket and merges the same Celestica URL from index and employer list', async () => {
  const report = await discover({ sources: [source], fetchImpl: async urlValue => {
    if (urlValue === SOURCE.dataUrl) return new Response(JSON.stringify([{ active: true, is_visible: true, terms: ['Summer 2027'], locations: ['Newmarket, ON, CA'], company_name: 'Celestica', title: 'Student Intern, Test Development', url: url(101) }]));
    return new Response(urlValue === source.url ? list(1, 1, 1, row(101)) : detail(101));
  } });
  assert.equal(report.results.length, 1); assert.equal(report.results[0].fullJd, true); assert.equal(report.results[0].requisitionId, '140848');
  assert.equal(report.results[0].discoverySources.length, 2); assert.equal(report.duplicates, 1);
  assert.equal(mergeDiscoveryJobs(report.results).results.length, 1);
});

test('Veeva is a named Lever board and no matching internship is a valid result, not invented coverage', async () => {
  const veeva = EMPLOYER_SOURCES.find(s => s.id === 'veeva');
  assert.equal(veeva.board, 'veeva');
  const result = await readEmployerBoard(veeva, async u => { assert.ok(u.startsWith('https://api.lever.co/v0/postings/veeva?')); return new Response('[]'); });
  assert.equal(result.status, 'complete'); assert.equal(result.jobs.length, 0);
});
