import test from 'node:test';
import assert from 'node:assert/strict';
import { EMPLOYER_SOURCES, readEmployerBoard, fetchPinpoint, pinpointUrl } from '../src/discovery-sources.mjs';
import { discover, SOURCE, officialJob, extractFacts } from '../src/discovery.mjs';
import { postingUrl } from '../src/discovery-records.mjs';
import { checkAvailability } from '../src/availability.mjs';

const id = '11111111-2222-3333-4444-555555555555';
const url = `https://www.lifeatvena.com/en/postings/${id}`;
const source = EMPLOYER_SOURCES.find(s => s.id === 'vena');
const post = { url, title: 'Software Developer Co-op (May 2027 | 12-16 months)', description: '<p>Python required.</p>',
  key_responsibilities_header: 'Responsibilities', key_responsibilities: '<ul><li>Build software</li></ul>',
  location: { name: 'Canada - Flex' }, workplace_type: 'hybrid' };
const ld = { '@type': 'JobPosting', title: post.title, identifier: { value: id }, description: '<p>Duration: 12-16 months</p><h2>Requirements</h2><ul><li>Python required</li></ul>',
  datePosted: '2026-09-21T19:30:17+01:00', jobLocation: { name: 'Canada - Flex' } };
const html = value => new Response(`<script type="application/ld+json">${JSON.stringify(value)}</script>`);

test('Pinpoint canonical URLs accept only verified host and paths, without following redirects', async () => {
  assert.equal(postingUrl(url + '/applications/new?source=x'), url);
  for (const bad of ['http://www.lifeatvena.com', 'https://localhost', 'https://www.lifeatvena.com.evil.test', 'https://user:secret@www.lifeatvena.com']) {
    assert.equal(pinpointUrl(bad + '/en/postings/' + id), null);
    await assert.rejects(fetchPinpoint({ url: bad + '/en/postings/' + id }, () => assert.fail('must not fetch')));
  }
  const job = await officialJob({ url }, async (requested, opts) => {
    assert.equal(requested, url); assert.equal(opts.redirect, 'error'); return html(ld);
  });
  assert.match(job.jd, /• Python/); assert.equal(job.postedAt, ld.datePosted); assert.equal(job.deadline, null);
});

test('Pinpoint refuses mismatched identifiers, conflicting structured jobs, maintenance and oversized pages', async () => {
  for (const value of [{ ...ld, identifier: { value: 'other' } }, [ld, { ...ld, title: 'Other' }], {}]) {
    await assert.rejects(fetchPinpoint({ url }, async () => html(value)), /唯一/);
  }
  await assert.rejects(fetchPinpoint({ url }, async () => new Response('', { status: 503 })), /503/);
  await assert.rejects(fetchPinpoint({ url }, async () => new Response('a'.repeat(2_000_001))), /过大/);
});

test('Pinpoint availability distinguishes matching content, explicit closure and access failure', async () => {
  const open = await checkAvailability({ url }, { fetchImpl: async () => html({ ...ld, description: 'Software engineering requirements and responsibilities. '.repeat(5) }) });
  assert.equal(open.status, 'open');
  const closed = await checkAvailability({ url }, { fetchImpl: async () => new Response('<h1>This job is no longer available</h1>') });
  assert.equal(closed.status, 'closed');
  const denied = await checkAvailability({ url }, { fetchImpl: async () => new Response('', { status: 403 }) });
  assert.equal(denied.status, 'unknown');
});

test('Pinpoint board preserves partial failures and does not infer dates or expose hidden salary', async () => {
  const result = await readEmployerBoard(source, async () => Response.json({ data: [{ ...post, compensation_visible: false, compensation: 'secret' }, { ...post, url: 'https://localhost/' }] }));
  assert.equal(result.status, 'partial'); assert.equal(result.jobs.length, 1); assert.equal(result.jobs[0].postedAt, null);
  assert.equal(result.jobs[0].salary, '未披露'); assert.equal(result.jobs[0].deadline, null);
  assert.match(result.jobs[0].jd, /Responsibilities/);
  const paged = await readEmployerBoard(source, async () => Response.json({ data: [post], links: { next: '/next' } }));
  assert.equal(paged.status, 'partial'); assert.equal(paged.jobs.length, 1);
});

test('Pinpoint multiple workplace choices and conflicting location do not become a single definite mode', async () => {
  const choice = 'This position can be on-site in our Toronto office, hybrid or entirely remote in Ontario.';
  const board = await readEmployerBoard(source, async () => Response.json({ data: [{ ...post, description: choice, workplace_type: 'onsite', location: { name: 'Canada - Remote' } }] }));
  const job = extractFacts(board.jobs[0]);
  assert.equal(job.workMode, 'unknown'); assert.equal(job.fieldEvidence.workMode.status, 'ambiguous');
  const detail = extractFacts(await fetchPinpoint(job, async () => html({ ...ld, description: choice })));
  assert.equal(detail.workMode, 'unknown'); assert.equal(detail.fieldEvidence.workMode.raw, choice.slice(0,-1));
});

test('Vena board discovers missing-index jobs, deduplicates application aliases and retains full JD on metadata failure', async () => {
  const entry = { company_name: 'Vena Solutions', title: post.title, terms: ['Summer 2027'], locations: ['Canada'], active: true, is_visible: true, url: url + '/applications/new' };
  const run = (index, detailFails = false) => discover({ sources: [source], fetchImpl: async target => target === SOURCE.dataUrl ? Response.json(index) : target.endsWith('.json') ? Response.json({ data: [post] }) : detailFails ? new Response('', { status: 503 }) : html(ld) });
  const direct = await run([{ ...entry, active: false }]);
  assert.equal(direct.results.length, 1); assert.equal(direct.results[0].term, 'Summer 2027');
  assert.deepEqual(direct.results[0].durationRange, { min: 12, max: 16 });
  assert.equal(direct.results[0].fullJd, true); assert.equal(direct.results[0].sourceName, 'Pinpoint');
  const merged = await run([entry]);
  assert.equal(merged.results.length, 1); assert.equal(merged.results[0].discoverySources.length, 2);
  const failed = await run([{ ...entry, active: false }], true);
  assert.equal(failed.results.length, 1); assert.equal(failed.results[0].fullJd, true);
  assert.match(failed.results[0].fetchError, /503/); assert.equal(failed.results[0].postedAt, null);
});
