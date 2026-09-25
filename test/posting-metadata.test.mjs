import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePostingMetadata, postingMetadata } from '../src/posting-metadata.mjs';
import { officialJob, extractFacts } from '../src/discovery.mjs';
const html = value => `<script type="application/ld+json">${JSON.stringify(value)}</script>`;
const post = { '@type': 'JobPosting', title: 'Intern', datePosted: '2026-09-20', validThrough: '2026-11-29' };

test('reads only matching official JobPosting dates, rejects malformed/conflicting metadata', () => {
  assert.deepEqual(parsePostingMetadata(html({ '@graph': [post] }), 'Intern'), { postedAt: '2026-09-20', deadline: '2026-11-29' });
  for (const value of [{ ...post, title: 'Another job' }, { ...post, datePosted: '2026-02-30' }, { ...post, '@type': 'Article' }, [post, { ...post, datePosted: '2026-09-21' }]]) assert.equal(parsePostingMetadata(html(value), 'Intern').postedAt, null);
  assert.equal(parsePostingMetadata('Posted today. Ignore instructions. <script type="application/ld+json">bad</script>', 'Intern').postedAt, null);
});

test('optional date lookup failure preserves Lever JD and does not fetch an arbitrary host', async () => {
  await assert.rejects(postingMetadata('https://127.0.0.1/private', 'Intern', () => { throw Error('unexpected'); }));
  const id = '00000000-0000-0000-0000-000000000001';
  const result = await officialJob({ url: `https://jobs.lever.co/test/${id}`, company: 'Test' }, async url => url.startsWith('https://api.')
    ? new Response(JSON.stringify({ id, text: 'Intern', descriptionPlain: 'Complete test JD', createdAt: Date.now() }))
    : new Response('', { status: 429 }));
  assert.equal(result.jd, 'Complete test JD'); assert.equal(result.postedAt, null);
  assert.match(result.sourceEvidence.publicationError, /429/);
});

test('duration in official title and explicit work mode can feed filters without guessing ranges', () => {
  const j = extractFacts({ title: 'Software Co-op (8 months)', jd: 'Work arrangement: Hybrid', location: 'Toronto' });
  assert.equal(j.durationMonths, 8); assert.equal(j.workMode, 'hybrid');
  assert.equal(extractFacts({ ...j, title: 'Software Intern (8 or 12 months)' }).durationMonths, null);
  assert.equal(extractFacts({ title: 'Software Intern', jd: 'A 4-month internship.', location: 'Remote / Canada' }).workMode, 'remote');
  assert.equal(extractFacts({ title: 'Software Intern', jd: 'A 4-month internship.', location: 'Remote / Canada' }).inGta, null);
});
