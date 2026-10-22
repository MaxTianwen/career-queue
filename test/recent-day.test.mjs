import test from 'node:test';
import assert from 'node:assert/strict';
import { publicationFacts } from '../src/publication-facts.mjs';
import { matchesOpportunity, discoveryPriority } from '../web/v2/opportunity.js';
const now = Date.parse('2026-10-22T02:30:00Z'); // 2026-10-21 22:30 in Toronto
const dated = day => ({ title: 'Software Intern', postedAt: day, sourceEvidence: { postedAtField: 'JobPosting.datePosted' } });
test('date-only postings count as today/yesterday by Toronto date, never as an exact 24 hours', () => {
  for (const [day, recent] of [['2026-10-21', true], ['2026-10-20', true], ['2026-10-19', false], ['2026-10-22', false]]) {
    const f = publicationFacts(dated(day), now);
    assert.equal(f.recentDay, recent, day);
    assert.equal(f.recent24h, false, day);
    assert.equal(matchesOpportunity(dated(day), { publication: '2d', now }), recent, day);
    assert.equal(matchesOpportunity(dated(day), { publication: '24h', now }), false, day);
  }
  const exact = { title: 'Software Intern', postedAt: '2026-10-21T20:00:00Z', sourceEvidence: { postedAtField: 'first_published' } };
  assert.equal(matchesOpportunity(exact, { publication: '2d', now }), true);
  assert.equal(publicationFacts(exact, now).recentDay, false);
});
test('date-only recency gets its own badge wording', () => {
  assert.deepEqual([discoveryPriority(dated('2026-10-21'), now).label, discoveryPriority(dated('2026-10-19'), now).label], ['今天或昨天发布', '']);
});
