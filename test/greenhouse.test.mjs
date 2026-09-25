import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchGreenhouse } from '../src/greenhouse.mjs';

test('public source preserves full JD and never substitutes updated_at for publication', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ id: 123, title: 'Data Intern, Summer 2027',
      content: '&lt;p&gt;Use SQL &amp;amp; Python.&lt;/p&gt;&lt;p&gt;Second paragraph.&lt;/p&gt;',
      updated_at: '2026-09-24T12:00:00Z', location: { name: 'Toronto' } }));
  };
  const job = await fetchGreenhouse('https://job-boards.greenhouse.io/example/jobs/123?utm_source=test', 'Example', fetchImpl);
  assert.equal(job.postedAt, null);
  assert.equal(job.term, 'Summer 2027');
  assert.equal(job.jd, 'Use SQL & Python.\nSecond paragraph.');
  assert.equal(calls[0].url, 'https://boards-api.greenhouse.io/v1/boards/example/jobs/123');
  assert.equal(calls[0].options.redirect, 'error');
});
test('source adapter rejects arbitrary hosts, credentials and paths', async () => {
  for (const url of ['http://127.0.0.1/test', 'https://example.com/jobs/123', 'https://job-boards.greenhouse.io/x/jobs/123/submit', 'https://secret@job-boards.greenhouse.io/x/jobs/123']) {
    await assert.rejects(fetchGreenhouse(url, 'Example', () => { throw new Error('must not fetch'); }), /仅支持/);
  }
});
