import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
export async function renderPdf(root, path, page) {
  if (!Number.isInteger(page) || page < 1 || page > 200) throw new Error('预览页码无效');
  if ((await stat(path)).size > 20 * 1024 * 1024) throw new Error('PDF 超过 20MB 预览限制');
  const config = JSON.parse(await readFile(resolve(root, 'private/resume-templates/templates.json'), 'utf8'));
  if (!config.python) throw new Error('未配置本机 PDF 渲染环境');
  try {
    const { stdout } = await run(config.python, [fileURLToPath(new URL('../scripts/preview_pdf.py', import.meta.url)), path, String(page)],
      { windowsHide: true, timeout: 20000, maxBuffer: 20 * 1024 * 1024 });
    return JSON.parse(stdout);
  } catch { throw new Error('PDF 页面渲染失败，请检查文件或使用新窗口查看 PDF'); }
}
