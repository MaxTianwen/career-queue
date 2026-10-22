import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { buildResumeProfile, matchJob } from '../matching.mjs';
import { fail } from './store.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
export const digest = value => createHash('sha256').update(value).digest('hex');
export async function extractResume(file, python) {
  return extractText(file, python, false);
}
export async function extractDocumentText(file, python) {
  return extractText(file, python, true);
}
async function extractText(file, python, previewOnly) {
  if (!python) {
    try {
      python = JSON.parse(await readFile(resolve(root, 'private/v2-local/runtime.json'), 'utf8')).python;
    } catch {
      fail(503, '本机简历读取环境尚未配置，原件已保留');
    }
  }
  if (typeof python !== 'string' || !python) fail(503, '本机简历读取环境尚未配置');
  const result = await new Promise((done, reject) => {
    const child = execFile(
      python,
      [resolve(root, 'scripts/v2-resume-text.py'), file.format, ...(previewOnly ? ['preview'] : [])],
      { windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error)
          return reject(Object.assign(new Error('本机解析失败或超时，原件和当前简历保持不变'), { status: 422 }));
        try {
          done(JSON.parse(stdout));
        } catch {
          reject(Object.assign(new Error('简历读取结果无效'), { status: 422 }));
        }
      }
    );
    child.stdin.on('error', () => {});
    child.stdin.end(Buffer.from(file.bytes));
  });
  if (result.error) fail(422, result.error);
  if (
    typeof result.text !== 'string' ||
    result.text.length > 100000 ||
    result.text.replace(/\s/g, '').length < (previewOnly ? 1 : 40)
  )
    fail(422, '简历提取文字不足');
  return { ...result, textHash: digest(result.text) };
}
export function resumeProfile(resume) {
  return resume
    ? buildResumeProfile(resume.text, { version: resume.fileId, name: resume.name, sha256: resume.fileSha })
    : { available: false, reason: '请先解析并确认启用自己的简历；不会使用其他用户或历史知识库评分' };
}
// Reuse only within a caller-owned request; never cache private profiles globally.
export function scoreFor(job, resume, profile = resumeProfile(resume)) {
  return {
    ...matchJob({ ...job, fullJd: Boolean(job.jd) }, profile),
    source: resume
      ? {
          fileId: resume.fileId,
          name: resume.name,
          fileSha: resume.fileSha,
          textHash: resume.textHash,
          jdHash: digest(job.jd || ''),
          algorithm: '本地规则 v1'
        }
      : null
  };
}
