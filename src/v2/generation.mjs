import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { buildUploadedPlan } from '../resume-bases.mjs';
import { buildReviewDraft, publicReviewDraft, reviewedPlan } from '../resume-review.mjs';
import { digest } from './resume.mjs';
import { fail } from './store.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url)),
  run = promisify(execFile);
const options = { windowsHide: true, timeout: 90000, maxBuffer: 1024 * 1024 };
let busy = false;
export async function withWordFolder(owner, work, python) {
  if (busy) fail(409, '另一个 Word 任务正在处理，请稍后重试');
  if (!/^[a-f0-9-]{36}$/.test(owner)) fail(400, '账号标识无效');
  busy = true;
  try {
    if (!python) {
      try {
        python = JSON.parse(await readFile(resolve(root, 'private/v2-local/runtime.json'), 'utf8')).python;
      } catch {
        fail(503, '本机 Word 生成环境尚未配置');
      }
    }
    const ownerFolder = resolve(root, 'private/v2-local/word-work', owner);
    await mkdir(ownerFolder, { recursive: true });
    if ((await readdir(ownerFolder)).length >= 50)
      fail(409, '本账号文档工作目录达到 50 次上限，请先由本人整理；不会自动批量删除');
    const folder = resolve(ownerFolder, randomUUID());
    await mkdir(folder, { recursive: true });
    return await work(folder, python);
  } finally {
    busy = false;
  }
}
async function inspect(context, file, folder, python) {
  if (
    !context.ready ||
    file.format !== 'docx' ||
    file.id !== context.resume?.fileId ||
    digest(file.bytes) !== context.resume.fileSha
  )
    fail(409, '请启用自己的 Word 原稿；PDF 可继续手动准备，不会使用旧模板');
  const metadata = await inspectFile(file, folder, python);
  const base = {
    ...metadata,
    ready: true,
    version: file.id,
    name: file.name,
    sha256: file.sha256,
    original: resolve(folder, 'baseline.docx'),
    pdf: resolve(folder, 'baseline.pdf')
  };
  const job = { ...context.job, key: context.job.id };
  const plan = { ...buildUploadedPlan(job, base, 'current'), assessment: { id: context.hash } };
  return { ...buildReviewDraft(job, base, plan), slots: metadata.slots };
}
async function inspectFile(file, folder, python) {
  if (file.format !== 'docx' || digest(file.bytes) !== file.sha256) fail(422, 'Word 文件完整性检查失败');
  await writeFile(resolve(folder, 'baseline.docx'), file.bytes, { flag: 'wx' });
  let metadata;
  try {
    metadata = JSON.parse(
      (
        await run(python, [resolve(root, 'scripts/v2-word-inspect.py'), resolve(folder, 'baseline.docx')], {
          ...options,
          timeout: 20000
        })
      ).stdout
    );
  } catch {
    fail(422, 'Word 原稿读取失败，文件保持不变');
  }
  if (metadata.error) fail(422, metadata.error);
  return metadata;
}
export async function prepareWord(owner, context, file, python) {
  return withWordFolder(
    owner,
    async (folder, runtime) => publicReviewDraft(await inspect(context, file, folder, runtime)),
    python
  );
}
export async function generateWord(owner, context, file, input, python) {
  return withWordFolder(
    owner,
    async (folder, runtime) => {
      const draft = await inspect(context, file, folder, runtime);
      if (input.fingerprint !== draft.fingerprint) fail(409, '简历或 JD 已变化，请重新准备对照');
      let plan;
      try {
        plan = reviewedPlan(draft, draft, input);
      } catch (error) {
        fail(400, error.message);
      }
      plan.fixedText = [
        ...plan.fixedText,
        ...draft.slots
          .filter(slot => !plan.edits.some(edit => edit.paragraph === slot.paragraph))
          .map(slot => slot.original)
      ];
      return renderPlan(folder, runtime, plan);
    },
    python
  );
}
async function renderPlan(folder, runtime, plan) {
  await writeFile(resolve(folder, 'plan.json'), JSON.stringify(plan), { flag: 'wx' });
  try {
    await run(
      runtime,
      [
        resolve(root, 'scripts/resume_document.py'),
        'patch',
        resolve(folder, 'plan.json'),
        resolve(folder, 'resume.docx')
      ],
      options
    );
    await run(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        resolve(root, 'scripts/v2-word-export.ps1'),
        '-Folder',
        folder
      ],
      options
    );
    await run(
      runtime,
      [
        resolve(root, 'scripts/resume_document.py'),
        'verify',
        resolve(folder, 'plan.json'),
        resolve(folder, 'resume.docx'),
        '--pdf',
        resolve(folder, 'resume.pdf'),
        '--report',
        resolve(folder, 'validation.json')
      ],
      options
    );
  } catch (error) {
    if (error.stdout?.includes('WORD_BUSY')) fail(409, 'Word 正在使用，请保存并关闭 Word 后重试；不会关闭你的文档');
    if (error.stdout?.includes('ONE_PAGE_REQUIRED'))
      fail(422, '原稿或生成稿超过一页，请先调整 Word 原稿；不会缩小字体');
    fail(422, 'Word 导出或格式校验未通过，未保存生成材料；请检查本机 Word 与原稿后重试');
  }
  const validation = JSON.parse(await readFile(resolve(folder, 'validation.json'), 'utf8'));
  const pdf = await readFile(resolve(folder, 'resume.pdf')),
    docx = await readFile(resolve(folder, 'resume.docx'));
  if (
    !validation.passed ||
    validation.pages !== 1 ||
    validation.pdfSha256 !== digest(pdf) ||
    validation.docxSha256 !== digest(docx)
  )
    fail(422, '生成文件未通过完整性检查');
  return { pdf, docx, validation, review: plan.review };
}

const editFingerprint = (context, file) =>
  digest(JSON.stringify({ context: context.hash, source: file.id, sha: file.sha256 }));
export async function prepareWordEdit(owner, context, file, python) {
  return withWordFolder(
    owner,
    async (folder, runtime) => {
      const metadata = await inspectFile(file, folder, runtime);
      return { fingerprint: editFingerprint(context, file), fields: metadata.slots };
    },
    python
  );
}
export async function editWord(owner, context, file, input, python) {
  return withWordFolder(
    owner,
    async (folder, runtime) => {
      if (input.fingerprint !== editFingerprint(context, file)) fail(409, '编辑来源已变化，请重新打开编辑');
      if (input.confirmed !== true || !Array.isArray(input.edits) || !input.edits.length || input.edits.length > 60)
        fail(400, '请核对修改并确认内容真实');
      const metadata = await inspectFile(file, folder, runtime),
        seen = new Set();
      const edits = input.edits
        .map(change => {
          const slot = metadata.slots.find(slot => slot.paragraph === change?.paragraph);
          if (
            !slot ||
            seen.has(slot.paragraph) ||
            typeof change.text !== 'string' ||
            !change.text.trim() ||
            change.text.length > 2000 ||
            /[\u0000-\u001f\u007f]/.test(change.text)
          )
            fail(400, '仅可修改列出的段落，每段 1–2000 字，不可插入换行或控制字符');
          seen.add(slot.paragraph);
          return { ...slot, text: change.text.trim() };
        })
        .filter(edit => edit.text !== edit.original)
        .sort((a, b) => a.paragraph - b.paragraph);
      if (!edits.length) fail(400, '没有文字变化，无需保存新版本');
      const plan = {
        template: resolve(folder, 'baseline.docx'),
        baselinePdf: resolve(folder, 'baseline.pdf'),
        templateSha256: file.sha256,
        edits,
        fixedText: [
          ...metadata.fixedText,
          ...metadata.slots
            .filter(slot => !edits.some(edit => edit.paragraph === slot.paragraph))
            .map(slot => slot.original)
        ],
        review: {
          mode: 'manual-edit',
          sourceFileId: file.id,
          sourceSha256: file.sha256,
          groups: [],
          edits: edits.map(({ paragraph, original, text }) => ({ paragraph, original, text })),
          confirmed: true
        }
      };
      return renderPlan(folder, runtime, plan);
    },
    python
  );
}
