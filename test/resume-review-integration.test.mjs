import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { reviewFixture } from './helpers/resume-review-fixture.mjs';
import { editableResume, latestResume, validatedResume, prepareResumeDraft, resumeStatus } from '../src/resume.mjs';

test('review API and real Word/PDF generation preserve originals and persist reviewed/manual provenance', { timeout: 180000 }, async t => {
  let runtime;
  try { runtime = JSON.parse(await readFile('private/resume-templates/templates.json', 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return t.skip('Local Word/Python runtime not configured'); throw error; }
  if (process.platform !== 'win32') return t.skip('Real Word export requires Windows');
  const { root, original, bytes, job, store, server, baseline } = await reviewFixture(runtime);
  const manifestPath = resolve(root, 'private/resume-bases', baseline.version, 'manifest.json');
  const metadata = JSON.parse(await readFile(manifestPath, 'utf8'));
  metadata.slots.find(s => s.original.includes('Built SQL')).original = 'Invented AWS leadership';
  await writeFile(manifestPath, JSON.stringify(metadata));
  let url, csrf;
  for (let i = 0; i < 10; i++) {
    await new Promise(r => server.listen(0, '127.0.0.1', r)); url = `http://127.0.0.1:${server.address().port}`;
    try { csrf = (await (await fetch(url + '/api/status')).json()).csrf; break; }
    catch (error) { await new Promise(r => server.close(r)); if (error.cause?.message !== 'bad port' || i === 9) throw error; }
  }
  t.after(() => new Promise(r => server.close(r)));
  const request = async (path, body) => {
    const response = await fetch(url + path, body === undefined ? {} : { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  await request('/api/assessment/recheck', { source: 'queue', key: job.key });
  const assessed = (await request(`/api/assessment?source=queue&key=${job.key}`)).data;
  const input = { key: job.key, source: 'queue', resumeTrack: 'cs', assessmentId: assessed.assessment.id };
  const proposal = await request('/api/resume/proposal', input);
  assert.equal(proposal.status, 200, JSON.stringify(proposal.data));
  assert.equal(proposal.data.groups.length, 1);
  assert.ok(!JSON.stringify(proposal.data.groups).includes('Invented AWS'));
  assert.equal(proposal.data.plan, undefined);
  await assert.rejects(readdir(resolve(root, 'output', job.key)), { code: 'ENOENT' });
  assert.equal((await store.find(job.key)).status, 'Queue');
  assert.equal((await request('/api/resume/generate', { ...input, confirmed: true })).status, 409);
  const reviewed = { ...input, proposalId: proposal.data.id, confirmed: true,
    decisions: proposal.data.groups.map(g => ({ id: g.id, accepted: true })) };
  assert.equal((await request('/api/resume/generate', { ...reviewed, confirmed: false })).status, 400);
  assert.equal((await request('/api/resume/generate', { ...reviewed, resumeTrack: 'data' })).status, 409);
  const result = await request('/api/resume/generate', reviewed);
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.validation.pages, 1); assert.equal(result.data.validation.passed, true);
  const saved = await validatedResume(root, job.key, result.data.version);
  assert.equal(saved.provenance.review.groups[0].accepted, true);
  assert.equal(saved.provenance.review.groups[0].rows[0].proposed, saved.provenance.edits[0].text);
  assert.deepEqual(await readFile(original), bytes);
  assert.equal((await store.find(job.key)).status, 'Queue');
  assert.equal((await store.find(job.key)).materials, null);
  assert.equal((await latestResume(root, job.key)).version, result.data.version);
  assert.equal((await request('/api/resume/generate', reviewed)).status, 409);
  const history = await request(`/api/resume/review?key=${job.key}&version=${result.data.version}`);
  assert.equal(history.data.review.fingerprint, proposal.data.fingerprint);
  assert.equal((await request(`/api/resume/review?mode=demo&key=${job.key}&version=${result.data.version}`)).status, 400);
  assert.equal((await request(`/api/resume/review?key=${job.key}&version=../bad`)).status, 400);
  const editor = await editableResume(root, job.key, result.data.version), field = editor.fields.find(f => f.text.includes('Built SQL'));
  const manual = await request('/api/resume/edit', { key: job.key, version: editor.version, sourceHash: editor.sourceHash,
    edits: [{ paragraph: field.paragraph, text: field.text.replace('tested', 'checked') }] });
  assert.equal(manual.status, 200, JSON.stringify(manual.data));
  const manualSaved = await validatedResume(root, job.key, manual.data.version);
  assert.equal(manualSaved.provenance.review.type, 'manual-edit');
  assert.equal(manualSaved.provenance.review.parentVersion, result.data.version);
  assert.equal(manualSaved.provenance.review.rows[0].evidence, null);
  assert.equal((await validatedResume(root, job.key, result.data.version)).digest, saved.digest);
  const expired = (await request('/api/resume/proposal', input)).data;
  const now = Date.now;
  try {
    Date.now = () => now() + 21 * 60000;
    assert.equal((await request('/api/resume/generate', { ...reviewed, proposalId: expired.id })).status, 409);
  } finally { Date.now = now; }
  const stale = (await request('/api/resume/proposal', input)).data;
  await store.updateState({ ...await store.find(job.key), jd: job.jd + '\nNew SQL requirement.' });
  const changed = (await request(`/api/assessment?source=queue&key=${job.key}`)).data;
  const rejected = await request('/api/resume/generate', { ...reviewed, proposalId: stale.id, assessmentId: changed.assessment.id });
  assert.equal(rejected.status, 400); assert.match(rejected.data.error, /已变化/);
  assert.deepEqual(await readFile(original), bytes);
  await writeFile(resolve(root, 'integration-result.json'), JSON.stringify({ generated: result.data.version, manual: manual.data.version, pages: 1 }));
  // Existing initial templates use their actual text too, regardless of historical KB alternatives.
  const baseFolder = resolve(root, 'private/resume-bases', baseline.version), templateFolder = resolve(root, 'private/resume-templates');
  await copyFile(resolve(baseFolder, 'original.docx'), resolve(templateFolder, 'initial.docx'));
  await copyFile(resolve(baseFolder, 'baseline.pdf'), resolve(templateFolder, 'initial.pdf'));
  const template = { file: 'initial.docx', baselinePdf: 'initial.pdf', sha256: metadata.sha256, baselineSha256: metadata.pdfSha256 };
  await writeFile(resolve(templateFolder, 'templates.json'), JSON.stringify({ python: runtime.python, knowledgeSha256: 'unrelated-old-knowledge', templates: { cs: template, data: template } }));
  await writeFile(resolve(root, 'private/resume-bases/active.json'), '{}');
  assert.equal((await resumeStatus(root, 'different knowledge')).tracks.cs.ready, true);
  const initial = await prepareResumeDraft(root, job, 'cs');
  assert.match(initial.baseline.version, /^initial-/);
  assert.equal(initial.groups.length, 1);
  assert.equal(initial.groups[0].rows[0].proposed, proposal.data.groups[0].rows[0].proposed);
});
