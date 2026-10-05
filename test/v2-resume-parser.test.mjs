import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { extractResume } from '../src/v2/resume.mjs';
import { renderPdf } from '../src/v2/pdf-preview.mjs';
import { exportArchive } from '../src/v2/data.mjs';

// Configure the local Python reader explicitly; do not fall back to a personal resume config.
let python;
try { python = process.env.CQ_V2_TEST_PYTHON || JSON.parse(readFileSync('private/v2-local/runtime.json', 'utf8')).python; } catch {}
function fixture(kind) {
  return execFileSync(python, ['-c', `
import io,sys
from zipfile import ZipFile
from reportlab.pdfgen.canvas import Canvas
from pypdf import PdfReader,PdfWriter
kind=sys.argv[1]; out=io.BytesIO()
text='Synthetic applicant. Built Python and SQL projects for data analysis and stakeholder reporting.'
if kind in ['word','tracked','entity','macro']:
  with ZipFile(out,'w') as z:
    body='<w:p><w:r><w:t>'+text+'</w:t></w:r></w:p>'
    if kind=='tracked': body='<w:ins>'+body+'</w:ins>'
    xml='<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+body+'</w:body></w:document>'
    if kind=='entity': xml='<!DOCTYPE x [<!ENTITY x SYSTEM "file:///not-read">]>'+xml
    z.writestr('word/document.xml',xml)
    if kind=='macro': z.writestr('word/vbaProject.bin','not executable')
else:
  c=Canvas(out)
  if kind!='blank': c.drawString(40,750,text)
  c.showPage()
  if kind=='two': c.drawString(40,750,'Synthetic cover letter second page.'); c.showPage()
  c.save()
  if kind=='encrypted':
    w=PdfWriter();w.add_page(PdfReader(io.BytesIO(out.getvalue())).pages[0]);w.encrypt('synthetic');out=io.BytesIO();w.write(out)
sys.stdout.buffer.write(out.getvalue())
`, kind], { windowsHide: true });
}
test('v2 personal ZIP contains exact originals and readable metadata, with safe file paths', { skip: !python }, async () => {
  const bytes = fixture('pdf');
  const zip = await exportArchive({ format: 'career-queue-personal-export', files: [{ id: 'safe-id', name: '../original中文.pdf', archivePath: 'files/safe-id.pdf', base64: bytes.toString('base64') }], jobs: [{ title: 'Synthetic Job' }] }, python);
  const result = JSON.parse(execFileSync(python, ['-c', "import sys,io,json,hashlib;from zipfile import ZipFile;z=ZipFile(io.BytesIO(sys.stdin.buffer.read()));print(json.dumps({'names':z.namelist(),'hash':hashlib.sha256(z.read('files/safe-id.pdf')).hexdigest(),'records':json.loads(z.read('records.json'))}))"], { input: zip, windowsHide: true }).toString());
  assert.deepEqual(result.names, ['files/safe-id.pdf', 'records.json', 'README.txt']);
  assert.equal(result.hash, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(result.records.files[0].name, '../original中文.pdf'); assert.equal(result.records.files[0].base64, undefined);
  assert.equal(result.records.jobs[0].title, 'Synthetic Job');
});
test('v2 real PDF and DOCX extraction preserve original bytes and consistent evidence', { skip: !python && 'Set CQ_V2_TEST_PYTHON to a Python with lxml, pypdf and reportlab' }, async () => {
  for (const kind of ['word', 'pdf']) {
    const bytes = fixture(kind), before = createHash('sha256').update(bytes).digest('hex');
    const result = await extractResume({ format: kind === 'word' ? 'docx' : 'pdf', bytes }, python);
    assert.match(result.text, /Python and SQL/); assert.equal(result.parser, 'v2-text-1');
    assert.equal(createHash('sha256').update(bytes).digest('hex'), before);
    assert.equal(result.pages, kind === 'word' ? null : 1);
  }
});
test('v2 scanned/blank, encrypted, tracked, embedded macro and entity documents are not silently usable', { skip: !python }, async () => {
  for (const kind of ['blank', 'encrypted', 'tracked', 'entity', 'macro']) {
    await assert.rejects(extractResume({ format: ['blank', 'encrypted'].includes(kind) ? 'pdf' : 'docx', bytes: fixture(kind) }, python), { status: 422 });
  }
  await assert.rejects(extractResume({ format: 'pdf', bytes: Buffer.from('%PDF-corrupt') }, python), { status: 422 });
});

test('v2 PDF preview renders all pages as PNG without changing originals or accepting damaged files', { skip: !python }, async () => {
  for (const kind of ['pdf', 'two', 'blank']) {
    const bytes = fixture(kind), before = Buffer.from(bytes);
    const result = await renderPdf({ format: 'pdf', bytes }, python);
    assert.equal(result.pages, kind === 'two' ? 2 : 1);
    for (const image of result.images) assert.equal(Buffer.from(image, 'base64').subarray(1, 4).toString(), 'PNG');
    assert.deepEqual(bytes, before);
  }
  await assert.rejects(renderPdf({ format: 'docx', bytes: fixture('word') }, python), { status: 400 });
  await assert.rejects(renderPdf({ format: 'pdf', bytes: fixture('encrypted') }, python), { status: 422 });
  await assert.rejects(renderPdf({ format: 'pdf', bytes: Buffer.from('%PDF-corrupt') }, python), { status: 422 });
});
