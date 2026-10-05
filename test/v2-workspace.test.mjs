import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { workspaceServer } from '../src/v2/server.mjs';
import { WorkspaceStore, SESSION_MS, FILE_BYTES } from '../src/v2/store.mjs';
import { catalogueJob, fetchCatalogue, recommend } from '../src/v2/catalogue.mjs';
import { scoreFor } from '../src/v2/resume.mjs';

const password = 'Synthetic test password 2026!';
const changedPassword = 'Another synthetic password 2026!';

test('v2 scheduler requires independent credentials and admin settings; users can read only public status', async t => {
  const secret = 'c'.repeat(64);
  const f = await fixture(t, { automationToken: secret, online: async () => true, discover: async () => ({jobs:[],sources:[{id:'test',status:'complete'}],finishedAt:new Date().toISOString()}) });
  const a = await f.account('alice');
  assert.equal((await f.call('/api/discovery/status')).status, 401);
  assert.equal((await f.call('/api/discovery/status', {auth:a})).data.canManage, false);
  assert.equal((await f.call('/api/discovery/settings', {method:'PUT',auth:a,value:{enabled:true}})).status,403);
  const db = new WorkspaceStore(f.database);db.db.prepare("UPDATE users SET role='admin' WHERE id=?").run(a.id);db.close();
  assert.equal((await f.call('/api/discovery/settings', {method:'PUT',auth:a,value:{enabled:true}})).status,200);
  for (const headers of [{},{Authorization:'Bearer invalid'}]) assert.equal((await f.call('/api/discovery/tick',{method:'POST',value:{},headers})).status,403);
  assert.equal((await f.call('/api/discovery/tick',{method:'POST',value:{},headers:{Authorization:`Bearer ${secret}`}})).status,200);
  const status=await f.call('/api/discovery/status',{auth:a}); assert.equal(JSON.stringify(status.data).includes(secret),false);
  await f.call('/api/discovery/settings',{method:'PUT',auth:a,value:{enabled:false}});
  assert.equal((await f.call('/api/discovery/tick',{method:'POST',value:{},headers:{Authorization:`Bearer ${secret}`}})).data.skipped,true);
});

test('v2 no-link school checks preserve independent school deadline and never fetch a missing URL', async t => {
  let calls = 0;
  const f = await fixture(t, { ...wordOptions, availability: async () => { calls++; return { status: 'open' }; } }), a = await f.account('alice'), p = await wordApplication(f, a);
  const base = `/api/jobs/${p.job.id}`;
  await f.call(base, { method: 'PUT', auth: a, value: { ...p.job, url: '' } });
  const before = calls;
  let result = await f.call(`${base}/availability`, { method: 'POST', auth: a, value: {} });
  assert.equal(result.data.status, 'unknown'); assert.equal(calls, before);
  const text = '|Term|ID|Job Title|Organization|Location|App Deadline|\n|---|---|---|---|---|---|\n|2028 - Summer|900222|Developer|Synthetic Company|Toronto, ON|Jan 1, 2020 11:59 PM|';
  const preview = (await f.call('/api/school/preview', { auth: a, method: 'POST', value: { text } })).data;
  const linked = await f.call('/api/school/import', { auth: a, method: 'POST', value: { text, fingerprint: preview.fingerprint, selections: [{ index: 0, target: `saved:${p.job.id}` }], confirmed: true, requestId: randomUUID() } });
  assert.equal(linked.status, 200, linked.text);
  result = await f.call(`${base}/availability`, { method: 'POST', auth: a, value: {} });
  assert.equal(result.data.status, 'closed'); assert.equal(calls, before);
  await f.call(base, { method: 'PUT', auth: a, value: p.job });
  result = await f.call(`${base}/availability`, { method: 'POST', auth: a, value: {} });
  assert.equal(result.data.status, 'open');
});

test('v2 availability binds session, inputs and time; unknown requires confirmation and closed cannot be forged', async t => {
  let time = Date.now(), status = 'unknown';
  const f = await fixture(t, { ...wordOptions, now: () => time, availability: async () => ({ status, evidence: 'Synthetic official result' }) });
  const a = await f.account('alice'), b = await f.account('bob'), p = await wordApplication(f, a);
  const base = `/api/jobs/${p.job.id}`, send = value => f.call(`${base}/generation`, { method: 'POST', auth: a, value });
  assert.equal((await f.call(`${base}/availability`, { method: 'POST', auth: b, value: {} })).status, 404);
  assert.equal((await send({ ...p.input, availability: undefined })).status, 409);
  assert.equal((await send({ ...p.input, openConfirmed: false })).status, 409);
  time += 15 * 60000 + 1;
  assert.equal((await send(p.input)).status, 409);
  p.input.availability = (await f.call(`${base}/availability`, { method: 'POST', auth: a, value: {} })).data;
  assert.equal((await send(p.input)).status, 200);
  status = 'closed';
  p.input.availability = (await f.call(`${base}/availability`, { method: 'POST', auth: a, value: {} })).data;
  assert.equal((await send({ ...p.input, availability: { ...p.input.availability, status: 'open' } })).status, 409);
  assert.equal((await f.call(`${base}/generation-draft`, { method: 'POST', auth: a, value: {} })).status, 409);
  status = 'open';
  p.input.availability = (await f.call(`${base}/availability`, { method: 'POST', auth: a, value: {} })).data;
  await f.restart();
  assert.equal((await send(p.input)).status, 409);
});

test('v2 availability failure is unknown, late source changes reject the check without rewriting JD', async t => {
  let release, started, delayed = false;
  const f = await fixture(t, { ...wordOptions, availability: async () => {
    if (!delayed) throw Error('Network failure');
    started(); await new Promise(resolve => { release = resolve; });
    return { status: 'open', evidence: 'Synthetic', job: { jd: 'Must not overwrite saved JD' } };
  } });
  const a = await f.account('alice'), p = await wordApplication(f, a), base = `/api/jobs/${p.job.id}`;
  assert.equal(p.input.availability.status, 'unknown');
  delayed = true; const waiting = new Promise(resolve => { started = resolve; });
  const pending = f.call(`${base}/availability`, { method: 'POST', auth: a, value: {} }); await waiting;
  assert.equal((await f.call(`${base}/availability`, { method: 'POST', auth: a, value: {} })).status, 409);
  await f.call(base, { method: 'PUT', auth: a, value: { ...p.job, jd: 'Updated saved JD' } });
  release(); assert.equal((await pending).status, 409);
  assert.equal((await f.call(`${base}/application`, { auth: a })).data.context.job.jd, 'Updated saved JD');
});

test('v2 password changes require own credentials and CSRF, revoke old sessions and preserve private data', async t => {
  const f = await fixture(t, materialOptions), a = await f.account('alice'), b = await f.account('bob');
  const prepared = await prepareApplication(f, a);
  await f.call(`/api/jobs/${prepared.saved.id}/channel`, { method: 'PUT', auth: a, value: { channel: 'both' } });
  await f.call(`/api/files/${prepared.file.id}/preview`, { method: 'POST', auth: a, value: {} });
  const reviewed = await f.call(`/api/jobs/${prepared.saved.id}/materials`, { method: 'POST', auth: a, value: prepared.value });
  assert.equal(reviewed.status, 200);
  const submitted = await f.call(`/api/jobs/${prepared.saved.id}/submission`, { method: 'POST', auth: a, value: { channel: 'school', materialId: reviewed.data.versions[0].id, date: '2026-01-01', confirmed: true, attachmentsComplete: true } });
  assert.equal(submitted.status, 200);
  const before = (await f.call(`/api/jobs/${prepared.saved.id}/application`, { auth: a })).data;
  const path = '/api/account/password', value = { currentPassword: password, newPassword: changedPassword, confirmPassword: changedPassword, username: 'bob', owner: 'bob' };
  assert.equal((await f.call(path, { method: 'POST', value })).status, 401);
  assert.equal((await f.call(path, { method: 'POST', auth: { ...a, csrf: 'wrong' }, value })).status, 403);
  for (const bad of [{ currentPassword: 'Wrong current password!' }, { newPassword: 'short' }, { confirmPassword: 'Mismatch password!' }, { newPassword: password, confirmPassword: password }]) {
    assert.equal((await f.call(path, { method: 'POST', auth: a, value: { ...value, ...bad } })).status, 400);
    assert.equal((await f.call('/api/session', { auth: a })).status, 200);
  }
  const result = await f.call(path, { method: 'POST', auth: a, value });
  assert.equal(result.status, 200); assert.match(result.headers['set-cookie'][0], /Max-Age=0/);
  assert.equal((await f.call('/api/session', { auth: a })).status, 401);
  assert.equal((await f.call('/api/session', { auth: b })).status, 200);
  assert.equal((await f.call('/api/login', { method: 'POST', value: { username: 'alice', password } })).status, 401);
  const login = await f.call('/api/login', { method: 'POST', value: { username: 'alice', password: changedPassword } });
  assert.equal(login.status, 200);
  const fresh = { cookie: login.headers['set-cookie'][0].split(';')[0], csrf: login.data.csrf };
  assert.deepEqual((await f.call(`/api/jobs/${prepared.saved.id}/application`, { auth: fresh })).data, before);
  const db = new DatabaseSync(f.database); assert.equal(db.prepare('SELECT count(*) n FROM pdf_reviews').get().n, 0); db.close();
  await f.restart(); assert.equal((await f.call('/api/session', { auth: fresh })).status, 200);
  assert.equal((await f.call('/api/admin/reset-password', { method: 'POST', auth: fresh, value })).status, 404);
});

test('v2 password guessing shares the persisted authentication attempt limit', async t => {
  const f = await fixture(t), a = await f.account('alice');
  const db = new DatabaseSync(f.database);
  for (let i=0;i<20;i++) db.prepare('INSERT INTO auth_attempts VALUES (?)').run(Date.now());
  db.close();
  const result = await f.call('/api/account/password', { method: 'POST', auth: a, value: { currentPassword: password, newPassword: changedPassword, confirmPassword: changedPassword } });
  assert.equal(result.status, 429); assert.equal((await f.call('/api/session', { auth: a })).status, 200);
});
const job = { company: 'Synthetic Company', title: 'Developer', location: 'Test City', url: 'https://example.com/job/1', notes: 'Private note' };
const source = { id: 'synthetic', name: 'Synthetic', url: 'https://example.com/careers' };
const publicJob = catalogueJob({ ...job, title: 'Software Developer Intern', location: 'Vancouver, Canada', jd: 'Requirements\nPython and SQL required.\nFour months, Summer 2028.', deadline: '2028-12-01' }, source);
const resumeText = 'Synthetic graduate. Built data analysis projects using Python and SQL. Designed reports for stakeholders.';
const wordBytes = Buffer.from([80, 75, 3, 4, 1, 2]);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const wordOptions = {
  extract: async () => ({ text: resumeText, pages: null, parser: 'fixture' }),
  prepare: async () => ({ fingerprint: 'draft', groups: [] }),
  generate: async (owner, context, file) => {
    const pdf = Buffer.from('%PDF-1.7 fixture generated');
    return { pdf, docx: wordBytes, review: { groups: [] }, validation: { passed: true, pages: 1, templateSha256: file.sha256, pdfSha256: sha(pdf), docxSha256: sha(wordBytes) } };
  }
};
const editOptions = { ...wordOptions,
  prepareEdit: async () => ({ fingerprint: 'edit-draft', fields: [{ paragraph: 3, original: 'Synthetic original evidence', label: 'Projects' }] }),
  edit: async (owner, context, file, input) => {
    const pdf = Buffer.from('%PDF-1.7 synthetic edited'), docx = Buffer.concat([wordBytes, Buffer.from('edited')]);
    return { pdf, docx, review: { mode: 'manual-edit', groups: [], edits: input.edits }, validation: { passed: true, pages: 1, templateSha256: file.sha256, pdfSha256: sha(pdf), docxSha256: sha(docx) } };
  }
};
test('v2 manual edits preserve old submissions, source chain and current scoring baseline', async t => {
  const f = await fixture(t, { ...editOptions, preview: async () => ({ pages: 1, images: [] }) }), a = await f.account('alice'), b = await f.account('bob'), p = await wordApplication(f, a);
  const generated = (await f.call(`/api/jobs/${p.job.id}/generation`, { auth: a, method: 'POST', value: p.input })).data;
  const prefix = `/api/jobs/${p.job.id}/generation/${generated.id}`;
  assert.equal((await f.call(`${prefix}/edit-draft`, { auth: b, method: 'POST', value: {} })).status, 404);
  await f.call(`/api/files/${generated.pdfId}/preview`, { auth: a, method: 'POST', value: {} });
  const appPath = `/api/jobs/${p.job.id}`;
  await f.call(`${appPath}/channel`, { auth: a, method: 'PUT', value: { channel: 'employer' } });
  const materials = (await f.call(`${appPath}/materials`, { auth: a, method: 'POST', value: { contextHash: p.input.contextHash, resumeFileId: generated.pdfId, confirmed: true } })).data;
  await f.call(`${appPath}/submission`, { auth: a, method: 'POST', value: { channel: 'employer', materialId: materials.versions[0].id, date: '2026-01-01', receipt: '', confirmed: true, attachmentsComplete: true } });
  const before = (await f.call(`${appPath}/application`, { auth: a })).data;
  const draft = (await f.call(`${prefix}/edit-draft`, { auth: a, method: 'POST', value: {} })).data;
  const value = { ...draft, confirmed: true, openConfirmed: true, edits: [{ paragraph: 3, text: 'Synthetic edited evidence' }] };
  assert.equal((await f.call(`${prefix}/edit`, { auth: a, method: 'POST', value: { ...value, confirmed: false } })).status, 409);
  const saved = await f.call(`${prefix}/edit`, { auth: a, method: 'POST', value }); assert.equal(saved.status, 200, saved.text);
  assert.equal(saved.data.snapshot.parentId, generated.id);
  assert.notEqual(saved.data.pdfId, generated.pdfId);
  assert.equal((await f.call(`${prefix}/edit`, { auth: a, method: 'POST', value })).data.id, saved.data.id);
  assert.equal((await f.call('/api/files', { auth: a })).data.length, 5);
  assert.equal((await f.call('/api/resume', { auth: a })).data.fileId, p.file.id);
  assert.deepEqual((await f.call(`${appPath}/application`, { auth: a })).data, before);
  const child = `/api/jobs/${p.job.id}/generation/${saved.data.id}/edit`;
  assert.equal((await f.call(child, { auth: a, method: 'POST', value })).status, 200);
  for (let i=0;i<12;i++) await upload(f,a,`quota-${i}.pdf`);
  assert.equal((await f.call(`${prefix}/edit`, { auth: a, method: 'POST', value: { ...value, edits: [{ paragraph: 3, text: 'Another edit' }] } })).status, 409);
  assert.equal((await f.call('/api/files', { auth: a })).data.length, 19);
  await f.call(appPath, { auth: a, method: 'PUT', value: { ...p.job, jd: 'Changed JD' } });
  assert.equal((await f.call(`${prefix}/edit-draft`, { auth: a, method: 'POST', value: {} })).status, 409);
});
test('v2 edit rejects publication after JD change and logout during export', async t => {
  let release, started;
  const begin = () => new Promise(resolve => { started = resolve; });
  const f = await fixture(t, { ...editOptions, edit: async (...args) => { started(); await new Promise(resolve => { release = resolve; }); return editOptions.edit(...args); } });
  const a = await f.account('alice'), p = await wordApplication(f, a);
  const generated = (await f.call(`/api/jobs/${p.job.id}/generation`, { auth: a, method: 'POST', value: p.input })).data;
  const path = `/api/jobs/${p.job.id}/generation/${generated.id}/edit`, value = { ...p.input, edits: [{ paragraph: 3, text: 'Changed text' }] };
  let waiting = begin(), pending = f.call(path, { auth: a, method: 'POST', value }); await waiting;
  assert.equal((await f.call(path, { auth: a, method: 'POST', value })).status, 409);
  await f.call(`/api/jobs/${p.job.id}`, { auth: a, method: 'PUT', value: { ...p.job, jd: 'Changed JD' } }); release(); assert.equal((await pending).status, 409);
  await f.call(`/api/jobs/${p.job.id}`, { auth: a, method: 'PUT', value: p.job });
  waiting = begin(); pending = f.call(path, { auth: a, method: 'POST', value }); await waiting;
  await f.call('/api/logout', { auth: a, method: 'POST', value: {} }); release(); assert.equal((await pending).status, 401);
  const db = new WorkspaceStore(f.database); assert.equal(db.files(a.id).length, 3); db.close();
});
async function wordApplication(f, auth) {
  const file = (await f.call('/api/files', { method: 'POST', auth, bytes: wordBytes, headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'baseline.docx' } })).data;
  const parsed = (await f.call(`/api/files/${file.id}/parse`, { method: 'POST', auth, value: {} })).data;
  await f.call('/api/resume/activate', { method: 'POST', auth, value: { ...parsed, confirmed: true } });
  const saved = (await f.call('/api/jobs', { method: 'POST', auth, value: { ...job, jd: 'Python SQL required.' } })).data;
  const draft = (await f.call(`/api/jobs/${saved.id}/generation-draft`, { method: 'POST', auth, value: {} })).data;
  return { job: saved, file, input: { fingerprint: draft.fingerprint, contextHash: draft.contextHash, availability: draft.availability, decisions: [], confirmed: true, openConfirmed: true } };
}

test('v2 generated files are private, atomic, versioned and never auto-reviewed or activated', async t => {
  const f = await fixture(t, wordOptions), a = await f.account('alice'), b = await f.account('bob'), prepared = await wordApplication(f, a);
  const path = `/api/jobs/${prepared.job.id}/generation`;
  assert.equal((await f.call(path, { method: 'POST', auth: b, value: prepared.input })).status, 404);
  assert.equal((await f.call(path, { method: 'POST', auth: a, value: { ...prepared.input, openConfirmed: false } })).status, 409);
  const saved = await f.call(path, { method: 'POST', auth: a, value: prepared.input });
  assert.equal(saved.status, 200, saved.text);
  assert.equal((await f.call(`/api/files/${saved.data.pdfId}`, { auth: b })).status, 404);
  assert.equal((await f.call(path, { method: 'POST', auth: a, value: prepared.input })).data.id, saved.data.id);
  assert.equal((await f.call('/api/files', { auth: a })).data.length, 3);
  assert.equal((await f.call('/api/resume', { auth: a })).data.fileId, prepared.file.id);
  const app = (await f.call(`/api/jobs/${prepared.job.id}/application`, { auth: a })).data;
  assert.equal(app.versions.length, 0); assert.equal(app.submissions.length, 0);
  await f.restart(); assert.equal((await f.call(path, { auth: a })).data[0].id, saved.data.id);
});

test('v2 refuses publishing after logout or baseline/JD changes during Word work; lock releases for retry', async t => {
  let release, started;
  const begin = () => new Promise(resolve => { started = resolve; });
  const f = await fixture(t, { ...wordOptions, generate: async (...args) => { started(); await new Promise(resolve => { release = resolve; }); return wordOptions.generate(...args); } });
  const a = await f.account('alice'), prepared = await wordApplication(f, a), path = `/api/jobs/${prepared.job.id}/generation`;
  let waiting = begin(), pending = f.call(path, { method: 'POST', auth: a, value: prepared.input }); await waiting;
  assert.equal((await f.call(path, { method: 'POST', auth: a, value: prepared.input })).status, 409);
  await f.call(`/api/jobs/${prepared.job.id}`, { method: 'PUT', auth: a, value: { ...prepared.job, jd: 'Updated JD' } }); release();
  assert.equal((await pending).status, 409); assert.equal((await f.call('/api/files', { auth: a })).data.length, 1);
  const context = (await f.call(`/api/jobs/${prepared.job.id}/application`, { auth: a })).data.context;
  prepared.input.availability = (await f.call(`/api/jobs/${prepared.job.id}/availability`, { method: 'POST', auth: a, value: {} })).data;
  waiting = begin(); pending = f.call(path, { method: 'POST', auth: a, value: { ...prepared.input, contextHash: context.hash } }); await waiting;
  await f.call('/api/logout', { method: 'POST', auth: a, value: {} }); release(); assert.equal((await pending).status, 401);
  const db = new WorkspaceStore(f.database); assert.equal(db.files(a.id).length, 1); assert.equal(db.generatedResumes(a.id, prepared.job.id).length, 0); db.close();
});

test('v2 generation quota rolls back both files and corrupted validation publishes nothing', async t => {
  const f = await fixture(t, wordOptions), a = await f.account('alice'), prepared = await wordApplication(f, a);
  for (let i = 0; i < 18; i++) await upload(f, a, `f${i}.pdf`);
  const result = await f.call(`/api/jobs/${prepared.job.id}/generation`, { method: 'POST', auth: a, value: prepared.input });
  assert.equal(result.status, 409); assert.equal((await f.call('/api/files', { auth: a })).data.length, 19);
  assert.deepEqual((await f.call(`/api/jobs/${prepared.job.id}/generation`, { auth: a })).data, []);
  const g = await fixture(t, { ...wordOptions, generate: async (...args) => { const r = await wordOptions.generate(...args); r.validation.pages = 2; return r; } }), b = await g.account('bob'), second = await wordApplication(g, b);
  assert.equal((await g.call(`/api/jobs/${second.job.id}/generation`, { method: 'POST', auth: b, value: second.input })).status, 422);
  assert.equal((await g.call('/api/files', { auth: b })).data.length, 1);
});

test('v2 generated PDF provenance blocks stale or other-job review while preserving history', async t => {
  const f = await fixture(t, { ...wordOptions, preview: async () => ({ pages: 1, images: [] }) }), a = await f.account('alice'), p = await wordApplication(f, a);
  const generated = (await f.call(`/api/jobs/${p.job.id}/generation`, { method: 'POST', auth: a, value: p.input })).data;
  await f.call(`/api/files/${generated.pdfId}/preview`, { method: 'POST', auth: a, value: {} });
  const review = { contextHash: p.input.contextHash, resumeFileId: generated.pdfId, confirmed: true };
  assert.equal((await f.call(`/api/jobs/${p.job.id}/materials`, { method: 'POST', auth: a, value: review })).data.versions[0].snapshot.generation.id, generated.id);
  const other = (await f.call('/api/jobs', { method: 'POST', auth: a, value: { ...job, jd: 'Another JD' } })).data;
  let context = (await f.call(`/api/jobs/${other.id}/application`, { auth: a })).data.context;
  assert.equal((await f.call(`/api/jobs/${other.id}/materials`, { method: 'POST', auth: a, value: { ...review, contextHash: context.hash } })).status, 409);
  await f.call(`/api/jobs/${p.job.id}`, { method: 'PUT', auth: a, value: { ...p.job, jd: 'Changed JD' } });
  const app = (await f.call(`/api/jobs/${p.job.id}/application`, { auth: a })).data;
  assert.equal(app.versions[0].stale, true);
  assert.equal((await f.call(`/api/jobs/${p.job.id}/materials`, { method: 'POST', auth: a, value: { ...review, contextHash: app.context.hash } })).status, 409);
});
async function upload(f, auth, name = 'resume.pdf') { return (await f.call('/api/files', { method: 'POST', auth, bytes: Buffer.from('%PDF-1.7 synthetic file'), headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': name } })).data; }
async function fixture(t, options = {}) {
  const database = resolve('output/test-runs', `v2-${randomUUID()}`, 'workspace.sqlite');
  let server;
  async function start() { server = workspaceServer({ database, ...options }); server.listen(0, '127.0.0.1'); await once(server, 'listening'); }
  async function stop() { await new Promise((done, reject) => server.close(error => error ? reject(error) : done())); }
  await start(); t.after(stop);
  function call(path, { method = 'GET', auth, value, bytes, headers = {} } = {}) {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const payload = bytes ?? (value === undefined ? null : Buffer.from(JSON.stringify(value)));
    return new Promise((done, reject) => {
      const req = request(origin + path, { method, headers: { Origin: origin, ...(auth ? { Cookie: auth.cookie, 'X-CQ-CSRF': auth.csrf } : {}), ...(value === undefined ? {} : { 'Content-Type': 'application/json' }), ...(payload ? { 'Content-Length': payload.length } : {}), ...headers } }, res => {
        const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => {
          const bytes = Buffer.concat(chunks), text = bytes.toString();
          done({ status: res.statusCode, headers: res.headers, bytes, text, data: res.headers['content-type']?.includes('json') ? JSON.parse(text) : null });
        });
      }); req.on('error', reject); req.end(payload);
    });
  }
  async function account(username) {
    const res = await call('/api/register', { method: 'POST', value: { username, password } });
    assert.equal(res.status, 200, res.text);
    return { cookie: res.headers['set-cookie'][0].split(';')[0], csrf: res.data.csrf, id: res.data.user.id };
  }
  return { call, account, database, restart: async () => { await stop(); await start(); }, port: () => server.address().port };
}

test('v2 personal export and capacity exclude other accounts and authentication data even for admin', async t => {
  const f = await fixture(t, { ...wordOptions, archive: async data => Buffer.from(JSON.stringify(data)), workUsage: async () => 3 });
  const a = await f.account('alice'), b = await f.account('bob'), p = await wordApplication(f, a);
  await f.call('/api/jobs', { method: 'POST', auth: b, value: { company: 'Secret other company', title: 'Never export' } });
  await upload(f, b, 'other-secret.pdf');
  const database = new WorkspaceStore(f.database); database.db.prepare("UPDATE users SET role='admin' WHERE id=?").run(a.id); database.close();
  assert.equal((await f.call('/api/data/export', { method: 'POST' })).status, 401);
  assert.equal((await f.call('/api/data/export', { method: 'POST', auth: a, headers: { 'X-CQ-CSRF': 'stale' } })).status, 403);
  const res = await f.call('/api/data/export', { method: 'POST', auth: a });
  assert.equal(res.status, 200); assert.equal(res.headers['content-type'], 'application/zip');
  const data = JSON.parse(res.text);
  assert.equal(data.account.id, a.id); assert.equal(data.jobs.length, 1); assert.equal(data.activeResume.fileId, p.file.id);
  assert.deepEqual(Buffer.from(data.files[0].base64, 'base64'), wordBytes);
  assert.doesNotMatch(res.text, /Secret other company|other-secret|password_hash|token_hash|csrf|auth_attempts/);
  const usage = (await f.call('/api/data/usage', { auth: a })).data;
  assert.equal(usage.files.count, 1); assert.equal(usage.files.bytes, wordBytes.length); assert.equal(usage.jobs.count, 1); assert.equal(usage.wordWork.count, 3);
});
test('v2 personal export in progress does not leak after logout and can be retried after failure', async t => {
  let release, started; const begun = new Promise(resolve => { started = resolve; });
  const f = await fixture(t, { archive: async () => { started(); await new Promise(resolve => { release = resolve; }); return Buffer.from('private export'); } }), a = await f.account('alice');
  const pending = f.call('/api/data/export', { method: 'POST', auth: a }); await begun;
  assert.equal((await f.call('/api/data/export', { method: 'POST', auth: a })).status, 409);
  await f.call('/api/logout', { method: 'POST', auth: a, value: {} }); release();
  const result = await pending; assert.equal(result.status, 401); assert.doesNotMatch(result.text, /private export/);
  let attempts = 0;
  const g = await fixture(t, { archive: async () => { if (!attempts++) throw Object.assign(new Error('fixture failure'), { status: 422 }); return Buffer.from('ZIP retry'); } }), b = await g.account('bob');
  assert.equal((await g.call('/api/data/export', { method: 'POST', auth: b })).status, 422);
  assert.equal((await g.call('/api/data/export', { method: 'POST', auth: b })).status, 200);
});

test('v2 private jobs and preferences are owner-scoped even with forged owner fields', async t => {
  const f = await fixture(t), a = await f.account('alice'), b = await f.account('bob');
  const saved = await f.call('/api/jobs', { method: 'POST', auth: a, value: { ...job, user_id: b.id } });
  assert.equal(saved.status, 201);
  const id = saved.data.id;
  assert.deepEqual((await f.call('/api/jobs', { auth: b })).data, []);
  assert.equal((await f.call(`/api/jobs/${id}`, { auth: b })).status, 404);
  assert.equal((await f.call(`/api/jobs/${id}`, { method: 'PUT', auth: b, value: { ...job, notes: 'stolen' } })).status, 404);
  assert.equal((await f.call(`/api/jobs/${id}`, { auth: a })).data.notes, job.notes);
  assert.deepEqual((await f.call('/api/preferences', { auth: a })).data, {});
  await f.call('/api/preferences', { method: 'PUT', auth: a, value: { direction: 'data', locations: 'Vancouver', jobTypes: 'new grad', owner: b.id } });
  assert.deepEqual((await f.call('/api/preferences', { auth: b })).data, {});
  assert.equal((await f.call('/api/preferences', { auth: a })).data.locations, 'Vancouver');
  const edit = await f.call(`/api/jobs/${id}`, { method: 'PUT', auth: a, value: { ...job, notes: 'revised' } });
  assert.equal(edit.data.notes, 'revised');
});

test('v2 no anonymous, old-page CSRF, cross-origin, DNS-rebinding or personal v1 routes', async t => {
  const f = await fixture(t), a = await f.account('alice');
  for (const path of ['/api/jobs', '/api/preferences', '/api/files', '/private/v2-local/workspaces.sqlite']) assert.equal((await f.call(path)).status, 401);
  assert.equal((await f.call('/api/jobs', { auth: a, headers: { 'X-CQ-CSRF': 'stale' } })).status, 403);
  assert.equal((await f.call('/api/jobs', { method: 'POST', auth: a, value: job, headers: { Origin: 'http://evil.example' } })).status, 403);
  assert.equal((await f.call('/api/session', { auth: a, headers: { Host: 'evil.example' } })).status, 403);
  assert.equal((await f.call('/api/session', { auth: a, headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  for (const path of ['/api/status', '/api/resume-base/file', '/.env', '/private/v2-local/workspaces.sqlite', '/src/v2/store.mjs']) assert.equal((await f.call(path, { auth: a })).status, 404);
  const page = await f.call('/');
  assert.equal(page.status, 200); assert.equal(page.headers['cache-control'], 'no-store');
  assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/);
});

test('v2 original file bytes persist and foreign IDs cannot be read, files are never inline HTML', async t => {
  const f = await fixture(t), a = await f.account('alice'), b = await f.account('bob');
  const bytes = Buffer.from('%PDF-1.7\nSynthetic document fixture, not a rendered PDF.');
  const upload = await f.call('/api/files', { method: 'POST', auth: a, bytes, headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent('测试简历.pdf') } });
  assert.equal(upload.status, 201, upload.text);
  assert.equal(upload.data.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual((await f.call('/api/files', { auth: b })).data, []);
  const path = `/api/files/${upload.data.id}`;
  assert.equal((await f.call(path, { auth: b })).status, 404);
  assert.equal((await f.call(path)).status, 401);
  const download = await f.call(path, { auth: a });
  assert.deepEqual(download.bytes, bytes);
  assert.equal(download.headers['content-type'], 'application/octet-stream');
  assert.match(download.headers['content-disposition'], /^attachment;/);
  assert.equal(download.headers['x-content-type-options'], 'nosniff');
  await f.restart();
  assert.deepEqual((await f.call(path, { auth: a })).bytes, bytes);
});

test('v2 logout and new login revoke prior sessions, persisted expiry rejects old session', async t => {
  let clock = Date.now(); const f = await fixture(t, { now: () => clock }), a = await f.account('alice');
  assert.match((await f.call('/api/register', { method: 'POST', value: { username: 'second', password } })).headers['set-cookie'][0], /HttpOnly; SameSite=Strict/);
  const login = await f.call('/api/login', { method: 'POST', value: { username: 'alice', password } });
  assert.equal(login.status, 200); assert.equal((await f.call('/api/session', { auth: a })).status, 401);
  const current = { cookie: login.headers['set-cookie'][0].split(';')[0], csrf: login.data.csrf };
  await f.call('/api/jobs', { method: 'POST', auth: current, value: job });
  await f.restart();
  assert.equal((await f.call('/api/jobs', { auth: current })).data.length, 1);
  clock += SESSION_MS + 1;
  assert.equal((await f.call('/api/jobs', { auth: current })).status, 401);
  const again = await f.call('/api/login', { method: 'POST', value: { username: 'alice', password } });
  const last = { cookie: again.headers['set-cookie'][0].split(';')[0], csrf: again.data.csrf };
  assert.equal((await f.call('/api/logout', { method: 'POST', auth: last, value: {} })).status, 200);
  assert.equal((await f.call('/api/jobs', { auth: last })).status, 401);
});

test('v2 authentication validates credentials and keeps salts, password hashes and session tokens private', async t => {
  const f = await fixture(t), a = await f.account('alice');
  await f.account('bob');
  for (const username of ['alice', 'missing']) assert.equal((await f.call('/api/login', { method: 'POST', value: { username, password: 'Wrong test password!' } })).data.error, '账号或密码不正确');
  assert.equal((await f.call('/api/register', { method: 'POST', value: { username: 'ALICE', password } })).status, 409);
  assert.equal((await f.call('/api/register', { method: 'POST', value: { username: 'tiny', password: 'short' } })).status, 400);
  const session = (await f.call('/api/session', { auth: a })).text;
  assert.ok(!session.includes('password') && !session.includes('salt'));
  const db = new DatabaseSync(f.database);
  try {
    const users = db.prepare('SELECT * FROM users').all();
    assert.notEqual(users[0].password_hash, users[1].password_hash);
    assert.ok(users.every(u => u.password_hash !== password && u.password_hash.length === 128));
    const sessions = db.prepare('SELECT * FROM sessions').all();
    assert.ok(sessions.every(s => !a.cookie.includes(s.token_hash)));
  } finally { db.close(); }
});

test('v2 unsafe links, invalid preferences, oversized bodies and malformed uploads leave prior data intact', async t => {
  const f = await fixture(t), a = await f.account('alice');
  const saved = (await f.call('/api/jobs', { method: 'POST', auth: a, value: job })).data;
  for (const url of ['javascript:alert(1)', 'file:///C:/private.pdf', 'https://user:secret@example.com']) assert.equal((await f.call(`/api/jobs/${saved.id}`, { method: 'PUT', auth: a, value: { ...job, url } })).status, 400);
  assert.equal((await f.call(`/api/jobs/${saved.id}`, { auth: a })).data.url, job.url);
  assert.equal((await f.call('/api/preferences', { method: 'PUT', auth: a, value: { direction: 'bad' } })).status, 400);
  assert.equal((await f.call('/api/jobs', { method: 'POST', auth: a, value: { ...job, notes: 'x'.repeat(270000) } })).status, 413);
  for (const name of ['../resume.pdf', 'script.html', 'bad.docx']) {
    assert.equal((await f.call('/api/files', { method: 'POST', auth: a, bytes: Buffer.from('%PDF-1.7'), headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(name) } })).status, 400);
  }
  assert.deepEqual((await f.call('/api/files', { auth: a })).data, []);
});

test('v2 logout during a pending JSON body cannot commit private data', async t => {
  const f = await fixture(t), a = await f.account('alice');
  const origin = `http://127.0.0.1:${f.port()}`;
  const pending = request(origin + '/api/jobs', { method: 'POST', headers: { Origin: origin, Cookie: a.cookie, 'X-CQ-CSRF': a.csrf, 'Content-Type': 'application/json' } });
  const complete = new Promise((done, reject) => { pending.on('response', res => { res.resume(); res.on('end', () => done(res.statusCode)); }); pending.on('error', reject); });
  pending.write('{"company":"');
  await f.call('/api/logout', { method: 'POST', auth: a, value: {} });
  pending.end('Synthetic","title":"Developer"}');
  assert.equal(await complete, 401);
  const db = new DatabaseSync(f.database);
  try { assert.equal(db.prepare('SELECT count(*) n FROM jobs').get().n, 0); } finally { db.close(); }
});

test('v2 concurrent registration cannot replace an account and old page tokens reject a new account cookie', async t => {
  const f = await fixture(t);
  const registrations = await Promise.all([1, 2].map(() => f.call('/api/register', { method: 'POST', value: { username: 'alice', password } })));
  assert.deepEqual(registrations.map(r => r.status).sort(), [200, 409]);
  const registered = registrations.find(r => r.status === 200);
  const a = { cookie: registered.headers['set-cookie'][0].split(';')[0], csrf: registered.data.csrf };
  const b = await f.account('bob');
  const stalePage = { cookie: b.cookie, csrf: a.csrf };
  assert.equal((await f.call('/api/jobs', { auth: stalePage })).status, 403);
  assert.equal((await f.call('/api/jobs', { method: 'POST', auth: stalePage, value: job })).status, 403);
  assert.deepEqual((await f.call('/api/jobs', { auth: b })).data, []);
});

test('v2 interrupted binary upload does not leave a partial original', async t => {
  const f = await fixture(t), a = await f.account('alice');
  const origin = `http://127.0.0.1:${f.port()}`;
  const upload = request(origin + '/api/files', { method: 'POST', headers: { Origin: origin, Cookie: a.cookie, 'X-CQ-CSRF': a.csrf, 'Content-Type': 'application/octet-stream', 'X-File-Name': 'fixture.pdf', 'Content-Length': 10000 } });
  upload.on('error', () => {});
  upload.write('%PDF-1.7 partial', () => upload.destroy());
  await new Promise(done => upload.once('close', done));
  assert.deepEqual((await f.call('/api/files', { auth: a })).data, []);
});

test('v2 auth rate limit persists across restart and clears after the time window', async t => {
  let clock = Date.now(); const f = await fixture(t, { now: () => clock });
  for (let i = 0; i < 20; i++) assert.equal((await f.call('/api/login', { method: 'POST', value: { username: 'no', password: '' } })).status, 400);
  await f.restart();
  assert.equal((await f.call('/api/login', { method: 'POST', value: { username: 'alice', password } })).status, 429);
  clock += 15 * 60 * 1000 + 1;
  assert.equal((await f.call('/api/login', { method: 'POST', value: { username: 'alice', password } })).status, 401);
});

test('v2 file quota and immutable versions are enforced per owner', async t => {
  const database = resolve('output/test-runs', `v2-quota-${randomUUID()}`, 'workspace.sqlite');
  const store = new WorkspaceStore(database); t.after(() => store.close());
  const a = await store.authenticate({ username: 'alice', password }, true), b = await store.authenticate({ username: 'bob', password }, true);
  const bytes = Buffer.alloc(FILE_BYTES); bytes.write('%PDF-1.7');
  const files = Array.from({ length: 4 }, () => store.saveFile(a.user.id, 'resume.pdf', bytes));
  assert.equal(new Set(files.map(f => f.id)).size, 4);
  assert.throws(() => store.saveFile(a.user.id, 'resume.pdf', bytes), { status: 409 });
  assert.throws(() => store.saveFile(a.user.id, 'resume.pdf', Buffer.alloc(FILE_BYTES + 1)), { status: 413 });
  assert.equal(store.saveFile(b.user.id, 'resume.pdf', bytes).size, FILE_BYTES);
  assert.equal(store.files(a.user.id).length, 4);
});

test('v2 local admin controls registration but cannot read another user workspace', async t => {
  const f = await fixture(t), member = await f.account('member');
  const memberJob = (await f.call('/api/jobs', { method: 'POST', auth: member, value: job })).data;
  const store = new WorkspaceStore(f.database);
  try { await store.createAdmin({ username: 'admin', password }); } finally { store.close(); }
  const login = await f.call('/api/login', { method: 'POST', value: { username: 'admin', password } });
  assert.equal(login.data.user.role, 'admin');
  const admin = { cookie: login.headers['set-cookie'][0].split(';')[0], csrf: login.data.csrf };
  assert.equal((await f.call('/api/session', { auth: admin })).data.user.role, 'admin');
  assert.equal((await f.call('/api/admin/registration', { method: 'PUT', auth: member, value: { registrationOpen: false, role: 'admin' } })).status, 403);
  assert.equal((await f.call('/api/admin/registration', { method: 'PUT', auth: admin, value: { registrationOpen: false } })).status, 200);
  assert.equal((await f.call('/api/register', { method: 'POST', value: { username: 'blocked', password } })).status, 403);
  assert.equal((await f.call(`/api/jobs/${memberJob.id}`, { auth: admin })).status, 404);
  await f.restart();
  assert.equal((await f.call('/api/registration')).data.registrationOpen, false);
  assert.equal((await f.call('/api/login', { method: 'POST', value: { username: 'member', password } })).status, 200);
  assert.equal((await f.call('/api/admin/registration', { method: 'PUT', auth: admin, value: { registrationOpen: 'false' } })).status, 400);
  await f.call('/api/admin/registration', { method: 'PUT', auth: admin, value: { registrationOpen: true } });
  const attempt = await f.call('/api/register', { method: 'POST', value: { username: 'forgedadmin', password, role: 'admin' } });
  assert.equal(attempt.data.user.role, 'member');
});

test('v2 provisioning never overwrites an existing account or silently elevates it', async t => {
  const f = await fixture(t); await f.account('admin');
  const store = new WorkspaceStore(f.database);
  try { await assert.rejects(store.createAdmin({ username: 'ADMIN', password: 'New test password 2026!' }), { status: 409 }); } finally { store.close(); }
  const login = await f.call('/api/login', { method: 'POST', value: { username: 'admin', password } });
  assert.equal(login.status, 200); assert.equal(login.data.user.role, 'member');
});

test('v2 adding roles to the previous schema preserves accounts, saved jobs and sessions', async t => {
  const f = await fixture(t), member = await f.account('member');
  const saved = (await f.call('/api/jobs', { method: 'POST', auth: member, value: job })).data;
  const db = new DatabaseSync(f.database);
  try { db.exec('ALTER TABLE users DROP COLUMN role'); } finally { db.close(); }
  await f.restart();
  assert.equal((await f.call('/api/session', { auth: member })).data.user.role, 'member');
  assert.equal((await f.call(`/api/jobs/${saved.id}`, { auth: member })).data.notes, job.notes);
});

test('v2 resume confirmation is owner-bound, persists and switches scoring without changing originals', async t => {
  const f = await fixture(t, { extract: async file => ({ text: file.name === 'second.pdf' ? 'Synthetic graduate. Built Java and C++ application projects and object oriented software systems.' : resumeText, parser: 'fixture', pages: 1 }) });
  const a = await f.account('alice'), b = await f.account('bob');
  const file = await upload(f, a), second = await upload(f, a, 'second.pdf');
  assert.equal((await f.call('/api/resume', { auth: a })).data, null);
  assert.equal((await f.call(`/api/files/${file.id}/parse`, { method: 'POST', auth: b, value: {} })).status, 404);
  const parsed = (await f.call(`/api/files/${file.id}/parse`, { method: 'POST', auth: a, value: {} })).data;
  assert.equal((await f.call('/api/resume/activate', { method: 'POST', auth: a, value: { ...parsed, confirmed: false } })).status, 409);
  assert.equal((await f.call('/api/resume/activate', { method: 'POST', auth: a, value: { ...parsed, confirmed: true, textHash: 'wrong' } })).status, 409);
  assert.equal((await f.call('/api/resume/activate', { method: 'POST', auth: b, value: { ...parsed, confirmed: true } })).status, 404);
  assert.equal((await f.call('/api/resume/activate', { method: 'POST', auth: a, value: { ...parsed, confirmed: true } })).status, 200);
  const saved = (await f.call('/api/jobs', { method: 'POST', auth: a, value: publicJob })).data;
  assert.equal(saved.match.score, 100);
  assert.equal(saved.match.source.fileId, file.id);
  await f.restart();
  assert.equal((await f.call('/api/resume', { auth: a })).data.fileId, file.id);
  assert.equal((await f.call('/api/resume', { auth: b })).data, null);
  const parsed2 = (await f.call(`/api/files/${second.id}/parse`, { method: 'POST', auth: a, value: {} })).data;
  await f.call('/api/resume/activate', { method: 'POST', auth: a, value: { ...parsed2, confirmed: true } });
  const changed = (await f.call(`/api/jobs/${saved.id}`, { auth: a })).data;
  assert.equal(changed.match.score, 0); assert.notEqual(changed.match.source.textHash, saved.match.source.textHash);
  const edited = (await f.call(`/api/jobs/${saved.id}`, { method: 'PUT', auth: a, value: { ...publicJob, jd: 'Requirements\nJava required.' } })).data;
  assert.equal(edited.match.score, 100); assert.notEqual(edited.match.source.jdHash, saved.match.source.jdHash);
  await f.call('/api/resume/clear', { method: 'POST', auth: a, value: {} });
  assert.equal((await f.call(`/api/jobs/${saved.id}`, { auth: a })).data.match.score, null);
  assert.equal((await f.call('/api/files', { auth: a })).data.find(row => row.id === file.id).sha256, file.sha256);
});

test('v2 failed parsing keeps active baseline and logout during parsing cannot store private text', async t => {
  let release, started;
  const wait = new Promise(resolve => { started = resolve; });
  const f = await fixture(t, { extract: async file => {
    if (file.name === 'bad.pdf') throw Object.assign(new Error('Synthetic parse failure'), { status: 422 });
    if (file.name === 'slow.pdf') { started(); await new Promise(resolve => { release = resolve; }); }
    return { text: resumeText, parser: 'fixture', pages: 1 };
  } });
  const a = await f.account('alice'), file = await upload(f, a);
  const parsed = (await f.call(`/api/files/${file.id}/parse`, { method: 'POST', auth: a, value: {} })).data;
  await f.call('/api/resume/activate', { method: 'POST', auth: a, value: { ...parsed, confirmed: true } });
  const bad = await upload(f, a, 'bad.pdf');
  assert.equal((await f.call(`/api/files/${bad.id}/parse`, { method: 'POST', auth: a, value: {} })).status, 422);
  assert.equal((await f.call('/api/resume', { auth: a })).data.fileId, file.id);
  const slow = await upload(f, a, 'slow.pdf'), pending = f.call(`/api/files/${slow.id}/parse`, { method: 'POST', auth: a, value: {} });
  await wait; await f.call('/api/logout', { method: 'POST', auth: a, value: {} }); release();
  assert.equal((await pending).status, 401);
  const db = new DatabaseSync(f.database); assert.equal(db.prepare('SELECT count(*) n FROM resume_text WHERE file_id=?').get(slow.id).n, 0); db.close();
});

test('v2 recommendations do not inherit 2027/GTA/duration rules; preference and deadline filters apply', () => {
  const other = catalogueJob({ ...publicJob, title: 'Data Analyst Co-op', url: 'https://example.com/job/2', jd: 'SQL data analysis required.', deadline: '2020-01-01' }, source);
  assert.equal(recommend([publicJob, other], {}, null, new Date('2026-10-03')).length, 1);
  assert.equal(recommend([publicJob], { locations: 'Toronto' }, null).length, 0);
  assert.equal(recommend([publicJob], { locations: 'Toronto, Vancouver', jobTypes: 'intern' }, null).length, 1);
  assert.equal(recommend([publicJob], { jobTypes: 'co-op' }, null).length, 0);
  assert.equal(recommend([publicJob], { jobTypes: 'new grad' }, null).length, 0);
  assert.equal(recommend([publicJob], {}, null)[0].match.score, null);
  assert.equal(catalogueJob({ ...publicJob, location: 'United States' }, source), null);
  assert.equal(catalogueJob({ ...publicJob, title: 'Accountant Intern', jd: 'Accounting and finance.' }, source), null);
  assert.equal(scoreFor({ jd: '' }, { text: resumeText }).score, null);
});

test('v2 public refresh and repeated saves are independent from owner notes and keep partial source history', async t => {
  let time = Date.now(), run = 0;
  const f = await fixture(t, { now: () => time, discover: async () => ({ jobs: run++ ? [] : [publicJob], sources: [{ ...source, status: run === 1 ? 'complete' : 'failed', count: run === 1 ? 1 : 0 }], finishedAt: new Date(time).toISOString() }) });
  const a = await f.account('alice'), b = await f.account('bob');
  assert.equal((await f.call('/api/recommendations/refresh', { method: 'POST', auth: a, value: {} })).status, 200);
  assert.equal((await f.call('/api/recommendations/refresh', { method: 'POST', auth: b, value: {} })).status, 429);
  const saved = (await f.call(`/api/recommendations/${publicJob.id}/save`, { method: 'POST', auth: a, value: {} })).data;
  await f.call(`/api/jobs/${saved.id}`, { method: 'PUT', auth: a, value: { ...saved, notes: 'Keep private note', jd: 'My corrected JD' } });
  const repeated = (await f.call(`/api/recommendations/${publicJob.id}/save`, { method: 'POST', auth: a, value: {} })).data;
  assert.equal(repeated.id, saved.id); assert.equal(repeated.notes, 'Keep private note'); assert.equal(repeated.jd, 'My corrected JD');
  assert.deepEqual((await f.call('/api/jobs', { auth: b })).data, []);
  time += 61000;
  assert.equal((await f.call('/api/recommendations/refresh', { method: 'POST', auth: a, value: {} })).status, 503);
  const results = (await f.call('/api/recommendations', { auth: b })).data;
  assert.equal(results.jobs.length, 1); assert.equal(results.jobs[0].stale, false); assert.equal(results.jobs[0].notes, undefined);
});

test('v2 source collection reports partial failures and deduplicates normalized URLs', async () => {
  const result = await fetchCatalogue({ sources: [source, { ...source, id: 'broken' }], readBoard: async src => {
    if (src.id === 'broken') throw new Error('secret diagnostics must not be exposed');
    return { status: 'complete', jobs: [publicJob, publicJob] };
  } });
  assert.equal(result.jobs.length, 1); assert.equal(result.sources.find(row => row.id === 'broken').status, 'failed');
  assert.doesNotMatch(JSON.stringify(result), /secret diagnostics/);
});

test('v2 listing-only records fetch official detail and keep missing text unscored on failure', async () => {
  let calls = 0;
  const result = await fetchCatalogue({ sources: [source], readBoard: async () => ({ status: 'complete', jobs: [{ ...publicJob, jd: '' }, { ...publicJob, url: 'https://example.com/job/broken', jd: '' }] }), readDetail: async raw => {
    calls++;
    if (raw.url.endsWith('broken')) throw new Error('unavailable');
    return { ...raw, jd: 'Requirements\nPython required.' };
  } });
  assert.equal(calls, 2); assert.equal(result.jobs.length, 2); assert.equal(result.sources[0].detailed, 1);
  assert.equal(scoreFor(result.jobs.find(row => row.detailError), { text: resumeText }).score, null);
});

test('v2 detail failures retain old public text with a visible stale marker; complete empty lists remove only suggestions', t => {
  const store = new WorkspaceStore(resolve('output/test-runs', `v2-catalogue-${randomUUID()}`, 'workspace.sqlite')); t.after(() => store.close());
  const sources = [{ ...source, status: 'complete', count: 1 }];
  store.saveCatalogue({ sources, jobs: [publicJob], finishedAt: 'first' });
  const stale = store.saveCatalogue({ sources, jobs: [{ ...publicJob, jd: '', detailError: 'failed' }], finishedAt: 'second' });
  assert.equal(stale.jobs[0].jd, publicJob.jd); assert.equal(stale.jobs[0].stale, true);
  assert.equal(store.saveCatalogue({ sources, jobs: [], finishedAt: 'third' }).jobs.length, 0);
});

async function prepareApplication(f, auth, name = 'application.pdf') {
  const file = await upload(f, auth, name);
  const parsed = (await f.call(`/api/files/${file.id}/parse`, { method: 'POST', auth, value: {} })).data;
  await f.call('/api/resume/activate', { method: 'POST', auth, value: { ...parsed, confirmed: true } });
  const saved = (await f.call('/api/jobs', { method: 'POST', auth, value: publicJob })).data;
  const application = (await f.call(`/api/jobs/${saved.id}/application`, { auth })).data;
  return { file, saved, application, value: { contextHash: application.context.hash, resumeFileId: file.id, confirmed: true } };
}
const materialOptions = { extract: async () => ({ text: resumeText, parser: 'fixture', pages: 1 }), preview: async file => ({ pages: file.name === 'two.pdf' ? 2 : 1, images: file.name === 'two.pdf' ? ['fixture', 'fixture'] : ['fixture'] }) };

test('v2 school HTTP import supports large pasted tables, enforces CSRF and keeps accounts separate', async t => {
  const f = await fixture(t), a = await f.account('alice'), b = await f.account('bob');
  const text = 'Copy notes '.repeat(1800) + '\n\tApp Status\tTerm\tID\tJob Title\tOrganization\tOpenings\tLocation\tApp Deadline\t\nShortlist Apply\tApplied\t2028 - Summer\t900111\tSoftware Intern\tSynthetic Employer\t1\tToronto, ON\tOct 31, 2026 11:59 PM\t';
  assert.equal((await f.call('/api/school/preview', { method: 'POST', value: { text } })).status, 401);
  assert.equal((await f.call('/api/school/preview', { method: 'POST', auth: { ...a, csrf: 'wrong' }, value: { text } })).status, 403);
  const preview = await f.call('/api/school/preview', { method: 'POST', auth: a, value: { text } });
  assert.equal(preview.status, 200, preview.text); assert.equal(preview.data.rows[0].row.id, '900111');
  const value = { text, fingerprint: preview.data.fingerprint, selections: [{ index: 0, target: 'new' }], requestId: randomUUID(), confirmed: true };
  const saved = await f.call('/api/school/import', { method: 'POST', auth: a, value });
  assert.equal(saved.status, 200, saved.text); assert.deepEqual((await f.call('/api/school/import', { method: 'POST', auth: a, value })).data, saved.data);
  assert.equal((await f.call('/api/school', { auth: a })).data[0].row.sourceStatus, 'Applied');
  assert.deepEqual((await f.call('/api/school', { auth: b })).data, []);
  assert.deepEqual((await f.call(`/api/jobs/${saved.data.saved[0].jobId}/application`, { auth: a })).data.submissions, []);
  await f.restart(); assert.equal((await f.call('/api/school', { auth: a })).data.length, 1);
});

test('v2 school association preserves frozen applications and reports only personal employer/school confirmations', async t => {
  const f = await fixture(t, materialOptions), a = await f.account('alice'), b = await f.account('bob'), p = await correctionApplication(f, a);
  const text = '|Term|ID|Job Title|Organization|Location|App Deadline|\n|---|---|---|---|---|---|\n|2028 - Summer|900222|Developer|Synthetic Company|Vancouver, Canada|Oct 31, 2026 11:59 PM|';
  const preview = (await f.call('/api/school/preview', { auth: a, method: 'POST', value: { text } })).data;
  const value = { text, fingerprint: preview.fingerprint, selections: [{ index: 0, target: `saved:${p.saved.id}` }], confirmed: true, requestId: randomUUID() };
  const foreignPreview = (await f.call('/api/school/preview', { auth: b, method: 'POST', value: { text } })).data;
  assert.equal((await f.call('/api/school/import', { auth: b, method: 'POST', value: { ...value, fingerprint: foreignPreview.fingerprint } })).status, 404);
  assert.equal((await f.call('/api/school/import', { auth: a, method: 'POST', value })).status, 200);
  assert.deepEqual((await f.call(`${p.prefix}/application`, { auth: a })).data, p.app);
  const school = (await f.call('/api/school', { auth: a })).data[0];
  assert.equal(school.required.includes('school'), true); assert.deepEqual(school.submissions, [{ channel: 'employer', date: '2026-01-01' }]);
  await f.call('/api/logout', { auth: a, method: 'POST', value: {} });
  assert.equal((await f.call('/api/school', { auth: a })).status, 401);
});

async function correctionApplication(f, auth) {
  const p = await prepareApplication(f, auth);
  const prefix = `/api/jobs/${p.saved.id}`;
  await f.call(`${prefix}/channel`, { method: 'PUT', auth, value: { channel: 'both' } });
  await f.call(`/api/files/${p.file.id}/preview`, { method: 'POST', auth, value: {} });
  const reviewed = (await f.call(`${prefix}/materials`, { method: 'POST', auth, value: p.value })).data;
  const input = { channel: 'employer', materialId: reviewed.versions[0].id, date: '2026-01-01', receipt: 'original receipt', confirmed: true, attachmentsComplete: true, requestId: randomUUID() };
  const submitted = await f.call(`${prefix}/submission`, { method: 'POST', auth, value: input });
  assert.equal(submitted.status, 200, submitted.text);
  const record = submitted.data.submissions[0];
  return { ...p, prefix, input, record, app: submitted.data, path: `${prefix}/submissions/${record.id}/corrections`,
    correction: { channel: 'school', date: '2026-01-02', receipt: 'corrected receipt', reason: 'Recorded the wrong channel and day', revision: 0, requestId: randomUUID() } };
}

test('school maintenance HTTP authenticates, previews, audits and retries independently of employer submissions', async t => {
  const f = await fixture(t, materialOptions), a = await f.account('alice'), b = await f.account('bob'), p = await correctionApplication(f, a);
  const text = '|Term|ID|Job Title|Organization|Location|App Deadline|\n|---|---|---|---|---|---|\n|2028 - Summer|900333|Developer|Synthetic Company|Toronto|Oct 31, 2026 11:59 PM|';
  const preview = (await f.call('/api/school/preview', { auth: a, method: 'POST', value: { text } })).data;
  await f.call('/api/school/import', { auth: a, method: 'POST', value: { text, fingerprint: preview.fingerprint, selections: [{ index: 0, target: `saved:${p.saved.id}` }], confirmed: true, requestId: randomUUID() } });
  const link = (await f.call('/api/school', { auth: a })).data[0], path = '/api/school/900333';
  const input = { action: 'unlink', revision: link.revision };
  assert.equal(link.locked, false);
  assert.equal((await f.call(`${path}/change-preview`, { method: 'POST', value: input })).status, 401);
  assert.equal((await f.call(`${path}/change-preview`, { auth: b, method: 'POST', value: input })).status, 404);
  const plan = await f.call(`${path}/change-preview`, { auth: a, method: 'POST', value: input }); assert.equal(plan.status, 200);
  const value = { ...input, fingerprint: plan.data.fingerprint, reason: '<b>Wrong school link</b>', confirmed: true, requestId: randomUUID() };
  assert.equal((await f.call(`${path}/changes`, { auth: { ...a, csrf: 'bad' }, method: 'POST', value })).status, 403);
  assert.equal((await f.call(`${path}/changes`, { auth: b, method: 'POST', value })).status, 404);
  assert.equal((await f.call(`${path}/changes`, { auth: a, method: 'POST', value })).status, 200);
  await f.restart(); assert.equal((await f.call(`${path}/changes`, { auth: a, method: 'POST', value })).status, 200);
  assert.deepEqual((await f.call('/api/school', { auth: a })).data, []);
  const history = (await f.call('/api/school/history', { auth: a })).data;
  assert.equal(history.events.length, 2); assert.equal(history.events[1].reason, value.reason);
  assert.equal(history.events[1].before.jobId, p.saved.id); assert.equal(history.events[1].after, null);
  assert.deepEqual((await f.call('/api/school/history', { auth: b })).data, { events: [], sources: [] });
  assert.deepEqual((await f.call(`${p.prefix}/application`, { auth: a })).data, p.app);
  await f.call('/api/logout', { auth: a, method: 'POST', value: {} });
  assert.equal((await f.call('/api/school/history', { auth: a })).status, 401);
});

test('school maintenance HTTP detects newly submitted school channel and preserves original source through later edits', async t => {
  const f = await fixture(t, { ...materialOptions, archive: async data => Buffer.from(JSON.stringify(data)) }), a = await f.account('alice'), p = await correctionApplication(f, a);
  const text = '|Term|ID|Job Title|Organization|Location|App Deadline|\n|---|---|---|---|---|---|\n|2028 - Summer|900444|Developer|Synthetic Company|Toronto|Oct 31, 2026 11:59 PM|';
  const preview = (await f.call('/api/school/preview', { auth: a, method: 'POST', value: { text } })).data;
  await f.call('/api/school/import', { auth: a, method: 'POST', value: { text, fingerprint: preview.fingerprint, selections: [{ index: 0, target: `saved:${p.saved.id}` }], confirmed: true, requestId: randomUUID() } });
  const link = (await f.call('/api/school', { auth: a })).data[0], path = '/api/school/900444';
  const input = { action: 'unlink', revision: link.revision };
  const plan = (await f.call(`${path}/change-preview`, { auth: a, method: 'POST', value: input })).data;
  const submitted = await f.call(`${p.prefix}/submission`, { auth: a, method: 'POST', value: { ...p.input, channel: 'school', schoolRevision: link.revision, requestId: randomUUID() } });
  assert.equal(submitted.status, 200);
  assert.equal((await f.call(`${path}/changes`, { auth: a, method: 'POST', value: { ...input, fingerprint: plan.fingerprint, confirmed: true, reason: 'Old preview', requestId: randomUUID() } })).status, 409);
  const edit = { action: 'update', revision: link.revision, row: { ...link.row, deadlineText: '2026-12-01' } };
  const updatedPlan = await f.call(`${path}/change-preview`, { auth: a, method: 'POST', value: edit }); assert.equal(updatedPlan.status, 200);
  assert.equal((await f.call(`${path}/changes`, { auth: a, method: 'POST', value: { ...edit, fingerprint: updatedPlan.data.fingerprint, reason: 'Extended deadline', confirmed: true, requestId: randomUUID() } })).status, 200);
  assert.deepEqual((await f.call(`${p.prefix}/application`, { auth: a })).data, submitted.data);
  const history = (await f.call('/api/school/history', { auth: a })).data;
  assert.equal(history.sources[0].row.deadlineText, link.row.deadlineText); assert.equal(history.sources[0].basis, 'submission');
  const exported = JSON.parse((await f.call('/api/data/export', { auth: a, method: 'POST', value: {} })).text);
  assert.deepEqual(exported.schoolHistory, history.events); assert.deepEqual(exported.schoolSubmissionSources, history.sources);
});

test('v2 submission corrections require authenticated ownership, CSRF, valid fields and an allowed channel', async t => {
  const f = await fixture(t, materialOptions), a = await f.account('alice'), b = await f.account('bob');
  const p = await correctionApplication(f, a), value = p.correction;
  assert.equal((await f.call(p.path, { method: 'POST', value })).status, 401);
  assert.equal((await f.call(p.path, { method: 'POST', auth: { ...a, csrf: 'wrong' }, value })).status, 403);
  assert.equal((await f.call(p.path, { method: 'POST', auth: b, value })).status, 404);
  const otherJob = (await f.call('/api/jobs', { method: 'POST', auth: a, value: { ...job, title: 'Another job' } })).data;
  assert.equal((await f.call(`/api/jobs/${otherJob.id}/submissions/${p.record.id}/corrections`, { method: 'POST', auth: a, value })).status, 404);
  for (const bad of [{ reason: '' }, { reason: '  ' }, { reason: 'x'.repeat(1001) }, { date: '2026-02-30' }, { date: '2999-01-01' }, { channel: 'both' }, { revision: -1 }, { revision: '0' }, { requestId: 'invalid' }]) {
    assert.equal((await f.call(p.path, { method: 'POST', auth: a, value: { ...value, ...bad } })).status, 400, JSON.stringify(bad));
  }
  await f.call(`${p.prefix}/channel`, { method: 'PUT', auth: a, value: { channel: 'employer' } });
  assert.equal((await f.call(p.path, { method: 'POST', auth: a, value })).status, 409);
  assert.deepEqual((await f.call(`${p.prefix}/application`, { auth: a })).data.submissions, p.app.submissions);
});

test('v2 correction retries and concurrent revisions preserve materials and prevent duplicate submission channels', async t => {
  const f = await fixture(t, materialOptions), a = await f.account('alice'), p = await correctionApplication(f, a);
  const corrected = await f.call(p.path, { method: 'POST', auth: a, value: p.correction });
  assert.equal(corrected.status, 200, corrected.text);
  const record = corrected.data.submissions[0];
  assert.equal(record.channel, 'school'); assert.equal(record.revision, 1); assert.equal(record.materialId, p.record.materialId); assert.equal(record.created, p.record.created);
  assert.deepEqual(corrected.data.versions, p.app.versions);
  assert.deepEqual(record.corrections[0].before, { channel: 'employer', date: p.input.date, receipt: p.input.receipt });
  assert.equal(record.corrections[0].actor, 'alice'); assert.equal(record.corrections[0].reason, p.correction.reason);
  assert.deepEqual((await f.call(p.path, { method: 'POST', auth: a, value: p.correction })).data.submissions, corrected.data.submissions);
  assert.equal((await f.call(p.path, { method: 'POST', auth: a, value: { ...p.correction, reason: 'different request with same ID' } })).status, 409);
  // A delayed response/retry of the original submission must not recreate its old channel.
  assert.equal((await f.call(`${p.prefix}/submission`, { method: 'POST', auth: a, value: p.input })).data.submissions.length, 1);
  const concurrent = await Promise.all(['First correction', 'Second correction'].map(reason => f.call(p.path, { method: 'POST', auth: a, value: { ...p.correction, revision: 1, requestId: randomUUID(), date: '2026-01-03', reason } })));
  assert.deepEqual(concurrent.map(result => result.status).sort(), [200, 409]);
  // An explicit new submission may fill the channel released by the correction.
  const completed = await f.call(`${p.prefix}/submission`, { method: 'POST', auth: a, value: { ...p.input, requestId: randomUUID(), receipt: 'New actual employer receipt' } });
  assert.equal(completed.status, 200, completed.text); assert.equal(completed.data.complete, true);
  assert.equal((await f.call(p.path, { method: 'POST', auth: a, value: { ...p.correction, revision: 2, requestId: randomUUID(), channel: 'employer' } })).status, 409);
  await f.restart();
  assert.deepEqual((await f.call(`${p.prefix}/application`, { auth: a })).data, completed.data);
});

test('v2 corrections update displayed completion without changing notes, source, files or frozen materials', async t => {
  const f = await fixture(t, { ...materialOptions, archive: async data => Buffer.from(JSON.stringify(data)) }), a = await f.account('alice'), b = await f.account('bob');
  const p = await correctionApplication(f, a);
  await f.call(`${p.prefix}/channel`, { method: 'PUT', auth: a, value: { channel: 'school-only' } });
  await f.call(p.prefix, { method: 'PUT', auth: a, value: { ...p.saved, notes: 'Keep my private note', jd: 'Changed JD after actual submission' } });
  const before = (await f.call(`${p.prefix}/application`, { auth: a })).data;
  const corrected = await f.call(p.path, { method: 'POST', auth: a, value: p.correction });
  assert.equal(corrected.status, 200, corrected.text); assert.equal(corrected.data.complete, true);
  assert.deepEqual(corrected.data.versions, before.versions); assert.deepEqual(corrected.data.context, before.context);
  assert.equal((await f.call(p.prefix, { auth: a })).data.notes, 'Keep my private note');
  assert.equal((await f.call('/api/applications', { auth: a })).data[0].status, '已记录提交');
  assert.deepEqual((await f.call('/api/applications', { auth: b })).data, []);
  const exported = JSON.parse((await f.call('/api/data/export', { method: 'POST', auth: a, value: {} })).text);
  assert.equal(exported.submissionCorrections.length, 1);
  assert.deepEqual(exported.submissionCorrections[0].before, corrected.data.submissions[0].corrections[0].before);
  const otherExport = JSON.parse((await f.call('/api/data/export', { method: 'POST', auth: b, value: {} })).text);
  assert.deepEqual(otherExport.submissionCorrections, []);
});

test('v2 material review requires own preview, current context, one-page resume and explicit confirmation', async t => {
  const f = await fixture(t, materialOptions), a = await f.account('alice'), b = await f.account('bob');
  const { file, saved, value } = await prepareApplication(f, a);
  const path = `/api/jobs/${saved.id}/materials`;
  assert.equal((await f.call(path, { method: 'POST', auth: a, value })).status, 409);
  assert.equal((await f.call(`/api/files/${file.id}/preview`, { method: 'POST', auth: b, value: {} })).status, 404);
  assert.equal((await f.call(`/api/files/${file.id}/preview`, { method: 'POST', auth: a, value: {} })).status, 200);
  assert.equal((await f.call(path, { method: 'POST', auth: b, value })).status, 404);
  assert.equal((await f.call(path, { method: 'POST', auth: a, value: { ...value, confirmed: false } })).status, 409);
  assert.equal((await f.call(path, { method: 'POST', auth: a, value: { ...value, contextHash: 'old' } })).status, 409);
  const reviewed = await f.call(path, { method: 'POST', auth: a, value });
  assert.equal(reviewed.status, 200, reviewed.text); assert.equal(reviewed.data.versions.length, 1); assert.equal(reviewed.data.submissions.length, 0);
  assert.equal((await f.call(path, { method: 'POST', auth: a, value })).data.versions.length, 1);
  const two = await upload(f, a, 'two.pdf');
  await f.call(`/api/files/${two.id}/preview`, { method: 'POST', auth: a, value: {} });
  assert.equal((await f.call(path, { method: 'POST', auth: a, value: { ...value, resumeFileId: two.id } })).status, 422);
  const withCover = await f.call(path, { method: 'POST', auth: a, value: { ...value, coverFileId: two.id } });
  assert.equal(withCover.status, 200); assert.equal(withCover.data.versions.length, 2); assert.equal(withCover.data.versions[0].snapshot.cover.pages, 2);
  assert.deepEqual((await f.call('/api/applications', { auth: b })).data, []);
  assert.equal((await f.call(`/api/jobs/${saved.id}/application`, { auth: b })).status, 404);
});

test('v2 material snapshots remain immutable when notes/JD/resume change; old preview expires', async t => {
  let time = Date.parse('2026-10-03T16:00:00Z');
  const f = await fixture(t, { ...materialOptions, now: () => time }), a = await f.account('alice');
  const { file, saved, value } = await prepareApplication(f, a);
  await f.call(`/api/files/${file.id}/preview`, { method: 'POST', auth: a, value: {} });
  const original = (await f.call(`/api/jobs/${saved.id}/materials`, { method: 'POST', auth: a, value })).data.versions[0];
  await f.call(`/api/jobs/${saved.id}`, { method: 'PUT', auth: a, value: { ...saved, notes: 'new private note' } });
  assert.equal((await f.call(`/api/jobs/${saved.id}/application`, { auth: a })).data.versions[0].stale, false);
  await f.call(`/api/jobs/${saved.id}`, { method: 'PUT', auth: a, value: { ...saved, jd: 'Updated requirements\nJava required.' } });
  const changed = (await f.call(`/api/jobs/${saved.id}/application`, { auth: a })).data;
  assert.equal(changed.versions[0].stale, true); assert.deepEqual(changed.versions[0].snapshot, original.snapshot);
  assert.equal((await f.call(`/api/jobs/${saved.id}/materials`, { method: 'POST', auth: a, value })).status, 409);
  time += 16 * 60000;
  assert.equal((await f.call(`/api/jobs/${saved.id}/materials`, { method: 'POST', auth: a, value: { ...value, contextHash: changed.context.hash } })).status, 409);
  await f.call(`/api/files/${file.id}/preview`, { method: 'POST', auth: a, value: {} });
  assert.equal((await f.call(`/api/jobs/${saved.id}/materials`, { method: 'POST', auth: a, value: { ...value, contextHash: changed.context.hash } })).data.versions.length, 2);
  await f.restart();
  const history = (await f.call(`/api/jobs/${saved.id}/application`, { auth: a })).data;
  assert.deepEqual(history.versions[1].snapshot, original.snapshot);
  await f.call('/api/resume/clear', { method: 'POST', auth: a, value: {} });
  assert.equal((await f.call(`/api/jobs/${saved.id}/application`, { auth: a })).data.versions.every(v => v.stale), true);
});

test('v2 employer and school submissions freeze independent material versions with idempotent retries', async t => {
  const f = await fixture(t, { ...materialOptions, now: () => Date.parse('2026-10-03T16:00:00Z') }), a = await f.account('alice'), b = await f.account('bob');
  const { file, saved, value } = await prepareApplication(f, a);
  await f.call(`/api/files/${file.id}/preview`, { method: 'POST', auth: a, value: {} });
  const reviewed = (await f.call(`/api/jobs/${saved.id}/materials`, { method: 'POST', auth: a, value })).data;
  const input = { channel: 'employer', materialId: reviewed.versions[0].id, date: '2026-10-03', receipt: 'QA receipt', attachmentsComplete: true, confirmed: true };
  const path = `/api/jobs/${saved.id}/submission`;
  assert.equal((await f.call(path, { method: 'POST', auth: a, value: input })).status, 409);
  await f.call(`/api/jobs/${saved.id}/channel`, { method: 'PUT', auth: a, value: { channel: 'both' } });
  for (const bad of [{ confirmed: false }, { attachmentsComplete: false }, { date: '2026-02-30' }, { date: '2026-10-04' }]) assert.equal((await f.call(path, { method: 'POST', auth: a, value: { ...input, ...bad } })).status, 400);
  assert.equal((await f.call(path, { method: 'POST', auth: b, value: input })).status, 404);
  const employer = (await f.call(path, { method: 'POST', auth: a, value: input })).data;
  assert.equal(employer.complete, false); assert.equal(employer.submissions.length, 1);
  assert.deepEqual((await f.call(path, { method: 'POST', auth: a, value: input })).data.submissions, employer.submissions);
  assert.equal((await f.call(path, { method: 'POST', auth: a, value: { ...input, date: '2026-10-02' } })).status, 409);
  await f.call(`/api/jobs/${saved.id}`, { method: 'PUT', auth: a, value: { ...saved, jd: 'Changed school description: Python required.' } });
  const school = { ...input, channel: 'school', receipt: 'School receipt' };
  assert.equal((await f.call(path, { method: 'POST', auth: a, value: school })).status, 409);
  const complete = (await f.call(path, { method: 'POST', auth: a, value: { ...school, staleAcknowledged: true } })).data;
  assert.equal(complete.complete, true); assert.equal(complete.submissions.length, 2);
  assert.deepEqual(complete.submissions[0], employer.submissions[0]);
  const appRows = (await f.call('/api/applications', { auth: a })).data;
  assert.equal(appRows[0].status, '已记录提交');
  await f.call(`/api/jobs/${saved.id}/channel`, { method: 'PUT', auth: a, value: { channel: 'school-only' } });
  assert.deepEqual((await f.call(`/api/jobs/${saved.id}/application`, { auth: a })).data.submissions, complete.submissions);
});

test('v2 logout during PDF rendering does not authorize preview or material confirmation', async t => {
  let release, started;
  const wait = new Promise(resolve => { started = resolve; });
  const f = await fixture(t, { ...materialOptions, preview: async () => { started(); await new Promise(resolve => { release = resolve; }); return { pages: 1, images: ['fixture'] }; } });
  const a = await f.account('alice'), { file } = await prepareApplication(f, a);
  const pending = f.call(`/api/files/${file.id}/preview`, { method: 'POST', auth: a, value: {} });
  await wait; await f.call('/api/logout', { method: 'POST', auth: a, value: {} }); release();
  assert.equal((await pending).status, 401);
  const db = new DatabaseSync(f.database); assert.equal(db.prepare('SELECT count(*) n FROM pdf_reviews').get().n, 0); db.close();
});

test('v2 school-only records need explicit channel choice and do not create employer dates', async t => {
  const f = await fixture(t, materialOptions), a = await f.account('alice');
  const { file, saved } = await prepareApplication(f, a);
  await f.call(`/api/jobs/${saved.id}`, { method: 'PUT', auth: a, value: { ...saved, url: '' } });
  let application = (await f.call(`/api/jobs/${saved.id}/application`, { auth: a })).data;
  assert.equal(application.channel, 'unknown');
  await f.call(`/api/jobs/${saved.id}/channel`, { method: 'PUT', auth: a, value: { channel: 'school-only' } });
  await f.call(`/api/files/${file.id}/preview`, { method: 'POST', auth: a, value: {} });
  application = (await f.call(`/api/jobs/${saved.id}/materials`, { method: 'POST', auth: a, value: { contextHash: application.context.hash, resumeFileId: file.id, confirmed: true } })).data;
  const value = { channel: 'school', materialId: application.versions[0].id, date: '2026-10-02', confirmed: true, attachmentsComplete: true };
  const recorded = (await f.call(`/api/jobs/${saved.id}/submission`, { method: 'POST', auth: a, value })).data;
  assert.equal(recorded.complete, true); assert.equal(recorded.submissions.length, 1); assert.equal(recorded.submissions[0].channel, 'school');
  await f.restart(); assert.deepEqual((await f.call(`/api/jobs/${saved.id}/application`, { auth: a })).data.submissions, recorded.submissions);
});

test('v2 fresh login requires a fresh PDF preview even for the same account', async t => {
  const f = await fixture(t, materialOptions), a = await f.account('alice'), { file, saved, value } = await prepareApplication(f, a);
  await f.call(`/api/files/${file.id}/preview`, { method: 'POST', auth: a, value: {} });
  const login = await f.call('/api/login', { method: 'POST', value: { username: 'alice', password } });
  const fresh = { cookie: login.headers['set-cookie'][0].split(';')[0], csrf: login.data.csrf };
  assert.equal((await f.call(`/api/jobs/${saved.id}/materials`, { method: 'POST', auth: fresh, value })).status, 409);
  await f.call(`/api/files/${file.id}/preview`, { method: 'POST', auth: fresh, value: {} });
  assert.equal((await f.call(`/api/jobs/${saved.id}/materials`, { method: 'POST', auth: fresh, value })).status, 200);
});


test('migration audit endpoint is owner scoped and has no HTTP write operation', async t => {
  const f = await fixture(t), a = await f.account('alice'), b = await f.account('bob');
  const s = new WorkspaceStore(f.database);
  const saved = s.saveJob(a.id, job);
  s.recordMigration(a.id, { source: 'v1-notion', sourceKey: 'a'.repeat(24), jobId: saved.id, original: job, documents: [] }); s.close();
  assert.equal((await f.call('/api/data/migrations')).status, 401);
  assert.equal((await f.call('/api/data/migrations', { auth: a })).data.length, 1);
  assert.deepEqual((await f.call('/api/data/migrations', { auth: b })).data, []);
  assert.equal((await f.call('/api/data/migrations', { auth: a, method: 'POST', value: {} })).status, 404);
});


test('v2 preparation is private, revision guarded, persists and invalidates review when inputs change', async t => {
  const f = await fixture(t, { archive: async data => Buffer.from(JSON.stringify(data)) });
  const a = await f.account('alice'), b = await f.account('bob');
  const fields = { company:'Synthetic',title:'Intern',jd:'Python developer',notes:'Original note' };
  const job = (await f.call('/api/jobs',{method:'POST',auth:a,value:fields})).data;
  const path='/api/jobs/'+job.id+'/preparation';
  assert.equal((await f.call(path)).status,401);
  assert.equal((await f.call(path,{auth:b})).status,404);
  const initial=(await f.call(path,{auth:a})).data;
  const value={...initial,notes:'Question: availability? Answer: to confirm.',reviewed:true};
  assert.equal((await f.call(path,{method:'PUT',auth:b,value})).status,404);
  assert.equal((await f.call(path,{method:'PUT',auth:a,value:{...value,notes:'x'.repeat(12001)}})).status,400);
  const saved=await f.call(path,{method:'PUT',auth:a,value}); assert.equal(saved.status,200,saved.text);assert.equal(saved.data.reviewed,true);
  assert.equal((await f.call(path,{method:'PUT',auth:a,value})).status,409);
  await f.restart();assert.equal((await f.call(path,{auth:a})).data.notes,value.notes);
  await f.call('/api/jobs/'+job.id+'/channel',{method:'PUT',auth:a,value:{channel:'both'}});
  const changed=(await f.call(path,{auth:a})).data;assert.equal(changed.stale,true);assert.equal(changed.reviewed,false);
  assert.equal((await f.call(path,{method:'PUT',auth:a,value:{...saved.data,reviewed:true}})).status,409);
  const current=await f.call(path,{method:'PUT',auth:a,value:{...changed,reviewed:true}});assert.equal(current.status,200,current.text);
  // Archive test double uses ZIP content-type, so parse its text explicitly.
  const exported=JSON.parse((await f.call('/api/data/export',{method:'POST',auth:a})).text);
  assert.equal(exported.preparation[0].notes,value.notes);
  assert.equal(JSON.parse((await f.call('/api/data/export',{method:'POST',auth:b})).text).preparation.length,0);
  const app=(await f.call('/api/jobs/'+job.id+'/application',{auth:a})).data;
  assert.equal(app.submissions.length,0);assert.equal(app.versions.length,0);
  assert.equal((await f.call('/api/jobs/'+job.id,{auth:a})).data.notes,fields.notes);
});


test('v2 form reading is owner scoped, never saves drafts and rejects changed inputs during reading', async t => {
  let release; const f=await fixture(t,{applicationForm:()=>new Promise(resolve=>{release=resolve;})});
  const a=await f.account('alice'),b=await f.account('bob');
  const job=(await f.call('/api/jobs',{method:'POST',auth:a,value:{company:'Synthetic',title:'Intern',url:'https://job-boards.greenhouse.io/example/jobs/123'}})).data;
  const base='/api/jobs/'+job.id, prep=(await f.call(base+'/preparation',{auth:a})).data;
  assert.equal((await f.call(base+'/application-form',{method:'POST',auth:b,value:{basis:prep.basis}})).status,404);
  assert.equal((await f.call(base+'/application-form',{method:'POST',auth:a,value:{basis:'old'}})).status,409);
  const pending=f.call(base+'/application-form',{method:'POST',auth:a,value:{basis:prep.basis}});
  while(!release) await new Promise(resolve=>setTimeout(resolve,1));
  await f.call(base+'/channel',{method:'PUT',auth:a,value:{channel:'both'}}); release({questions:[]});
  assert.equal((await pending).status,409);
  assert.equal((await f.call(base+'/preparation',{auth:a})).data.revision,0);
});

test('question drafts persist per owner and job; stale bases and changed questions preserve old answers', async t => {
  const f = await fixture(t), a = await f.account('alice'), b = await f.account('bob');
  const j = (await f.call('/api/jobs',{auth:a,method:'POST',value:job})).data;
  const url = `/api/jobs/${j.id}/question-draft`;
  const initial = (await f.call(url,{auth:a})).data;
  assert.equal(initial.draft,null);
  const draft={form:{title:'Synthetic',source:'https://boards-api.greenhouse.io/v1/boards/test/jobs/123?questions=true',checkedAt:'2026-10-05T00:00:00Z',notice:'Local only',warnings:[],questions:[{label:'Name',section:'申请问题',required:true,fields:[{type:'input_text',options:[]}]}]},answers:[{selected:false,answer:'Preserve unselected answer'}]};
  const payload={revision:initial.revision,basis:initial.basis,draft};
  const saved=await f.call(url,{auth:a,method:'PUT',value:payload});assert.equal(saved.status,200,saved.text);
  assert.equal((await f.call(url,{auth:b})).status,404);
  assert.equal((await f.call(url,{auth:a,method:'PUT',value:payload})).status,409);
  const s=new WorkspaceStore(f.database);
  assert.deepEqual(s.questionDraft(a.id,j.id).draft,draft);
  const other=s.saveJob(a.id,{...job,title:'Other job'});assert.equal(s.questionDraft(a.id,other.id).draft,null);
  s.saveJob(a.id,{...job,jd:'Changed job description'},j.id);
  const stale=s.questionDraft(a.id,j.id);assert.equal(stale.stale,true);
  assert.throws(()=>s.saveQuestionDraft(a.id,j.id,{...stale,draft}),{status:409});
  const next=s.saveQuestionDraft(a.id,j.id,{...stale,draft,reconfirmed:true});assert.equal(next.stale,false);
  const changed=structuredClone(draft);changed.form.questions[0].label='Different question';
  assert.throws(()=>s.saveQuestionDraft(a.id,j.id,{...next,draft:changed}),{status:409});
  assert.deepEqual(s.questionDraft(a.id,j.id).draft,draft);
  assert.equal(s.preparation(a.id,j.id).notes,'');
  assert.deepEqual(s.exportData(a.id).questionDrafts[0].snapshot,draft);
  assert.equal(s.exportData(b.id).questionDrafts.length,0);
  s.close();
  const {backupWorkspace,restoreWorkspace}=await import('../src/v2/backup.mjs');
  const backupPath=resolve('output/test-runs',randomUUID()),restorePath=resolve('output/test-runs',randomUUID());
  await backupWorkspace(f.database,backupPath);await restoreWorkspace(backupPath,restorePath);
  const restored=new WorkspaceStore(resolve(restorePath,'workspaces.sqlite'));
  assert.deepEqual(restored.questionDraft(a.id,j.id).draft,draft);restored.close();
});
