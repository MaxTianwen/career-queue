import test from 'node:test';
import assert from 'node:assert/strict';
import { collapseSamePostings, unifiedOpportunities } from '../src/v2/unified-opportunities.mjs';
import { fetchCatalogue } from '../src/v2/catalogue.mjs';
const title = 'Application/Software Developer Co-op (Winter 2027), Capital Markets Technology';
const job = (url, extra = {}) => ({ id: url, company: 'CIBC', title, url, jd: 'Build trading software.', sources: [{ id: 'index' }], ...extra });
const search = 'https://cibc.wd3.myworkdayjobs.com/search/job/Toronto-ON/Developer-Co-op_2621523-1',
  campus = 'https://cibc.wd3.myworkdayjobs.com/campus/job/Toronto-ON/Developer-Co-op_2621523';

test('one requisition listed on two Workday sites collapses to one card that keeps both links', () => {
  const [one, ...rest] = collapseSamePostings([job(search), job(campus, { sources: [{ id: 'boards' }] })]);
  assert.equal(rest.length, 0);
  assert.equal(one.url, campus, 'prefers the link without a repost suffix');
  assert.deepEqual(one.aliasUrls, [search]);
  assert.deepEqual(one.sources.map(s => s.id), ['index', 'boards']);
});
test('a full JD wins, and different requisitions, titles or employers stay separate', () => {
  assert.equal(collapseSamePostings([job(search), job(campus, { jd: '' })])[0].url, search);
  assert.equal(collapseSamePostings([job(campus), job('https://cibc.wd3.myworkdayjobs.com/campus/job/Toronto-ON/Developer_2610868')]).length, 2);
  assert.equal(collapseSamePostings([job(campus), job(search, { title: 'Analyst Co-op (Winter 2027)' })]).length, 2);
  assert.equal(collapseSamePostings([job(campus), job(search, { company: 'BMO' })]).length, 2);
  assert.equal(collapseSamePostings([job('https://example.test/a', { requisitionId: '' }), job('https://example.test/b', { requisitionId: '' })]).length, 2);
});
test('a draft saved from the collapsed link still attaches to the remaining card', () => {
  const [kept] = collapseSamePostings([job(search), job(campus)]);
  const [card] = unifiedOpportunities('owner', { jobs: [kept] }, [], [{ id: 'draft-1', url: search }]);
  assert.deepEqual(card.draftIds, ['draft-1']);
});
test('catalogue output is collapsed and the boards status names the boards that failed', async () => {
  const result = await fetchCatalogue({
    sources: [{ id: 'index', name: 'Index' }, { id: 'boards', name: 'Boards' }],
    readIndex: async () => ({ jobs: [{ company: 'CIBC', title, url: search, location: 'Toronto, ON, Canada', jd: 'Build software applications. Winter 2027, 4 months.', indexInternship: true }], raw: 1, status: 'complete', registry: [{ id: 'board:workday:cibc/campus' }] }),
    readBoards: async () => ({ jobs: [{ company: 'CIBC', title, url: campus, location: 'Toronto, ON', jd: 'Build software applications. Winter 2027, 4 months.', boardId: 'board:workday:cibc/campus' }], raw: 1, status: 'partial', boards: 2, failedBoards: ['board:workday:other/x'] }),
    readDetail: async () => ({})
  });
  assert.equal(result.jobs.length, 1);
  assert.deepEqual(result.sources.find(s => s.id === 'boards').failedBoards, ['board:workday:other/x']);
  assert.equal(result.jobs[0].boardId, 'board:workday:cibc/campus');
});
test('saving keeps old board records only from boards that failed this time, and collapses leftovers', async () => {
  const { WorkspaceStore } = await import('../src/v2/store.mjs');
  const s = new WorkspaceStore(':memory:');
  try {
    const board = (url, boardId) => ({ ...job(url), id: url, boardId, source: { id: 'boards' }, sources: [{ id: 'boards' }] });
    s.saveCatalogue({ jobs: [board('https://a.test/1', 'board:a'), board('https://b.test/2', 'board:b'), board(search, 'board:c')], sources: [{ id: 'boards', status: 'complete' }], finishedAt: new Date().toISOString() });
    s.saveCatalogue({ jobs: [board(campus, 'board:c')], sources: [{ id: 'boards', status: 'partial', failedBoards: ['board:b'] }], finishedAt: new Date().toISOString() });
    const urls = s.catalogue().jobs.map(j => j.url).sort();
    assert.deepEqual(urls, ['https://b.test/2', campus].sort(), 'board:a vanished and is dropped; board:b failed and is kept; the -1 repost collapses');
  } finally {
    s.close();
  }
});
