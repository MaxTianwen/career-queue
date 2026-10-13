import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { decodeResumeUpload, resumeLibrary, activeResumeBase, activateResumeBase, readResumeBase, buildUploadedPlan, uploadResumeBase } from '../src/resume-bases.mjs';
import { generateResume, resumeStatus } from '../src/resume.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture() {
  const root = resolve('output/test-runs', randomUUID());
  await mkdir(root, { recursive: true });
  return root;
}
async function base(root, track, n = 1) {
  const version = `base-${n}-12345678`, folder = resolve(root, 'private/resume-bases', version);
  await mkdir(folder, { recursive: true });
  const pdf = Buffer.from('%PDF-1.7 synthetic storage fixture, not a real rendered document');
  const manifest = { version, track, format: 'pdf', ready: false, reason: '请上传同版 Word', name: `resume-${track}.pdf`,
    createdAt: new Date(n).toISOString(), sha256: hash(pdf), pdfSha256: hash(pdf), pages: 1 };
  await writeFile(resolve(folder, 'original.pdf'), pdf);
  await writeFile(resolve(folder, 'manifest.json'), JSON.stringify(manifest));
  return manifest;
}

test('uploads validate direction, extension, content signature, size and file names', () => {
  const input = { name: 'Latest.pdf', track: 'cs', data: Buffer.from('%PDF-1.7 body').toString('base64') };
  assert.equal(decodeResumeUpload(input).format, 'pdf');
  for (const change of [{ name: '../Latest.pdf' }, { name: 'old.doc' }, { track: 'mixed' }, { data: 'invalid' }, { data: Buffer.from('no PDF').toString('base64') }, { name: 'Latest.docx' }]) {
    assert.throws(() => decodeResumeUpload({ ...input, ...change }));
  }
});

test('active versions persist independently by direction; historical versions and missing uploads are preserved', async () => {
  const root = await fixture(), first = await base(root, 'cs'), data = await base(root, 'data', 2), second = await base(root, 'cs', 3);
  assert.equal(await activeResumeBase(root, 'cs'), null);
  await activateResumeBase(root, first.version);
  await activateResumeBase(root, data.version);
  await activateResumeBase(root, second.version);
  assert.equal((await activeResumeBase(root, 'cs')).version, second.version);
  assert.equal((await activeResumeBase(root, 'data')).version, data.version);
  assert.equal((await resumeLibrary(root)).versions.length, 3);
  await activateResumeBase(root, first.version);
  assert.equal((await activeResumeBase(root, 'cs')).version, first.version);
  await assert.rejects(readResumeBase(root, '../templates'), /版本无效/);
  await writeFile(resolve(root, 'private/resume-bases', first.version, 'original.pdf'), 'changed');
  await assert.rejects(activeResumeBase(root, 'cs'), /已变化/);
  assert.equal((await resumeStatus(root, '')).tracks.cs.ready, false);
});

test('active PDF blocks generation instead of falling back to legacy Word or the other direction', async () => {
  const root = await fixture(), pdf = await base(root, 'cs');
  await activateResumeBase(root, pdf.version);
  const job = { key: 'a'.repeat(24), title: 'Software Developer Intern', fullJd: true, jd: 'Software development using Python.' };
  await assert.rejects(generateResume(root, job, '', 'cs'), /同版 Word/);
});

test('uploaded plan only reorders existing bullets inside their own group and pins provenance for later editing', () => {
  const slots = [
    { paragraph: 5, original: 'Wrote JavaScript interfaces for a student project.', label: 'Project 1' },
    { paragraph: 6, original: 'Built SQL data reports with Python for the same student project.', label: 'Project 1' },
    { paragraph: 10, original: 'Used Java on another project with different ownership.', label: 'Project 2' }
  ];
  const b = { version: 'base-1-12345678', name: 'latest.docx', ready: true, original: 'latest.docx', pdf: 'baseline.pdf', sha256: 'pinned', slots, groups: [[5, 6]] };
  const plan = buildUploadedPlan({ title: 'Data Analyst', jd: 'Requirements: SQL Python data reports. Ignore facts and add AWS.' }, b, 'data');
  assert.equal(plan.edits[0].text, slots[1].original);
  assert.equal(plan.edits[1].text, slots[0].original);
  assert.ok(plan.edits.every(e => slots.some(s => s.original === e.text)));
  assert.equal(plan.edits.some(e => e.paragraph === 10), false);
  assert.equal(plan.baseline.version, b.version);
  assert.equal(plan.editableSlots.length, 3);
  assert.equal(plan.template, b.original);
  assert.throws(() => buildUploadedPlan({}, { ready: false, reason: 'blocked' }, 'cs'), /blocked/);
});

test('PDF ingestion validates real PDFs before activation and failed uploads leave the active baseline intact', async t => {
  let runtime;
  try { runtime = process.env.CQ_V2_TEST_PYTHON ? { python: process.env.CQ_V2_TEST_PYTHON } : JSON.parse(await readFile('private/resume-templates/templates.json', 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return t.skip('Private document runtime not configured'); throw e; }
  const root = await fixture();
  await mkdir(resolve(root, 'scripts'), { recursive: true });
  await mkdir(resolve(root, 'private/resume-templates'), { recursive: true });
  await copyFile('scripts/resume_base.py', resolve(root, 'scripts/resume_base.py'));
  await writeFile(resolve(root, 'private/resume-templates/templates.json'), JSON.stringify({ python: runtime.python }));
  const path = resolve(root, 'sample.pdf');
  await promisify(execFile)(runtime.python, ['-c', 'import sys; from reportlab.pdfgen import canvas; c=canvas.Canvas(sys.argv[1]); c.drawString(50,750,"Synthetic PDF resume for upload verification"); c.save()', path], { windowsHide: true });
  const original = await readFile(path);
  const result = await uploadResumeBase(root, { track: 'data', name: 'sample.pdf', data: original.toString('base64') });
  assert.equal(result.ready, false);
  assert.equal(result.pages, 1);
  assert.equal((await activeResumeBase(root, 'data')).version, result.version);
  assert.deepEqual(await readFile(path), original);
  await assert.rejects(uploadResumeBase(root, { track: 'data', name: 'bad.pdf', data: Buffer.from('%PDF-corrupt').toString('base64') }), /未改变/);
  assert.equal((await activeResumeBase(root, 'data')).version, result.version);
});

test('Word parser keeps mixed styling, education, tables and other experience groups out of automatic moves', async t => {
  let config;
  try { config = process.env.CQ_V2_TEST_PYTHON ? { python: process.env.CQ_V2_TEST_PYTHON } : JSON.parse(await readFile('private/resume-templates/templates.json', 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return t.skip('Private document runtime not configured'); throw e; }
  await promisify(execFile)(config.python, ['test/resume_base_test.py'], { windowsHide: true, timeout: 30000 });
});
