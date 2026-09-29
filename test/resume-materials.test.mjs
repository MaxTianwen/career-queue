import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { dashboardServer } from '../src/dashboard.mjs';
import { DemoStore } from '../src/demo-store.mjs';
import { latestResume } from '../src/resume.mjs';

// Signature fixtures test provenance / transfer gating, not Word rendering.
async function generated(root, key, time) {
  const version = `resume-${time}-12345678`, folder = resolve(root, 'output', key, version);
  await mkdir(resolve(folder, 'working'), { recursive: true });
  const docx = Buffer.from(`PK synthetic ${time}`), pdf = Buffer.from(`%PDF-1.7 synthetic ${time}`);
  const hash = b => createHash('sha256').update(b).digest('hex');
  await writeFile(resolve(folder, 'resume.docx'), docx);
  await writeFile(resolve(folder, 'resume.pdf'), pdf);
  await writeFile(resolve(folder, 'validation.json'), JSON.stringify({ passed: true, pages: 1, docxSha256: hash(docx), pdfSha256: hash(pdf) }));
  await writeFile(resolve(folder, 'working/plan.json'), JSON.stringify({ track: 'cs', template: 'synthetic.docx', baseline: { name: 'new.docx', version: 'base-1-12345678' } }));
  return { version, resumeHash: hash(pdf), folder };
}
async function setup(t) {
  const root = resolve('output/test-runs', randomUUID()), store = new DemoStore(), uploads = [];
  await mkdir(root, { recursive: true });
  store.upload = async path => { uploads.push(path); return { demo: true }; };
  const key = (await store.list())[0].key, server = dashboardServer({ root, storeOverride: store });
  let url, csrf;
  // Windows may assign a Fetch-reserved ephemeral port; retry only that case.
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${server.address().port}`;
    try { csrf = (await (await fetch(url + '/api/status')).json()).csrf; break; }
    catch (error) {
      await new Promise(r => server.close(r));
      if (error.cause?.message !== 'bad port' || attempt === 9) throw error;
    }
  }
  t.after(() => new Promise(r => server.close(r)));
  const request = async (path, body) => {
    const res = await fetch(url + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(body) } : {});
    return { status: res.status, data: await res.json() };
  };
  return { root, store, uploads, key, request };
}

test('generated PDF automatically appears on the job, transfers without reupload, and pins the reviewed version', async t => {
  const { root, store, uploads, key, request } = await setup(t);
  const old = await generated(root, key, 100), current = await generated(root, key, 200);
  const details = (await request(`/api/jobs/${key}`)).data;
  assert.equal(details.generatedMaterial.version, current.version);
  assert.equal(details.generatedMaterial.freshness.status, 'unknown');
  const body = { checked: true, files: {}, generatedVersion: current.version, resumeHash: current.resumeHash,
    assessmentId: details.assessment.id, staleReviewed: true };
  assert.equal((await request(`/api/jobs/${key}/complete`, { ...body, checked: false })).status, 400);
  assert.equal((await request(`/api/jobs/${key}/complete`, { ...body, resumeHash: 'stale' })).status, 400);
  const unreviewed = await request(`/api/jobs/${key}/complete`, { ...body, staleReviewed: false });
  assert.equal(unreviewed.status, 400); assert.match(unreviewed.data.error, /重新审阅/);
  assert.equal((await store.find(key)).status, 'Queue');
  assert.equal(uploads.length, 0);
  const result = await request(`/api/jobs/${key}/complete`, body);
  assert.equal(result.status, 200);
  assert.equal(uploads.length, 1);
  assert.match(uploads[0], /\.pdf$/);
  assert.deepEqual(await readFile(uploads[0]), await readFile(resolve(current.folder, 'resume.pdf')));
  assert.equal(result.data.status, '待提交');
  assert.equal(result.data.applicationDate, null);
  assert.equal(result.data.materialVersion.version, current.version);
  assert.equal(result.data.materialVersion.sha256, current.resumeHash);
  assert.ok(await readFile(resolve(old.folder, 'resume.pdf')));
  await store.updateState({ ...result.data, status: '已投递', applicationDate: '2026-09-25' });
  await generated(root, key, 300);
  assert.equal((await request(`/api/jobs/${key}/complete`, body)).status, 400);
  assert.equal((await store.find(key)).materialVersion.version, current.version);
});

test('failed generations are not offered; corrupt published latest versions block rather than silently use an older file', async t => {
  const { root, key, request } = await setup(t);
  await generated(root, key, 100);
  await mkdir(resolve(root, 'output', key, 'resume-200-12345678/working'), { recursive: true });
  assert.equal((await latestResume(root, key)).version, 'resume-100-12345678');
  const bad = await generated(root, key, 300);
  await writeFile(resolve(bad.folder, 'resume.pdf'), '%PDF-changed');
  assert.match((await request(`/api/jobs/${key}`)).data.generatedMaterial.error, /变化/);
  const assessmentId = (await request(`/api/jobs/${key}`)).data.assessment.id;
  assert.equal((await request(`/api/jobs/${key}/complete`, { checked: true, files: {}, generatedVersion: bad.version, resumeHash: bad.resumeHash, assessmentId, staleReviewed: true })).status, 400);
});

test('PDF alone is sufficient, cover letter is required only when the job requires it, and upload failure preserves state', async t => {
  const { root, store, uploads, key, request } = await setup(t);
  const current = await generated(root, key, 100), body = { checked: true, files: {}, generatedVersion: current.version, resumeHash: current.resumeHash,
    assessmentId: (await request(`/api/jobs/${key}`)).data.assessment.id, staleReviewed: true };
  await store.updateState({ ...await store.find(key), coverLetterRequired: true });
  assert.equal((await request(`/api/jobs/${key}/complete`, body)).status, 400);
  assert.equal(uploads.length, 0);
  body.files.coverLetter = Buffer.from('%PDF-1.7 Cover Letter').toString('base64');
  store.upload = async () => { throw new Error('test upload unavailable'); };
  assert.equal((await request(`/api/jobs/${key}/complete`, body)).status, 400);
  assert.equal((await store.find(key)).status, 'Queue');
  store.upload = async () => ({ demo: true });
  assert.equal((await request(`/api/jobs/${key}/complete`, body)).status, 200);
  const otherKey = (await store.list())[1].key;
  assert.equal((await request(`/api/jobs/${otherKey}/complete`, body)).status, 409);
  const pdf = Buffer.from('%PDF-1.7 Manual file').toString('base64');
  const assessmentId = (await request(`/api/jobs/${otherKey}`)).data.assessment.id;
  assert.equal((await request(`/api/jobs/${otherKey}/complete`, { checked: true, files: { resume: pdf }, assessmentId })).status, 200);
});
