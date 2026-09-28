import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildResumeProfile, matchJob } from '../src/matching.mjs';
import { currentResumeProfiles, matchCurrentResumes } from '../src/resume-profile.mjs';
import { uploadResumeBase, activateResumeBase } from '../src/resume-bases.mjs';

test('score cites current resume text, counts basic skills conservatively and excludes explicit negatives', () => {
  const profile = buildResumeProfile('Synthetic applicant. Skills: SQL; Power BI (basic); No experience with AWS; Python data cleaning projects.');
  const result = matchJob({ jd: 'Requirements\nSQL, AWS, Power BI, React.', fullJd: true }, profile);
  assert.equal(result.score, 38);
  assert.deepEqual(result.matched.map(s => s.name), ['SQL', 'Power BI']);
  assert.ok(result.matched.every(s => s.evidence.includes(s.name)));
  assert.deepEqual(result.gaps.map(s => s.name), ['React', 'AWS']);
  assert.match(result.note, /当前简历/);
});

test('mixed roles compare whole resumes separately instead of merging their skills to reach 100', () => {
  const profiles = {
    cs: buildResumeProfile('Synthetic applicant resume. Built React interfaces for a student application.', { track: 'cs', name: 'cs-new.pdf', version: 'cs-new' }),
    data: buildResumeProfile('Synthetic applicant resume. Built SQL reports for a student application.', { track: 'data', name: 'data-new.pdf', version: 'data-new' })
  };
  const job = { jd: 'Requirements\nReact, SQL', fullJd: true };
  const mixed = matchCurrentResumes(job, { track: 'mixed' }, profiles);
  assert.deepEqual(mixed.match.comparisons.map(c => c.score), [50, 50]);
  assert.equal(mixed.match.score, 50);
  assert.equal(mixed.match.source.version, 'cs-new');
  const data = matchCurrentResumes(job, { track: 'data' }, profiles);
  assert.equal(data.match.source.version, 'data-new');
  assert.deepEqual(data.jdHighlights.map(h => h.name), ['SQL']);
});

test('uploading, switching and losing a PDF baseline changes scoring without falling back to knowledge or old versions', async t => {
  let runtime;
  try { runtime = JSON.parse(await readFile('private/resume-templates/templates.json', 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return t.skip('Private document runtime not configured'); throw e; }
  const root = resolve('output/test-runs', randomUUID());
  await mkdir(resolve(root, 'private/resume-templates'), { recursive: true });
  await mkdir(resolve(root, 'scripts'));
  await copyFile('scripts/resume_base.py', resolve(root, 'scripts/resume_base.py'));
  await writeFile(resolve(root, 'private/resume-templates/templates.json'), JSON.stringify({ python: runtime.python }));
  await writeFile(resolve(root, 'career_knowledge_base.md'), 'Old knowledge lists all skills; this must not affect scores.');
  async function pdf(name, text) {
    const path = resolve(root, name);
    await promisify(execFile)(runtime.python, ['-c', 'import sys; from reportlab.pdfgen import canvas; c=canvas.Canvas(sys.argv[1]); c.drawString(50,750,sys.argv[2]); c.save()', path, text], { windowsHide: true });
    return uploadResumeBase(root, { track: 'data', name, data: (await readFile(path)).toString('base64') });
  }
  const job = { jd: 'Requirements\nSQL and Python', fullJd: true };
  const first = await pdf('first.pdf', 'Synthetic applicant with SQL experience and documented project delivery.');
  let profiles = await currentResumeProfiles(root);
  assert.equal(matchJob(job, profiles.data).score, 50);
  const second = await pdf('second.pdf', 'Synthetic applicant with SQL and Python experience and documented project delivery.');
  profiles = await currentResumeProfiles(root);
  assert.equal(matchJob(job, profiles.data).score, 100);
  assert.equal(profiles.data.source.version, second.version);
  await activateResumeBase(root, first.version);
  assert.equal(matchJob(job, (await currentResumeProfiles(root)).data).score, 50);
  await pdf('scanned.pdf', '');
  assert.equal(matchJob(job, (await currentResumeProfiles(root)).data).score, null);
  await activateResumeBase(root, second.version);
  await writeFile(resolve(root, 'private/resume-bases', second.version, 'original.pdf'), 'tampered');
  assert.equal(matchJob(job, (await currentResumeProfiles(root)).data).score, null);
});
