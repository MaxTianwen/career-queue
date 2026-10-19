import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { workspaceServer } from '../src/v2/server.mjs';
import { WorkspaceStore } from '../src/v2/store.mjs';
import { catalogueJob } from '../src/v2/catalogue.mjs';
import { backupWorkspace, restoreWorkspace } from '../src/v2/backup.mjs';

let python;
try { python = process.env.CQ_V2_TEST_PYTHON || JSON.parse(readFileSync('private/v2-local/runtime.json')).python; } catch {}
const password = 'Synthetic journey original password!', changed = 'Synthetic journey changed password!';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

test('v2 complete two-account journey preserves actual documents and submissions across backup and restore', { skip: !python || process.env.CQ_V2_TEST_WORD !== '1', timeout: 180000 }, async t => {
  const directory = resolve('output/test-runs', `v2-journey-${randomUUID()}`), database = resolve(directory, 'live/workspaces.sqlite');
  const setup = new WorkspaceStore(database);setup.db.prepare("UPDATE settings SET value=1 WHERE name='registration_open'").run();
  await setup.createAdmin({ username: 'operator', password }); setup.close();
  const source = { id: 'fixture', name: 'Synthetic Board', url: 'https://example.com/careers' };
  const catalogue = [
    catalogueJob({ company: 'Synthetic Software', title: 'Software Developer Intern', location: 'Toronto, Canada', url: 'https://example.com/jobs/software', jd: 'Develop software applications and REST APIs. Python SQL automated validation tests required. Software development internship. Four months, Summer 2028.' }, source),
    catalogueJob({ company: 'Synthetic Analytics', title: 'Data Analyst Intern', location: 'Vancouver, Canada', url: 'https://example.com/jobs/data', jd: 'Analyze datasets and build analytical reports. SQL required. Data analytics internship. Four months, Summer 2028.' }, source)
  ];
  let server;
  async function start(path) { server = workspaceServer({legacyRegistration:true, /* Existing pre-email HTTP contract fixture. */ database: path, discover: async () => ({ jobs: catalogue, sources: [{ ...source, count: 2, status: 'complete' }], finishedAt: new Date().toISOString() }) }); server.listen(0, '127.0.0.1'); await once(server, 'listening'); }
  async function stop() { if (server?.listening) await new Promise((done, reject) => server.close(error => error ? reject(error) : done())); }
  t.after(stop); await start(database);
  async function call(path, { auth, method = 'GET', value, bytes, headers = {} } = {}) {
    const origin = `http://127.0.0.1:${server.address().port}`, payload = bytes ?? (value === undefined ? null : Buffer.from(JSON.stringify(value)));
    return new Promise((done, reject) => {
      const req = request(origin + path, { method, headers: { Origin: origin, ...(auth ? { Cookie: auth.cookie, 'X-CQ-CSRF': auth.csrf } : {}), ...(value === undefined ? {} : { 'Content-Type': 'application/json' }), ...(payload ? { 'Content-Length': payload.length } : {}), ...headers } }, res => {
        const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => { const bytes = Buffer.concat(chunks); done({ status: res.statusCode, headers: res.headers, bytes, data: res.headers['content-type']?.includes('json') ? JSON.parse(bytes) : null }); });
      }); req.on('error', reject); req.end(payload);
    });
  }
  async function ok(path, options) { const result = await call(path, options); assert.ok([200, 201].includes(result.status), `${path}: ${result.status} ${JSON.stringify(result.data)}`); return result.data; }
  async function login(username, register = false, secret = password) {
    const result = await call(register ? '/api/register' : '/api/login', { method: 'POST', value: { username, password: secret } });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    return { cookie: result.headers['set-cookie'][0].split(';')[0], csrf: result.data.csrf, id: result.data.user.id };
  }
  const operator = await login('operator'), a = await login('journey_word', true), b = await login('journey_pdf', true);
  await ok('/api/admin/registration', { auth: operator, method: 'PUT', value: { registrationOpen: false } });
  assert.equal((await call('/api/register', { method: 'POST', value: { username: 'uninvited', password } })).status, 403);
  assert.equal((await call('/api/admin/registration', { auth: a, method: 'PUT', value: { registrationOpen: true } })).status, 403);
  const samples = JSON.parse(execFileSync(python, ['-c', `
import io,json,base64
from docx import Document
from reportlab.pdfgen import canvas
d=Document();d.add_heading('Synthetic Word Applicant',0);d.add_heading('Projects',1)
d.add_paragraph('Built accessible React interfaces and documented student feedback.',style='List Bullet')
d.add_paragraph('Built Python SQL pipelines and automated validation tests for data analysis reports.',style='List Bullet')
d.add_paragraph('Coordinated weekly project reviews and documented collaboration with student teams.',style='List Bullet')
d.add_paragraph('Maintained technical documentation and investigated reproducible integration defects with automated regression tests.',style='List Bullet')
d.add_heading('Education',1);d.add_paragraph('Synthetic University, Computer Science 2024-2028')
word=io.BytesIO();d.save(word)
pdf=io.BytesIO();c=canvas.Canvas(pdf);c.drawString(50,780,'Synthetic PDF Applicant');c.drawString(50,750,'Created data analysis reports using SQL and stakeholder interviews.');c.drawString(50,720,'Synthetic College, data analytics project.');c.save()
print(json.dumps({'word':base64.b64encode(word.getvalue()).decode(),'pdf':base64.b64encode(pdf.getvalue()).decode()}))
`], { windowsHide: true, encoding: 'utf8' }));
  const originals = [Buffer.from(samples.word, 'base64'), Buffer.from(samples.pdf, 'base64')];
  async function activate(auth, bytes, name) {
    const file = await ok('/api/files', { auth, method: 'POST', bytes, headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': name } });
    const parsed = await ok(`/api/files/${file.id}/parse`, { auth, method: 'POST', value: {} });
    await ok('/api/resume/activate', { auth, method: 'POST', value: { ...parsed, confirmed: true } }); return file;
  }
  const fa = await activate(a, originals[0], 'own-word.docx'), fb = await activate(b, originals[1], 'own-pdf.pdf');
  await ok('/api/preferences', { auth: a, method: 'PUT', value: { direction: 'cs', locations: 'Toronto', jobTypes: 'intern' } });
  await ok('/api/preferences', { auth: b, method: 'PUT', value: { direction: 'data', locations: 'Vancouver', jobTypes: 'intern' } });
  await ok('/api/recommendations/refresh', { auth: a, method: 'POST', value: {} });
  const ra = await ok('/api/recommendations', { auth: a }), rb = await ok('/api/recommendations', { auth: b });
  assert.equal(ra.jobs.length, 1); assert.equal(rb.jobs.length, 1); assert.notEqual(ra.jobs[0].id, rb.jobs[0].id);
  assert.ok(ra.jobs[0].match.score > 0); assert.ok(rb.jobs[0].match.score > 0);
  const ja = await ok(`/api/recommendations/${ra.jobs[0].id}/save`, { auth: a, method: 'POST', value: {} });
  const jb = await ok(`/api/recommendations/${rb.jobs[0].id}/save`, { auth: b, method: 'POST', value: {} });
  assert.equal((await call(`/api/files/${fa.id}`, { auth: b })).status, 404);
  assert.equal((await call(`/api/jobs/${ja.id}`, { auth: operator })).status, 404);
  const draft = await ok(`/api/jobs/${ja.id}/generation-draft`, { auth: a, method: 'POST', value: {} });
  const generated = await ok(`/api/jobs/${ja.id}/generation`, { auth: a, method: 'POST', value: { fingerprint: draft.fingerprint, contextHash: draft.contextHash, availability: draft.availability, decisions: draft.groups.map(g => ({ id: g.id, accepted: true })), confirmed: true, openConfirmed: true } });
  assert.equal((await call(`/api/jobs/${jb.id}/generation-draft`, { auth: b, method: 'POST', value: {} })).status, 409);
  async function reviewAndSubmit(auth, job, fileId, channel) {
    await ok(`/api/jobs/${job.id}/channel`, { auth, method: 'PUT', value: { channel: channel === 'school' ? 'school-only' : 'both' } });
    const preview = await ok(`/api/files/${fileId}/preview`, { auth, method: 'POST', value: {} }); assert.equal(preview.pages, 1);
    await writeFile(resolve(directory, `${channel}-preview.png`), Buffer.from(preview.images[0].split(',').pop(), 'base64'));
    const current = await ok(`/api/jobs/${job.id}/application`, { auth });
    const material = await ok(`/api/jobs/${job.id}/materials`, { auth, method: 'POST', value: { contextHash: current.context.hash, resumeFileId: fileId, confirmed: true } });
    await ok(`/api/jobs/${job.id}/submission`, { auth, method: 'POST', value: { channel, materialId: material.versions[0].id, date: '2026-01-01', confirmed: true, attachmentsComplete: true } });
  }
  await reviewAndSubmit(a, ja, generated.pdfId, 'employer'); await reviewAndSubmit(b, jb, fb.id, 'school');
  const schoolCopies = [];
  for (const [index, auth] of [a, b].entries()) {
    const job = [ja, jb][index];
    const text = `|Term|ID|Job Title|Organization|Location|App Deadline|\n|---|---|---|---|---|---|\n|2028 - Summer|${900100 + index}|${job.title}|${job.company}|${job.location}|Oct 31, 2026 11:59 PM|`;
    const preview = await ok('/api/school/preview', { auth, method: 'POST', value: { text } });
    await ok('/api/school/import', { auth, method: 'POST', value: { text, fingerprint: preview.fingerprint, selections: [{ index: 0, target: `saved:${job.id}` }], requestId: randomUUID(), confirmed: true } });
    const link = (await ok('/api/school', { auth }))[0];
    const edit = { action: 'update', revision: link.revision, row: { ...link.row, deadlineText: 'Nov 30, 2026 11:59 PM' } };
    const plan = await ok(`/api/school/${link.schoolId}/change-preview`, { auth, method: 'POST', value: edit });
    await ok(`/api/school/${link.schoolId}/changes`, { auth, method: 'POST', value: { ...edit, fingerprint: plan.fingerprint, reason: 'Verified synthetic deadline extension', confirmed: true, requestId: randomUUID() } });
    schoolCopies.push((await ok('/api/school', { auth }))[0].row);
  }
  const editPath = `/api/jobs/${ja.id}/generation/${generated.id}`;
  const editDraft = await ok(`${editPath}/edit-draft`, { auth: a, method: 'POST', value: {} });
  const edited = await ok(`${editPath}/edit`, { auth: a, method: 'POST', value: { ...editDraft, confirmed: true, openConfirmed: true, edits: [{ paragraph: editDraft.fields[0].paragraph, text: editDraft.fields[0].original.replace(/\.$/, '') + ' in a student project.' }] } });
  assert.equal(edited.snapshot.parentId, generated.id);
  const editedPreview = await ok(`/api/files/${edited.pdfId}/preview`, { auth: a, method: 'POST', value: {} });
  assert.equal(editedPreview.pages, 1);
  await writeFile(resolve(directory, 'edited-preview.png'), Buffer.from(editedPreview.images[0].split(',').pop(), 'base64'));
  const afterEdit = await ok(`/api/jobs/${ja.id}/application`, { auth: a });
  assert.equal(afterEdit.versions.length, 1); assert.equal(afterEdit.versions[0].snapshot.resume.id, generated.pdfId);
  assert.equal((await ok('/api/resume', { auth: a })).fileId, fa.id);
  const oldSubmission = afterEdit.submissions[0];
  const correction = { schoolRevision: (await ok(`/api/jobs/${ja.id}/school-context`, { auth: a }))?.revision ?? null, channel: 'school', date: '2026-01-02', receipt: 'Corrected synthetic receipt', reason: 'Correct the synthetic channel and date', revision: 0, requestId: randomUUID() };
  const correctionPath = `/api/jobs/${ja.id}/submissions/${oldSubmission.id}/corrections`;
  const corrected = await ok(correctionPath, { auth: a, method: 'POST', value: correction });
  assert.equal(corrected.submissions[0].materialId, oldSubmission.materialId);
  assert.deepEqual(corrected.versions, afterEdit.versions);
  assert.deepEqual((await ok(correctionPath, { auth: a, method: 'POST', value: correction })).submissions, corrected.submissions);
  await ok(`/api/jobs/${ja.id}`, { auth: a, method: 'PUT', value: { ...ja, jd: ja.jd + '\nUpdated requirement: React.', notes: 'Keep this personal note' } });
  const histories = [await ok(`/api/jobs/${ja.id}/application`, { auth: a }), await ok(`/api/jobs/${jb.id}/application`, { auth: b })];
  const schoolHistories = [await ok('/api/school/history', { auth: a }), await ok('/api/school/history', { auth: b })];
  assert.equal(histories[0].versions[0].stale, true); assert.equal(histories[0].complete, false); assert.equal(histories[1].complete, true);
  await ok('/api/account/password', { auth: a, method: 'POST', value: { currentPassword: password, newPassword: changed, confirmPassword: changed } });
  assert.equal((await call('/api/jobs', { auth: a })).status, 401);
  const freshA = await login('journey_word', false, changed);
  const backupPath = resolve(directory, 'backup'), restorePath = resolve(directory, 'restored');
  const manifest = await backupWorkspace(database, backupPath); await restoreWorkspace(backupPath, restorePath);
  assert.equal((await call('/api/session', { auth: freshA })).status, 200); // Backup never revokes live sessions.
  await stop(); await start(resolve(restorePath, 'workspaces.sqlite'));
  assert.equal((await call('/api/session', { auth: freshA })).status, 401);
  const restored = [await login('journey_word', false, changed), await login('journey_pdf')];
  for (const [index, auth] of restored.entries()) {
    const job = [ja, jb][index], file = [fa, fb][index];
    assert.deepEqual(await ok(`/api/jobs/${job.id}/application`, { auth }), histories[index]);
    assert.equal(sha((await call(`/api/files/${file.id}`, { auth })).bytes), sha(originals[index]));
    assert.equal((await call(`/api/jobs/${[jb, ja][index].id}`, { auth })).status, 404);
    const exported = await call('/api/data/export', { auth, method: 'POST', value: {} }); assert.equal(exported.status, 200);
    const records = JSON.parse(execFileSync(python, ['-c', 'import sys,io,zipfile;z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()));sys.stdout.buffer.write(z.read("records.json"))'], { input: exported.bytes, windowsHide: true, encoding: 'utf8' }));
    assert.equal(records.account.id, auth.id); assert.equal(records.jobs.length, 1); assert.equal(records.submissions.length, 1);
    assert.equal(records.materials.length, 1); assert.equal(records.files.length, index === 0 ? 5 : 1);
    assert.equal(records.schoolLinks.length, 1); assert.deepEqual(records.schoolLinks[0].row, schoolCopies[index]);
    assert.deepEqual((await ok('/api/school', { auth }))[0].row, schoolCopies[index]);
    assert.deepEqual(await ok('/api/school/history', { auth }), schoolHistories[index]);
    assert.deepEqual(records.schoolHistory, schoolHistories[index].events);
    assert.deepEqual(records.schoolSubmissionSources, schoolHistories[index].sources);
    assert.equal(records.schoolHistory.length, 2);
    assert.equal(records.submissionCorrections.length, index === 0 ? 1 : 0);
    if (index === 0) {
      assert.equal(records.submissionCorrections[0].before.channel, 'employer');
      assert.equal(records.submissionCorrections[0].after.channel, 'school');
      assert.equal(records.submissionCorrections[0].reason, correction.reason);
    }
    if (index === 0) assert.equal(records.generatedResumes.find(row => row.id === edited.id).snapshot.parentId, generated.id);
    assert.ok(!JSON.stringify(records).includes(index === 0 ? 'Synthetic PDF Applicant' : 'Synthetic Word Applicant'));
    await writeFile(resolve(directory, `account-${index}-export.zip`), exported.bytes);
  }
  assert.equal((await ok('/api/registration')).registrationOpen, false);
  await writeFile(resolve(directory, 'verified.json'), JSON.stringify({ passed: true, stages: ['registration', 'real parsing', 'preference recommendations', 'save', 'real Word generation', 'real PDF preview', 'review', 'two channels', 'stale history', 'password change', 'live backup', 'restore login', 'private exports'], counts: manifest.counts }, null, 2));
  console.log(`Integrated v2 evidence: ${directory}`);
});
