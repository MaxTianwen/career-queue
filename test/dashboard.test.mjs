import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { dashboardServer } from '../src/dashboard.mjs';
import { DemoStore } from '../src/demo-store.mjs';

async function listenForTest(server) {
  // Windows can allocate an ephemeral port that Fetch reserves (e.g. 6000).
  // Select another test port without weakening Fetch's port restrictions.
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${server.address().port}`;
    try { return { url, status: await (await fetch(url + '/api/status')).json() }; }
    catch (error) {
      await new Promise(r => server.close(r));
      if (error.cause?.message !== 'bad port' || attempt === 9) throw error;
    }
  }
}

async function setup(t, storeOverride, discoverImpl) {
  const root = resolve('output/test-runs', randomUUID());
  await mkdir(root, { recursive: true });
  await writeFile(resolve(root, 'career_knowledge_base.md'), '# Synthetic knowledge\nNo real personal information.');
  const server = dashboardServer({ root, storeOverride, discoverImpl });
  const { url, status } = await listenForTest(server);
  t.after(() => new Promise(r => server.close(r)));
  async function request(path, body, mode = 'demo') {
    const res = await fetch(url + path + (path.includes('?') ? '&' : '?') + 'mode=' + mode, body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': status.csrf }, body: JSON.stringify(body)
    });
    return { status: res.status, data: await res.json() };
  }
  return { root, url, request, csrf: status.csrf };
}
const files = { resume: Buffer.from('%PDF-1.7\nSynthetic signature fixture, not a rendered resume.').toString('base64'),
  docx: Buffer.from('PK synthetic format fixture').toString('base64'), reviewNotes: Buffer.from('Synthetic review').toString('base64') };

test('resume library APIs stay local, require CSRF for uploads and never expose arbitrary private files', async t => {
  const { request, url } = await setup(t);
  assert.deepEqual((await request('/api/resume-base', undefined, 'live')).data, { active: {}, versions: [] });
  assert.equal((await request('/api/resume-base')).status, 400);
  assert.equal((await request('/api/resume-base', { track: 'cs', name: 'file.txt', data: '' }, 'live')).status, 400);
  assert.equal((await request('/api/resume-base/activate', { version: '../resume-templates' }, 'live')).status, 400);
  assert.equal((await request('/api/resume-base/file?version=../resume-templates&name=preview.pdf', undefined, 'live')).status, 400);
  const denied = await fetch(url + '/api/resume-base', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(denied.status, 403);
});

test('discovery and saved jobs expose the same direction and evidence without persisting display annotations', async t => {
  const store = new DemoStore();
  const original = (await store.list())[0];
  const job = { ...original, title: 'Technology Intern', jd: 'Develop web applications. Build dashboards using Python.', fullJd: true };
  await store.updateState(job);
  const { root, request } = await setup(t, store, async () => ({ results: [job], finishedAt: new Date().toISOString() }));
  await writeFile(resolve(root, 'career_knowledge_base.md'), '## 5. 技能与证据范围\n| 工作技术 | Python | Synthetic evidence |\n');
  await request('/api/discovery', {}, 'live');
  for (let n = 0; n < 30 && (await request('/api/discovery')).data.state !== 'done'; n++) await new Promise(r => setTimeout(r, 10));
  const discovered = (await request('/api/discovery', undefined, 'live')).data.report.results[0];
  const saved = (await request('/api/jobs', undefined, 'live')).data.jobs.find(j => j.key === job.key);
  assert.equal(discovered.resumeClassification.track, 'mixed');
  assert.deepEqual(discovered.jdHighlights, saved.jdHighlights);
  assert.ok(saved.jdHighlights.some(r => job.jd.slice(r.start, r.end) === 'Python'));
  assert.equal((await store.list()).find(j => j.key === job.key).jdHighlights, undefined);
  assert.equal((await request('/api/jobs')).data.jobs[0].jdHighlights.length, 0);
});

test('workspace link uses local database configuration without a bundled private identifier', async t => {
  const { root, request } = await setup(t);
  for (const databaseId of ['', 'not-a-database-id', '11111111-2222-3333-4444-555555555555']) {
    await writeFile(resolve(root, '.env'), `NOTION_DATABASE_ID=${databaseId}\n`);
    const result = await request('/api/status', undefined, 'live');
    assert.equal(result.data.notionUrl, databaseId.startsWith('11111111')
      ? 'https://app.notion.com/p/11111111222233334444555555555555' : 'https://www.notion.so');
  }
});

test('PDF preview is inline and same-origin only; other files remain downloads and traversal stays blocked', async t => {
  const { root, url } = await setup(t);
  const key = 'd'.repeat(24), version = 'resume-fixture';
  const folder = resolve(root, 'output', key, version);
  await mkdir(folder, { recursive: true });
  await writeFile(resolve(folder, 'resume.pdf'), '%PDF-1.7\nSynthetic fixture');
  await writeFile(resolve(folder, 'review.md'), 'Synthetic review');
  const path = `/api/file?mode=live&key=${key}&version=${version}&name=resume.pdf`;
  const download = await fetch(url + path);
  assert.match(download.headers.get('content-disposition'), /^attachment/);
  const preview = await fetch(url + path + '&preview=1');
  assert.equal(preview.status, 200);
  assert.match(preview.headers.get('content-type'), /application\/pdf/);
  assert.match(preview.headers.get('content-disposition'), /^inline/);
  assert.match(preview.headers.get('content-security-policy'), /frame-ancestors 'self'/);
  assert.match(preview.headers.get('cache-control'), /no-store/);
  assert.equal(await preview.text(), await download.text());
  assert.equal((await fetch(url + path.replace('resume.pdf', 'review.md') + '&preview=1')).status, 400);
  assert.equal((await fetch(url + path.replace(version, '..') + '&preview=1')).status, 400);
});

test('resume generation rejects demo, unselected sources, nonexistent discoveries and incomplete jobs', async t => {
  const { request } = await setup(t);
  assert.equal((await request('/api/resume/generate', { key: 'a'.repeat(24), source: 'discovery' })).status, 400);
  assert.equal((await request('/api/resume/generate', { key: 'a'.repeat(24), source: '../../private' }, 'live')).status, 400);
  assert.equal((await request('/api/resume/generate', { key: 'a'.repeat(24), source: 'discovery' }, 'live')).status, 400);
  assert.equal((await request('/api/resume/generate', { key: 'a'.repeat(24), source: 'discovery', job: { jd: 'injected content' } }, 'live')).status, 400);
  assert.equal((await request('/api/status', undefined, 'live')).data.resume.ready, false);
  assert.equal((await request('/api/resume/edit?key=../private&version=working', undefined, 'live')).status, 400);
  assert.equal((await request('/api/resume/edit?key=' + 'a'.repeat(24) + '&version=resume-123-12345678')).status, 400);
  assert.equal((await request('/api/resume/edit', { key: 'a'.repeat(24), version: '../private', edits: [] }, 'live')).status, 400);
  assert.equal((await request('/api/resume/edit', {}, 'demo')).status, 400);
});

test('dashboard manual workflow: notes, preparation, files, ready, confirmed submission and progress', async t => {
  const { request, url } = await setup(t);
  const jobs = (await request('/api/jobs')).data.jobs;
  assert.equal(jobs.length, 3);
  const key = jobs[0].key, path = `/api/jobs/${key}`;
  await request(path + '/notes', { notes: '用户备注', nextStep: '核对 JD' });
  const prepared = await request(path + '/prepare', {});
  assert.equal(prepared.status, 200);
  let detail = (await request(path)).data;
  assert.equal(detail.status, 'Queue');
  assert.equal(detail.notes, '用户备注');
  assert.equal(detail.localFiles.length, 2);
  const ctx = detail.localFiles.find(x => x.name === 'context.json');
  const saved = await (await fetch(url + ctx.url)).json();
  assert.match(saved.knowledge, /演示资料/);
  assert.doesNotMatch(saved.knowledge, /Synthetic knowledge/);
  assert.equal((await request(path + '/complete', { files, checked: false })).status, 400);
  assert.equal((await request(path + '/complete', { files, checked: true })).status, 200);
  detail = (await request(path)).data;
  assert.equal(detail.status, '待提交'); assert.equal(detail.applicationDate, null);
  assert.equal(detail.localFiles.length, 5);
  assert.equal((await request(path + '/submitted', { date: '2026-01-01', confirmed: false })).status, 400);
  await request(path + '/submitted', { date: '2026-01-01', confirmed: true });
  assert.equal((await request(path)).data.status, '已投递');
  assert.equal((await request(path + '/complete', { files, checked: true })).status, 400);
  await request(path + '/progress', { status: '面试中', nextStep: '准备技术面试' });
  detail = (await request(path)).data;
  assert.equal(detail.applicationDate, '2026-01-01'); assert.equal(detail.notes, '用户备注');
  assert.equal(detail.status, '面试中');
});

test('archived jobs remain deduplicated; invalid uploads never move a record', async t => {
  const { request } = await setup(t);
  const job = (await request('/api/jobs')).data.jobs[0];
  const path = `/api/jobs/${job.key}`;
  const invalid = { ...files, resume: Buffer.from('not a pdf').toString('base64') };
  assert.equal((await request(path + '/complete', { files: invalid, checked: true })).status, 400);
  assert.equal((await request(path)).data.status, 'Queue');
  await request(path + '/archive', { confirmed: true });
  assert.equal((await request('/api/jobs')).data.jobs.length, 2);
  const report = (await request('/api/ingest', { jobs: [job] })).data;
  assert.equal(report.duplicates.length, 1);
  assert.equal((await request('/api/jobs')).data.jobs.length, 2);
  assert.equal((await request(path + '/prepare', {})).status, 400);
});

test('localhost boundary rejects foreign origins, missing CSRF, host rebinding and private file paths', async t => {
  const { url, csrf, request } = await setup(t);
  assert.equal((await fetch(url + '/api/status', { headers: { Origin: 'https://untrusted.example' } })).status, 403);
  const foreignHostStatus = await new Promise((resolve, reject) => {
    const req = httpRequest(url + '/api/status', { headers: { Host: 'untrusted.example' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(foreignHostStatus, 403);
  assert.equal((await fetch(url + '/api/ingest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal((await fetch(url + '/.env')).status, 404);
  assert.equal((await request('/api/file?key=../../&version=..&name=.env')).status, 400);
  const key = (await request('/api/jobs')).data.jobs[0].key;
  await request(`/api/jobs/${key}/prepare`, {});
  assert.equal((await request(`/api/file?key=${key}&version=..&name=demo-knowledge.md`)).status, 403);
  assert.equal((await fetch(url + '/api/ingest', { method: 'POST', headers: { 'Content-Type': 'text/plain', 'X-CSRF-Token': csrf }, body: '{}' })).status, 415);
  assert.equal((await request('/api/fetch', { company: 'Test', url: 'http://127.0.0.1/secrets' })).status, 400);
});

test('overlapping writes are rejected while the first upload is in progress', async t => {
  const store = new DemoStore();
  let release, started;
  const pending = new Promise(r => { release = r; });
  const entered = new Promise(r => { started = r; });
  store.upload = async () => { started(); await pending; return { demo: true }; };
  const { request } = await setup(t, store);
  const key = (await request('/api/jobs', undefined, 'live')).data.jobs[0].key;
  const first = request(`/api/jobs/${key}/complete`, { files, checked: true }, 'live');
  await entered;
  try { assert.equal((await request(`/api/jobs/${key}/archive`, { confirmed: true }, 'live')).status, 409); }
  finally { release(); }
  assert.equal((await first).status, 200);
  assert.equal((await request(`/api/jobs/${key}`, undefined, 'live')).data.status, '待提交');
});

test('Notion failure is an error, not an empty list; failed upload preserves queue and local files', async t => {
  const store = new DemoStore();
  store.upload = async () => { throw new Error('Simulated Notion upload failure'); };
  const { request, root } = await setup(t, store);
  const key = (await request('/api/jobs', undefined, 'live')).data.jobs[0].key;
  const result = await request(`/api/jobs/${key}/complete`, { checked: true, files }, 'live');
  assert.equal(result.status, 400);
  const detail = (await request(`/api/jobs/${key}`, undefined, 'live')).data;
  assert.equal(detail.status, 'Queue'); assert.equal(detail.localFiles.length, 3);
  assert.ok((await readFile(resolve(root, 'career_knowledge_base.md'), 'utf8')).includes('Synthetic'));
  store.list = async () => { throw new Error('Simulated connection failure'); };
  const failed = await request('/api/jobs', undefined, 'live');
  assert.equal(failed.status, 400); assert.match(failed.data.error, /connection failure/);
});

test('automatic discovery runs without Notion, survives page reload and reports progress and cooldown honestly', async t => {
  let release, count = 0;
  const wait = new Promise(r => { release = r; });
  const report = { dataVersion: 4, targetTerms: ['Winter 2027', 'Summer 2027', 'Fall 2027'], startedAt: new Date().toISOString(), total: 1, candidates: 1, processed: 0, results: [], errors: [] };
  const { request, root } = await setup(t, undefined, async ({ onProgress }) => {
    count++; onProgress({ phase: 'Reading official JD', report }); await wait;
    return { ...report, processed: 1, finishedAt: new Date().toISOString() };
  });
  assert.equal((await request('/api/discovery', {}, 'demo')).status, 400);
  assert.equal((await request('/api/discovery', {}, 'live')).status, 202);
  assert.equal((await request('/api/discovery', undefined, 'live')).data.state, 'running');
  assert.equal((await request('/api/discovery', {}, 'live')).status, 202); assert.equal(count, 1);
  assert.match((await request('/api/discovery/save', { key: 'a'.repeat(24) }, 'live')).data.error, /去重结束/);
  assert.match((await request('/api/resume/generate', { source: 'discovery', key: 'a'.repeat(24) }, 'live')).data.error, /去重结束/);
  release();
  let result;
  for (let n = 0; n < 30; n++) {
    result = (await request('/api/discovery', undefined, 'live')).data;
    if (result.state === 'done') break;
    await new Promise(r => setTimeout(r, 10));
  }
  assert.equal(result.state, 'done');
  assert.equal((await request('/api/discovery', {}, 'live')).data.cached, true);
  assert.equal(count, 1);
  assert.equal(JSON.parse(await readFile(resolve(root, 'output/discovery/latest.json'), 'utf8')).processed, 1);
  const restarted = dashboardServer({ root });
  await listenForTest(restarted);
  t.after(() => new Promise(r => restarted.close(r)));
  const restored = await (await fetch(`http://127.0.0.1:${restarted.address().port}/api/discovery`)).json();
  assert.equal(restored.state, 'done'); assert.equal(restored.report.processed, 1);
});

test('search result save deduplicates into Queue; incomplete and excluded results cannot enter', async t => {
  const store = new DemoStore();
  const original = (await store.list())[0];
  // A stale snapshot rejected only for age must become eligible again under current rules.
  const eligible = { ...original, fullJd: true, postedAt: '2020-01-01', deadline: '2099-01-01', decision: 'REJECT', reasons: ['发布超过24小时'] };
  const report = { results: [eligible, { key: 'missing', fullJd: false }, { key: 'reject', fullJd: true, decision: 'REJECT' }], finishedAt: new Date().toISOString() };
  const { request } = await setup(t, store, async () => report);
  await request('/api/discovery', {}, 'live');
  for (let n = 0; n < 30 && (await request('/api/discovery')).data.state !== 'done'; n++) await new Promise(r => setTimeout(r, 10));
  assert.equal((await request('/api/discovery/save', { key: eligible.key }, 'demo')).status, 400);
  assert.equal((await request('/api/discovery/save', { key: 'missing' }, 'live')).status, 400);
  assert.equal((await request('/api/discovery/save', { key: 'reject' }, 'live')).status, 400);
  assert.notEqual((await request('/api/discovery', undefined, 'live')).data.report.results.find(j => j.key === eligible.key).decision, 'REJECT');
  const saved = await request('/api/discovery/save', { key: eligible.key }, 'live');
  assert.equal(saved.status, 200); assert.equal(saved.data.duplicates.length, 1);
  assert.equal((await store.list()).length, 3);
});

test('discovery source failure remains an error and can be retried', async t => {
  let count = 0;
  const { request } = await setup(t, undefined, async () => { count++; throw new Error('Source offline'); });
  await request('/api/discovery', {}, 'live');
  const result = (await request('/api/discovery', undefined, 'live')).data;
  assert.equal(result.state, 'error'); assert.match(result.error, /Source offline/);
  await request('/api/discovery', {}, 'live'); assert.equal(count, 2);
});

test('conflicting discovery identity cannot write Queue or generate materials', async t => {
  const store = new DemoStore();
  const conflicted = { ...(await store.list())[0], identityConflict: true, fullJd: true };
  const { request } = await setup(t, store, async () => ({ results: [conflicted], finishedAt: new Date().toISOString() }));
  await request('/api/discovery', {}, 'live');
  for (let n = 0; n < 30 && (await request('/api/discovery')).data.state !== 'done'; n++) await new Promise(r => setTimeout(r, 10));
  for (const [path, body] of [['/api/discovery/save', { key: conflicted.key }], ['/api/resume/generate', { source: 'discovery', key: conflicted.key }]]) {
    const result = await request(path, body, 'live');
    assert.equal(result.status, 400); assert.match(result.data.error, /身份有冲突/);
  }
  assert.equal((await store.list()).length, 3);
});

test('v1.0.1 search snapshots refresh before applying the new deduplication cache', async t => {
  let count = 0;
  const { request } = await setup(t, undefined, async () => ({ dataVersion: ++count === 1 ? 3 : 4,
    targetTerms: ['Winter 2027', 'Summer 2027', 'Fall 2027'], results: [], finishedAt: new Date().toISOString() }));
  async function run() {
    const response = await request('/api/discovery', {}, 'live');
    for (let n = 0; n < 30 && (await request('/api/discovery')).data.state !== 'done'; n++) await new Promise(r => setTimeout(r, 10));
    return response;
  }
  await run(); assert.equal((await run()).status, 202);
  assert.equal((await run()).data.cached, true); assert.equal(count, 2);
});

test('expanding target terms invalidates an otherwise fresh search cache', async t => {
  let count = 0;
  const current = ['Winter 2027', 'Summer 2027', 'Fall 2027'];
  const { request } = await setup(t, undefined, async () => ({ dataVersion: 4, targetTerms: ++count === 1 ? ['Summer 2027', 'Fall 2027'] : current, results: [], finishedAt: new Date().toISOString() }));
  async function run() {
    const response = await request('/api/discovery', {}, 'live');
    for (let n = 0; n < 30 && (await request('/api/discovery')).data.state !== 'done'; n++) await new Promise(r => setTimeout(r, 10));
    return response;
  }
  await run();
  assert.equal((await run()).status, 202);
  assert.equal(count, 2);
  assert.equal((await run()).data.cached, true);
  assert.equal(count, 2);
});

test('expired cached discoveries and Queue records are hidden without deleting application history; scores stay local', async t => {
  const store = new DemoStore();
  const original = (await store.list())[0];
  const expired = { ...original, jd: 'Qualifications\nPython and SQL.\nApplication deadline: January 1, 2000', fullJd: true };
  await store.updateState(expired);
  const future = { ...expired, key: 'aaaaaaaaaaaaaaaaaaaaaaaa', title: 'Future job', jd: 'Qualifications\nPython and SQL.\nApply by January 1, 2099', url: 'https://example.com/future' };
  const { request, root } = await setup(t, store, async () => ({ results: [expired, future], finishedAt: new Date().toISOString() }));
  await writeFile(resolve(root, 'career_knowledge_base.md'), '# Private name\nSECRET-CONTACT\n## 5. 技能与证据范围\n| 工作技术 | Python、SQL | EXP-TEST |\n## 6. Other\n');
  await request('/api/discovery', {}, 'live');
  for (let n = 0; n < 30 && (await request('/api/discovery')).data.state !== 'done'; n++) await new Promise(r => setTimeout(r, 10));
  const report = (await request('/api/discovery', undefined, 'live')).data.report;
  assert.equal(report.expiredCount, 1); assert.equal(report.results.length, 1);
  assert.equal(report.results[0].match.score, 100);
  assert.doesNotMatch(JSON.stringify(report), /SECRET-CONTACT/);
  assert.equal((await request('/api/discovery/save', { key: expired.key }, 'live')).status, 400);
  assert.ok(!(await request('/api/jobs', undefined, 'live')).data.jobs.some(x => x.key === expired.key));
  assert.equal((await request(`/api/jobs/${expired.key}/prepare`, {}, 'live')).status, 400);
  assert.equal((await store.list()).length, 3);
  await store.updateState({ ...expired, status: '已投递', applicationDate: '1999-12-31' });
  assert.ok((await request('/api/jobs', undefined, 'live')).data.jobs.some(x => x.key === expired.key && x.status === '已投递'));
  await writeFile(resolve(root, 'career_knowledge_base.md'), '# Missing skill evidence');
  assert.equal((await request('/api/discovery', undefined, 'live')).data.report.results[0].match.score, null);
});
