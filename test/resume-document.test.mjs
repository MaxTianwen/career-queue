import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('document guards reject modified formatting, multiple pages, font shrinkage and overflow', async t => {
  let config;
  try { config = JSON.parse(await readFile('private/resume-templates/templates.json', 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return t.skip('Private document runtime not configured'); throw e; }
  await promisify(execFile)(config.python, ['test/resume_document_test.py'], { windowsHide: true, timeout: 30000 });
});
