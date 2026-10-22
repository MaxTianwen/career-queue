import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { fail } from './store.mjs';

export async function renderPdf(file, python) {
  if (file.format !== 'pdf') fail(400, '申请材料需为 PDF');
  if (!python) {
    try {
      python = JSON.parse(
        await readFile(new URL('../../private/v2-local/runtime.json', import.meta.url), 'utf8')
      ).python;
    } catch {
      fail(503, '本机 PDF 预览环境尚未配置');
    }
  }
  if (typeof python !== 'string' || !python) fail(503, '本机 PDF 预览环境尚未配置');
  const result = await new Promise((done, reject) => {
    const child = execFile(
      python,
      [fileURLToPath(new URL('../../scripts/v2-pdf-preview.py', import.meta.url))],
      { windowsHide: true, timeout: 20000, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => {
        if (error) return reject(Object.assign(new Error('PDF 预览失败或超出读取上限，原件未改变'), { status: 422 }));
        try {
          done(JSON.parse(stdout));
        } catch {
          reject(Object.assign(new Error('PDF 预览结果无效'), { status: 422 }));
        }
      }
    );
    child.stdin.on('error', () => {});
    child.stdin.end(Buffer.from(file.bytes));
  });
  if (result.error) fail(422, result.error);
  if (
    !Number.isInteger(result.pages) ||
    result.pages < 1 ||
    result.pages > 10 ||
    result.images?.length !== result.pages
  )
    fail(422, 'PDF 预览结果不完整');
  return result;
}
