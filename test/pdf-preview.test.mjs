import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { renderPdf } from '../src/pdf-preview.mjs';

test('local PDF renderer shows actual pages, validates page numbers and does not modify the PDF', async t => {
  let config;
  try { config = JSON.parse(await readFile('private/resume-templates/templates.json', 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return t.skip('Private document runtime not configured'); throw e; }
  const folder = resolve('output/test-runs', randomUUID()), file = resolve(folder, 'preview.pdf');
  await mkdir(folder, { recursive: true });
  await promisify(execFile)(config.python, ['-c', 'import sys; from reportlab.pdfgen import canvas; c=canvas.Canvas(sys.argv[1]); c.drawString(50,750,"Preview page one"); c.showPage(); c.drawString(50,750,"Preview page two"); c.save()', file], { windowsHide: true });
  const hash = async () => createHash('sha256').update(await readFile(file)).digest('hex');
  const original = await hash();
  const first = await renderPdf(process.cwd(), file, 1), second = await renderPdf(process.cwd(), file, 2);
  assert.equal(first.pages, 2); assert.equal(second.page, 2);
  assert.match(first.image, /^data:image\/png;base64,iVBOR/);
  assert.notEqual(first.image, second.image);
  await assert.rejects(renderPdf(process.cwd(), file, 0), /页码/);
  await assert.rejects(renderPdf(process.cwd(), file, 3), /渲染失败/);
  assert.equal(await hash(), original);
});
