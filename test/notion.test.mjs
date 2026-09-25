import test from 'node:test';
import assert from 'node:assert/strict';
import { NotionStore, richText, schema } from '../src/notion.mjs';
import { newRecord, normalizeJob } from '../src/core.mjs';

const id = '11111111-1111-4111-8111-111111111111';
const job = newRecord(normalizeJob({ company: 'Fixture', title: 'Data Intern', url: 'https://example.com/1', jd: 'x'.repeat(4000) }));
function makeStore(replies) {
  const calls = [], waits = [];
  const store = new NotionStore({ token: 'fake-token', dataSourceId: id,
    wait: async ms => waits.push(ms), fetchImpl: async (url, options) => {
      calls.push({ url, options, body: options.body && !(options.body instanceof FormData) ? JSON.parse(options.body) : options.body });
      const reply = replies.shift();
      assert.ok(reply, 'unexpected API request');
      return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200, headers: reply.headers });
    } });
  return { store, calls, waits };
}
const page = record => ({ id, url: 'https://notion.so/test', properties: {
  Payload: { rich_text: richText(JSON.stringify(record)) }, Status: { select: { name: '待提交' } },
  Notes: { rich_text: richText('Human note') }, 'Next step': { rich_text: richText('Human next step') },
  'Application date': { date: null }, 'Last seen': { date: { start: '2026-09-24T16:00:00Z' } }
} });

test('dashboard note edits only write human fields; material links are read from current Notion files', async () => {
  const { store, calls } = makeStore([{}]);
  await store.updateNotes({ ...job, pageId: id }, 'My note', 'My next step');
  assert.deepEqual(Object.keys(calls[0].body.properties), ['Notes', 'Next step']);
  const record = page(job);
  record.properties.Materials = { files: [{ name: 'resume.pdf', file: { url: 'https://example.com/signed-resume.pdf' } }] };
  assert.deepEqual(store.decode(record).attachments, [{ name: 'resume.pdf', url: 'https://example.com/signed-resume.pdf' }]);
});

test('Notion pagination follows cursor and respects manually edited fields', async () => {
  const { store, calls } = makeStore([{ body: { results: [page(job)], has_more: true, next_cursor: 'next' } }, { body: { results: [], has_more: false } }]);
  const records = await store.list();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.start_cursor, 'next');
  assert.equal(records[0].status, '待提交');
  assert.equal(records[0].notes, 'Human note');
  assert.equal(records[0].jd.length, 4000);
  assert.match(calls[0].url, /\/data_sources\/.*\/query$/);
});
test('discovery patch only changes Last seen', async () => {
  const { store, calls } = makeStore([{}]);
  await store.touch({ ...job, pageId: id }, new Date('2026-09-24T16:00:00Z'));
  assert.deepEqual(Object.keys(calls[0].body.properties), ['Last seen']);
});
test('create uses a data-source parent, chunks JD and initializes Queue', async () => {
  const { store, calls } = makeStore([{ body: page(job) }]);
  await store.create(job);
  assert.equal(calls[0].body.parent.data_source_id, id);
  assert.equal(calls[0].body.properties.Status.select.name, 'Queue');
  assert.equal(calls[0].body.properties['Application date'].date, null);
  assert.equal(calls[0].body.children.length, 4);
  assert.equal(calls[0].options.redirect, 'error');
});
test('schema mismatches fail without altering existing databases', async () => {
  const { store, calls } = makeStore([{ body: { properties: {} } }]);
  await assert.rejects(store.check(), /字段缺失/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, 'GET');
  const valid = makeStore([{ body: { properties: Object.fromEntries(Object.entries(schema).map(([key, value]) => [key, { type: Object.keys(value)[0] }])) } }]);
  await valid.store.check();
});
test('429 retry is bounded; ambiguous write errors are not blindly retried', async () => {
  const { store, waits, calls } = makeStore([{ status: 429, headers: { 'Retry-After': '2' } }, { body: { ok: true } }]);
  assert.deepEqual(await store.request('GET', `/data_sources/${id}`), { ok: true });
  assert.deepEqual(waits, [2000]);
  assert.equal(calls.length, 2);
  const failed = makeStore([{ status: 500 }]);
  await assert.rejects(failed.store.request('POST', '/pages', {}), /HTTP 500/);
  assert.equal(failed.calls.length, 1);
  await assert.rejects(failed.store.request('GET', 'https://example.com'));
});
test('state updates preserve human Notes and rich text stays below pagination threshold', async () => {
  const { store, calls } = makeStore([{}]);
  await store.updateState({ ...job, pageId: id, status: '待提交' });
  assert.equal(calls[0].body.properties.Notes, undefined);
  assert.equal(calls[0].body.properties.Materials, undefined);
  assert.ok(richText('x'.repeat(45000)).length <= 25);
  assert.throws(() => richText('x'.repeat(45001)));
});

test('existing dedicated database setup adds only missing fields and is repeatable', async () => {
  const existing = { Position: { type: 'title' }, Status: { type: 'select' }, Custom: { type: 'rich_text' } };
  const { store, calls } = makeStore([{ body: { properties: existing } }, {}]);
  const result = await store.setup();
  assert.ok(result.added.includes('Company'));
  assert.equal(calls[1].body.properties.Position, undefined);
  assert.equal(calls[1].body.properties.Status, undefined);
  assert.equal(calls[1].body.properties.Custom, undefined);
  const ready = makeStore([{ body: { properties: Object.fromEntries(Object.entries(schema).map(([key, value]) => [key, { type: Object.keys(value)[0] }])) } }]);
  assert.deepEqual((await ready.store.setup()).added, []);
  assert.equal(ready.calls.length, 1);
});

test('database resolution refuses ambiguous data sources; setup refuses type conflicts', async () => {
  const one = makeStore([{ body: { data_sources: [{ id }] } }]);
  assert.equal(await one.store.resolveDatabase(id), id);
  const many = makeStore([{ body: { data_sources: [{ id }, { id }] } }]);
  await assert.rejects(many.store.resolveDatabase(id), /多个/);
  const conflict = makeStore([{ body: { properties: { Status: { type: 'status' } } } }]);
  await assert.rejects(conflict.store.setup(), /类型冲突/);
  assert.equal(conflict.calls.length, 1);
});
