import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { prepareWord, generateWord, withWordFolder, prepareWordEdit, editWord } from '../src/v2/generation.mjs';
import { digest } from '../src/v2/resume.mjs';

let python;
try { python = process.env.CQ_V2_TEST_PYTHON || JSON.parse(readFileSync('private/v2-local/runtime.json')).python; } catch {}
test('v2 retained work directories are capped per account without automatic deletion', async () => {
  const owner = randomUUID();
  for (let i = 0; i < 50; i++) await withWordFolder(owner, async () => {}, 'unused-test-runtime');
  await assert.rejects(withWordFolder(owner, async () => {}, 'unused-test-runtime'), { status: 409 });
  await withWordFolder(randomUUID(), async () => {}, 'unused-test-runtime');
});
function sample(kind = 'normal') {
  const bytes = execFileSync(python, ['-c', `
import io,sys
from zipfile import ZipFile
from docx import Document
d=Document();d.add_heading('Synthetic Applicant',0);d.add_heading('Projects',1)
d.add_paragraph('Synthetic project')
d.add_paragraph('Built accessible React interfaces and documented student feedback.',style='List Bullet')
d.add_paragraph('Built Python SQL pipelines and automated validation tests for data analysis reports.',style='List Bullet')
d.add_paragraph('Coordinated weekly project reviews and documented collaboration with student teams.',style='List Bullet')
d.add_heading('Education',1);d.add_paragraph('Synthetic University, Computer Science 2024-2028')
if sys.argv[1]=='two':d.add_page_break();d.add_paragraph('Additional page')
o=io.BytesIO();d.save(o)
if sys.argv[1]=='external':
 old=ZipFile(io.BytesIO(o.getvalue()));o=io.BytesIO()
 with ZipFile(o,'w') as z:
  for e in old.infolist():z.writestr(e,old.read(e))
  z.writestr('word/_rels/unsafe.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="template" Target="https://example.invalid/template" TargetMode="External"/></Relationships>')
sys.stdout.buffer.write(o.getvalue())
`, kind], { windowsHide: true });
  const file = { id: randomUUID(), name: 'synthetic.docx', format: 'docx', bytes, sha256: digest(bytes) };
  const context = { ready: true, hash: digest('context'), resume: { fileId: file.id, fileSha: file.sha256 }, job: { id: randomUUID(), title: 'Python SQL Intern', jd: 'Python SQL pipelines automated validation tests data analysis reports.' } };
  return { file, context, owner: randomUUID() };
}
test('v2 Word suggestions are stable verbatim moves, no private paths or template fallbacks', { skip: !python }, async () => {
  const { file, context, owner } = sample(), before = Buffer.from(file.bytes);
  const a = await prepareWord(owner, context, file, python), b = await prepareWord(owner, context, file, python);
  assert.equal(a.fingerprint, b.fingerprint); assert.equal(a.groups.length, 1);
  assert.ok(a.groups[0].rows.some(row => /Python SQL/.test(row.proposed)));
  assert.equal(a.plan, undefined); assert.doesNotMatch(JSON.stringify(a), /word-work|baseline\.pdf/);
  assert.deepEqual(file.bytes, before);
  await assert.rejects(prepareWord(owner, context, { ...file, format: 'pdf' }, python), { status: 409 });
  await assert.rejects(prepareWord(owner, context, { ...file, id: randomUUID() }, python), { status: 409 });
});
test('v2 refuses unreviewed, stale or malformed Word decisions before exporting', { skip: !python }, async () => {
  const { file, context, owner } = sample(), draft = await prepareWord(owner, context, file, python);
  await assert.rejects(generateWord(owner, context, file, { fingerprint: 'stale' }, python), { status: 409 });
  await assert.rejects(generateWord(owner, context, file, { fingerprint: draft.fingerprint, confirmed: false }, python), { status: 400 });
  await assert.rejects(generateWord(owner, context, file, { fingerprint: draft.fingerprint, confirmed: true, decisions: [{ id: 'unknown', accepted: true }] }, python), { status: 400 });
});
test('v2 Word preflight rejects externally linked templates before Office starts', { skip: !python }, async () => {
  const { file, context, owner } = sample('external');
  await assert.rejects(prepareWord(owner, context, file, python), { status: 422 });
});
test('v2 real Word one-page export and two-page refusal preserve originals', { skip: !python || process.env.CQ_V2_TEST_WORD !== '1' }, async () => {
  for (const kind of ['normal', 'two']) {
    const { file, context, owner } = sample(kind), original = Buffer.from(file.bytes);
    const draft = await prepareWord(owner, context, file, python);
    const input = { fingerprint: draft.fingerprint, confirmed: true, decisions: draft.groups.map(g => ({ id: g.id, accepted: true })) };
    if (kind === 'two') await assert.rejects(generateWord(owner, context, file, input, python), error => error.status === 422 && /一页/.test(error.message));
    else {
      const result = await generateWord(owner, context, file, input, python);
      assert.equal(result.validation.pages, 1); assert.equal(result.validation.formattingUnchanged, true); assert.equal(result.validation.fontSizesUnchanged, true);
      assert.equal(digest(result.pdf), result.validation.pdfSha256);
    }
    assert.deepEqual(file.bytes, original);
  }
});

test('v2 manual text editing validates editable slots, source and confirmation before Word export', { skip: !python }, async () => {
  const { file, context, owner } = sample(), draft = await prepareWordEdit(owner, context, file, python);
  assert.equal(draft.fields.length, 3); assert.doesNotMatch(JSON.stringify(draft), /word-work|baseline\.docx/);
  const edit = { paragraph: draft.fields[0].paragraph, text: 'Updated synthetic project description with accurate evidence.' };
  const input = { fingerprint: draft.fingerprint, confirmed: true, edits: [edit] };
  for (const bad of [{ confirmed: false }, { edits: [] }, { edits: [edit, edit] }, { edits: [{ ...edit, paragraph: 0 }] }, { edits: [{ ...edit, text: '' }] }, { edits: [{ ...edit, text: 'One\nTwo' }] }, { edits: [{ ...edit, text: 'x'.repeat(2001) }] }, { edits: [{ ...edit, text: draft.fields[0].original }] }]) {
    await assert.rejects(editWord(owner, context, file, { ...input, ...bad }, python), { status: 400 });
  }
  await assert.rejects(editWord(owner, { ...context, hash: 'changed' }, file, input, python), { status: 409 });
});

test('v2 actual manual edit preserves fonts and originals; overflowing text is rejected', { skip: !python || process.env.CQ_V2_TEST_WORD !== '1' }, async () => {
  const { file, context, owner } = sample(), original = Buffer.from(file.bytes);
  const draft = await prepareWordEdit(owner, context, file, python);
  const input = { fingerprint: draft.fingerprint, confirmed: true, edits: [{ paragraph: draft.fields[0].paragraph, text: 'Built accessible React interfaces and documented feedback from students.' }] };
  const result = await editWord(owner, context, file, input, python);
  assert.equal(result.validation.pages, 1); assert.equal(result.validation.formattingUnchanged, true); assert.equal(result.validation.fontSizesUnchanged, true);
  assert.equal(result.review.mode, 'manual-edit'); assert.equal(result.review.edits[0].original, draft.fields[0].original);
  const nextFile = { ...file, id: randomUUID(), bytes: result.docx, sha256: digest(result.docx) };
  const next = await prepareWordEdit(owner, context, nextFile, python);
  assert.equal(next.fields[0].original, input.edits[0].text);
  await assert.rejects(editWord(owner, context, file, { ...input, edits: draft.fields.map(field => ({ paragraph: field.paragraph, text: 'This is a long synthetic sentence for overflow validation. '.repeat(33) })) }, python), error => error.status === 422 && /一页/.test(error.message));
  assert.deepEqual(file.bytes, original);
});

test('batch actual per-JD Word exports differ only through reviewed original-text reorder, preserve sources and yield previewable PDFs', {skip:!python||process.env.CQ_V2_TEST_WORD!=='1'},async()=>{
 const {file,context,owner}=sample(),original=Buffer.from(file.bytes),results=[];
 for(const jd of ['Python SQL pipelines automated validation tests data analysis reports.','React accessible interfaces student feedback.']){
  const current={...context,hash:digest(jd),job:{...context.job,id:randomUUID(),jd}};
  const draft=await prepareWord(owner,current,file,python);
  const result=await generateWord(owner,current,file,{fingerprint:draft.fingerprint,confirmed:true,decisions:draft.groups.map(g=>({id:g.id,accepted:true}))},python);
  assert.equal(result.validation.pages,1);assert.equal(result.validation.formattingUnchanged,true);assert.equal(result.validation.fontSizesUnchanged,true);
  const {renderPdf}=await import('../src/v2/pdf-preview.mjs');const preview=await renderPdf({format:'pdf',bytes:result.pdf},python);assert.equal(preview.pages,1);assert(preview.images.length>0);
  const parsed=await prepareWordEdit(owner,current,{...file,bytes:result.docx,sha256:digest(result.docx)},python);
  results.push(parsed.fields.map(x=>x.original));assert.deepEqual(file.bytes,original);
 }
 assert.notDeepEqual(results[0],results[1]);assert.deepEqual([...results[0]].sort(),[...results[1]].sort());
});
