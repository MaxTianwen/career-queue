import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fail } from './store.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
export async function wordWorkUsage(owner) {
  try {
    return (await readdir(resolve(root, 'private/v2-local/word-work', owner))).length;
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }
}
export async function exportArchive(data, python) {
  if (!python) {
    try {
      python = JSON.parse(await readFile(resolve(root, 'private/v2-local/runtime.json'), 'utf8')).python;
    } catch {
      fail(503, '本机导出环境尚未配置，记录和文件保持不变');
    }
  }
  const payload = Buffer.from(JSON.stringify(data));
  if (payload.length > 64 * 1024 * 1024) fail(413, '个人导出超过本期 64MB 限制，请使用本机完整备份');
  return new Promise((done, reject) => {
    const child = execFile(
      python,
      [resolve(root, 'scripts/v2-export.py')],
      { windowsHide: true, timeout: 30000, maxBuffer: 80 * 1024 * 1024, encoding: 'buffer' },
      (error, stdout) => {
        if (error)
          return reject(Object.assign(new Error('导出失败或超时，记录和文件保持不变，可重试'), { status: 422 }));
        if (stdout.subarray(0, 4).toString('hex') !== '504b0304')
          return reject(Object.assign(new Error('导出结果无效'), { status: 422 }));
        done(stdout);
      }
    );
    child.stdin.on('error', () => {});
    child.stdin.end(payload);
  });
}
