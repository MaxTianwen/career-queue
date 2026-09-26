import { readFile, writeFile, mkdir, readdir, realpath, rename } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const digest = data => createHash('sha256').update(data).digest('hex');
const versionPattern = /^base-\d+-[a-f0-9]{8}$/;
const folderFor = root => resolve(root, 'private/resume-bases');
export async function resumeRuntime(root) {
  const config = JSON.parse(await readFile(resolve(root, 'private/resume-templates/templates.json'), 'utf8'));
  if (!config.python) throw new Error('本机文档运行环境尚未配置');
  return config.python;
}
async function selections(root) {
  try { return JSON.parse(await readFile(resolve(folderFor(root), 'active.json'), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return {}; throw e; }
}
export async function readResumeBase(root, version) {
  if (!versionPattern.test(version || '')) throw new Error('简历基准版本无效');
  const base = await realpath(folderFor(root)), folder = await realpath(resolve(base, version));
  if (relative(base, folder) !== version) throw new Error('简历基准路径无效');
  const manifest = JSON.parse(await readFile(resolve(folder, 'manifest.json'), 'utf8'));
  if (manifest.version !== version || !['cs', 'data'].includes(manifest.track) || !['docx', 'pdf'].includes(manifest.format)) throw new Error('基准记录无效');
  const original = await realpath(resolve(folder, `original.${manifest.format}`));
  const pdf = await realpath(resolve(folder, manifest.format === 'pdf' ? 'original.pdf' : 'baseline.pdf'));
  if (relative(folder, original) !== `original.${manifest.format}` || !['original.pdf', 'baseline.pdf'].includes(relative(folder, pdf))) throw new Error('基准文件路径无效');
  if (digest(await readFile(original)) !== manifest.sha256 || digest(await readFile(pdf)) !== manifest.pdfSha256) throw new Error('基准文件已变化，请重新上传；不会使用旧稿替代');
  return { ...manifest, original, pdf };
}
export async function activeResumeBase(root, track) {
  const version = (await selections(root))[track];
  if (!version) return null;
  const base = await readResumeBase(root, version);
  if (base.track !== track) throw new Error('基准方向不一致');
  return base;
}
function publicBase(base) {
  return { version: base.version, track: base.track, name: base.name, format: base.format, createdAt: base.createdAt,
    ready: base.ready, reason: base.reason, pages: base.pages, editableCount: base.slots?.length || 0,
    preview: `/api/resume-base/file?version=${base.version}&name=preview.pdf` };
}
export async function resumeLibrary(root) {
  const active = await selections(root);
  let entries;
  try { entries = await readdir(folderFor(root), { withFileTypes: true }); }
  catch (e) { if (e.code === 'ENOENT') return { active, versions: [] }; throw e; }
  const versions = [];
  for (const entry of entries.filter(e => e.isDirectory() && !e.isSymbolicLink() && versionPattern.test(e.name))) {
    try { versions.push(publicBase(await readResumeBase(root, entry.name))); }
    catch { /* Incomplete uploads never become selectable versions. */ }
  }
  return { active, versions: versions.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
}
export async function activateResumeBase(root, version) {
  const base = await readResumeBase(root, version), active = await selections(root);
  active[base.track] = version;
  const folder = folderFor(root), temp = resolve(folder, `active-${randomUUID()}.json`);
  await writeFile(temp, JSON.stringify(active), { flag: 'wx' });
  await rename(temp, resolve(folder, 'active.json'));
  return publicBase(base);
}
export function decodeResumeUpload({ track, name, data }) {
  if (!['cs', 'data'].includes(track)) throw new Error('请选择 CS 或 Data 简历方向');
  if (typeof name !== 'string' || name.length > 180 || /[\\/\x00-\x1f]/.test(name)) throw new Error('文件名无效');
  const format = name.toLowerCase().match(/\.(docx|pdf)$/)?.[1];
  if (!format) throw new Error('支持 Word (.docx) 和 PDF；旧版 .doc 请先另存为 .docx');
  if (typeof data !== 'string' || data.length > 14 * 1024 * 1024 || data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new Error('上传内容无效或超过 10MB');
  const bytes = Buffer.from(data, 'base64');
  if (bytes.toString('base64') !== data || !bytes.length || bytes.length > 10 * 1024 * 1024 || (format === 'pdf' ? bytes.subarray(0, 5).toString() !== '%PDF-' : bytes.subarray(0, 4).toString('hex') !== '504b0304')) throw new Error('文件内容与格式不符或超过 10MB');
  return { format, bytes };
}
export async function uploadResumeBase(root, input) {
  const { format, bytes } = decodeResumeUpload(input), python = await resumeRuntime(root);
  const version = `base-${Date.now()}-${randomUUID().slice(0, 8)}`, folder = resolve(folderFor(root), version);
  await mkdir(folder, { recursive: true });
  const original = resolve(folder, `original.${format}`), pdf = resolve(folder, format === 'pdf' ? 'original.pdf' : 'baseline.pdf');
  await writeFile(original, bytes, { flag: 'wx' });
  const options = { windowsHide: true, timeout: 90000, maxBuffer: 1024 * 1024 };
  const inspect = async (type, file) => JSON.parse((await run(python, [resolve(root, 'scripts/resume_base.py'), type, file], options)).stdout);
  let analysis = {};
  try {
    if (format === 'docx') {
      analysis = await inspect('docx', original);
      await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolve(root, 'scripts/export-resume.ps1'), '-InputDocx', original, '-OutputPdf', pdf], options);
    }
    const info = await inspect('pdf', pdf);
    if (format === 'docx' && (info.pages !== 1 || !info.readable)) throw new Error('Word 原稿必须为一页且含可读取文字；不会缩小字号或压缩页边距');
    const ready = format === 'docx' && analysis.slots.length > 0;
    const reason = format === 'pdf' ? '当前基准是 PDF：请上传同版 Word (.docx) 后定制，不会回退到旧简历。'
      : ready ? analysis.note : '已保存并设为基准，但未识别可安全编辑的正文；暂停定制，请核对段落格式或上传标准 Word 简历。';
    const manifest = { version, track: input.track, name: input.name, format, createdAt: new Date().toISOString(), sha256: digest(bytes),
      pdfSha256: digest(await readFile(pdf)), pages: info.pages, ready, reason, ...analysis };
    await writeFile(resolve(folder, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
    return activateResumeBase(root, version);
  } catch (e) { throw new Error(`上传检查未通过，当前基准未改变：${e.stderr?.trim().split('\n').at(-1) || e.message}`); }
}

// Conservative uploaded-template engine: move only existing, identically styled
// adjacent bullets within the same experience. JD text cannot add resume facts.
export function buildUploadedPlan(job, base, track) {
  if (!base.ready) throw new Error(base.reason);
  const stop = new Set('with from that this have will your our the and for are was were using into through'.split(' '));
  const tokens = text => new Set((text.toLowerCase().match(/[a-z][a-z0-9+#.-]*/g) || []).filter(t => t.length > 2 && !stop.has(t)));
  const requirements = tokens(`${job.title}\n${job.jd}`);
  const rank = slot => [...tokens(slot.original)].filter(t => requirements.has(t)).length;
  const edits = [];
  for (const group of base.groups || []) {
    const slots = group.map(i => base.slots.find(s => s.paragraph === i));
    const sorted = [...slots].sort((a, b) => rank(b) - rank(a));
    slots.forEach((slot, i) => { if (slot.original !== sorted[i].original) edits.push({ paragraph: slot.paragraph,
      original: slot.original, text: sorted[i].original, source: `上传基准 ${base.version} 内同一经历的原文重排` }); });
  }
  return { track, template: base.original, templateSha256: base.sha256, baselinePdf: base.pdf, edits, fixedText: base.fixedText || [],
    editableSlots: base.slots.map(({ paragraph, label }) => ({ paragraph, label })),
    baseline: { version: base.version, name: base.name, uploadedAt: base.createdAt },
    engine: '上传原稿 · 本地要点重排', requirements: { matched: [], gaps: [], checks: [] } };
}
