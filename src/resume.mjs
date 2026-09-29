import { readFile, writeFile, mkdir, copyFile, realpath, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, basename, relative } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { currentResumeProfiles } from './resume-profile.mjs';
import { assessJob, assessmentSnapshot } from './assessment.mjs';
import { selectResumeTrack } from './resume-track.mjs';
import { buildProfile, matchJob } from './matching.mjs';
import { extractDeadline, deadlineExpired } from './deadlines.mjs';
import { activeResumeBase, resumeRuntime, buildUploadedPlan } from './resume-bases.mjs';

const run = promisify(execFile);
const hash = value => createHash('sha256').update(value).digest('hex');
const keyPattern = /^[a-f0-9]{24}$/;

async function configuration(root) {
  const folder = resolve(root, 'private/resume-templates');
  const config = JSON.parse(await readFile(resolve(folder, 'templates.json'), 'utf8'));
  for (const track of ['cs', 'data']) {
    const t = config.templates?.[track];
    if (!t) throw new Error('初始模板尚未配置，请在“我的简历”上传基准');
    if (basename(t.file) !== t.file || basename(t.baselinePdf) !== t.baselinePdf) throw new Error('模板文件配置无效');
    if (hash(await readFile(resolve(folder, t.file))) !== t.sha256 || hash(await readFile(resolve(folder, t.baselinePdf))) !== t.baselineSha256) throw new Error('模板已变化，需要重新核对原稿和排版');
  }
  return { ...config, folder };
}

export async function validatedResume(root, key, version) {
  if (!keyPattern.test(key || '') || !/^resume-\d+-[a-f0-9]{8}$/.test(version || '')) throw new Error('请选择已生成的简历版本');
  const base = await realpath(resolve(root, 'output'));
  const folder = await realpath(resolve(base, key, version));
  if (relative(base, folder) !== `${key}/${version}`.replaceAll('/', process.platform === 'win32' ? '\\' : '/')) throw new Error('简历路径无效');
  const docx = await realpath(resolve(folder, 'resume.docx')), pdf = await realpath(resolve(folder, 'resume.pdf'));
  if (relative(folder, docx) !== 'resume.docx' || relative(folder, pdf) !== 'resume.pdf') throw new Error('简历路径无效');
  const validation = JSON.parse(await readFile(resolve(folder, 'validation.json'), 'utf8'));
  const provenance = JSON.parse(await readFile(resolve(folder, 'working/plan.json'), 'utf8'));
  const digest = hash(await readFile(docx));
  if (!validation.passed || validation.pages !== 1 || validation.docxSha256 !== digest || validation.pdfSha256 !== hash(await readFile(pdf))) throw new Error('该版本文件已变化或未通过检查，请重新生成');
  return { docx, pdf, digest, validation, provenance, version };
}

export async function latestResume(root, key) {
  if (!keyPattern.test(key || '')) throw new Error('职位标识无效');
  let entries;
  try { entries = await readdir(resolve(root, 'output', key), { withFileTypes: true }); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  const versions = entries.filter(e => e.isDirectory() && !e.isSymbolicLink() && /^resume-\d+-[a-f0-9]{8}$/.test(e.name))
    .sort((a, b) => Number(b.name.split('-')[1]) - Number(a.name.split('-')[1]));
  for (const { name } of versions) {
    try { await readFile(resolve(root, 'output', key, name, 'validation.json')); }
    catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    const checked = await validatedResume(root, key, name);
    return { version: name, sha256: checked.validation.pdfSha256, track: checked.provenance.track,
      assessment: checked.provenance.assessment || null, baseline: checked.provenance.baseline || { name: basename(checked.provenance.template), version: 'initial-template' },
      url: `/api/file?mode=live&key=${key}&version=${name}&name=resume.pdf` };
  }
  return null;
}

async function editingSource(root, key, version) {
  const { provenance, docx, pdf, digest } = await validatedResume(root, key, version);
  const config = provenance.editableSlots ? { python: await resumeRuntime(root) } : await configuration(root);
  const template = config.templates?.[provenance.track];
  if (!provenance.editableSlots && !template) throw new Error('无法识别该版本的原始模板');
  const slots = provenance.editableSlots || [
    { paragraph: 3, label: '求职摘要' },
    ...template.summary.map((_, i) => ({ paragraph: 4 + i, label: `摘要要点 ${i + 1}` })),
    ...template.skills.map(s => ({ paragraph: s.paragraph, skip: 1, label: `技能 · ${s.label}` })),
    ...template.slots.map((s, i) => ({ paragraph: s.paragraph, label: `项目 / 工作经历要点 ${i + 1}` }))
  ];
  const { stdout } = await run(config.python, [resolve(root, 'scripts/resume_document.py'), 'inspect', JSON.stringify({ edits: slots }), docx],
    { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 });
  return { config, provenance, docx, pdf, digest, fields: JSON.parse(stdout) };
}

export async function editableResume(root, key, version) {
  const source = await editingSource(root, key, version);
  return { key, version, sourceHash: source.digest, track: source.provenance.track,
    fields: source.fields.map(({ paragraph, label, text }) => ({ paragraph, label, text })) };
}

export function manualEdits(fields, inputs) {
  if (!Array.isArray(inputs) || !inputs.length || inputs.length > fields.length) throw new Error('请提供要修改的正文');
  const seen = new Set(), edits = [];
  for (const input of inputs) {
    const field = fields.find(f => f.paragraph === input?.paragraph);
    if (!field || seen.has(field.paragraph)) throw new Error('包含不可编辑或重复的段落');
    seen.add(field.paragraph);
    if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 4000 || /[\x00-\x1f\x7f]/.test(input.text)) throw new Error('每项须有正文且不超过 4000 字符，请不要手动换行或插入制表符');
    if (input.text !== field.text) edits.push({ paragraph: field.paragraph, original: field.original, text: input.text, skip: field.skip || 0, source: '用户手动修改，事实需本人核实' });
  }
  if (!edits.length) throw new Error('文字没有变化，无需另存版本');
  return edits;
}

export async function saveManualResume(root, { key, version, sourceHash, edits: inputs }) {
  const source = await editingSource(root, key, version);
  if (sourceHash !== source.digest) throw new Error('源版本已变化，请重新打开编辑器');
  const edits = manualEdits(source.fields, inputs);
  const plan = { track: source.provenance.track, template: source.docx, templateSha256: source.digest,
    baselinePdf: source.pdf, fixedText: source.provenance.fixedText, edits, parentVersion: version,
    assessment: source.provenance.assessment, evaluationSnapshot: source.provenance.evaluationSnapshot, baseline: source.provenance.baseline, editableSlots: source.provenance.editableSlots, engine: '手动文字修改' };
  const review = `# 手动修改记录\n\n来源版本：${version}\n\n以下文字由用户手动输入，未调用模型或自动核验事实。保存只生成本机新版本，不修改原稿、旧版本、Notion 材料或申请状态。\n\n${edits.map(e => `- 原文：${e.original}\n  修改：${e.text}\n`).join('\n')}\n\n通过原格式、字体、字号和 PDF 一页检查；仍需本人核对事实和版式。`;
  return publishResume(root, key, plan, review, source.config.python);
}

export async function resumeStatus(root, knowledge) {
  const tracks = {};
  let legacy;
  try {
    const config = await configuration(root);
    if (hash(knowledge) !== config.knowledgeSha256) throw new Error('知识库已更新，需要复核简历事实映射后再生成');
    legacy = config;
  } catch (error) { legacy = { error: error.code === 'ENOENT' ? '原始模板或文档运行环境尚未配置' : error.message }; }
  for (const track of ['cs', 'data']) {
    try {
      const base = await activeResumeBase(root, track);
      tracks[track] = base ? { ready: base.ready, name: base.name, version: base.version, reason: base.reason }
        : { ready: !legacy.error, name: legacy.templates?.[track]?.file || '未配置', reason: legacy.error || '最初固定模板，尚未上传新基准' };
    } catch (e) { tracks[track] = { ready: false, name: '基准不可用', reason: e.message }; }
  }
  return { ready: Object.values(tracks).some(t => t.ready), tracks, templates: Object.fromEntries(Object.entries(tracks).map(([k, t]) => [k, t.name])),
    note: '使用所选方向当前基准；上传稿按 JD 重排已有要点，不新增事实。保留原格式并检查一页，仍需审阅。',
    reason: Object.values(tracks).map(t => t.reason).join('；') };
}

function relevance(tags, jd) {
  return tags.reduce((sum, tag) => {
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return sum + (new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'i').test(jd) ? 1 : 0);
  }, 0);
}

export function buildResumePlan(job, knowledge, config, requested = 'auto') {
  if (!job.jd?.trim() || job.fullJd === false) throw new Error('需要完整 JD 才能定制简历');
  if (deadlineExpired(extractDeadline(job).deadline)) throw new Error('申请已截止，不能生成申请材料');
  if (hash(knowledge) !== config.knowledgeSha256) throw new Error('知识库已更新，需要复核简历事实映射后再生成');
  const selection = selectResumeTrack(job, requested), t = config.templates[selection.track];
  const requirements = matchJob(job, buildProfile(knowledge));
  const requirementsText = job.jd.match(/^(?:[\s#*-]*)(?:qualifications|requirements|what you (?:bring|need)|who you are|about you)[!:\s]*$([\s\S]*)/im)?.[1] || job.jd;
  const rank = item => relevance(item.tags, requirementsText) * 2 + relevance(item.tags, `${job.title}\n${job.jd}`);
  const edits = [];
  const add = (paragraph, text, source, skip = 0) => {
    const original = t.paragraphs[paragraph];
    const before = skip ? t.skills.find(s => s.paragraph === paragraph).content : original;
    if (text !== before) edits.push({ paragraph, original, text, source, skip });
  };
  const term = /^(Winter|Summer|Fall|Summer\/Fall) 2027$/.test(job.term) ? job.term : '2027';
  const role = selection.track === 'cs' ? 'software development' : /business analyst/i.test(job.title) ? 'business analysis' : /data engineer/i.test(job.title) ? 'data engineering' : /data scien/i.test(job.title) ? 'data science' : 'data analysis';
  if (!/seeking [^;]+;/.test(t.paragraphs[3])) throw new Error('原稿求职目标位置已变化，需要重新核对模板');
  add(3, t.paragraphs[3].replace(/seeking [^;]+;/, `seeking ${term} ${role} co-op or internship roles;`), 'Original resume summary; confirmed target term');
  [...t.summary].sort((a, b) => rank(b) - rank(a)).forEach((item, i) => add(4 + i, item.text, item.source));
  for (const slot of t.slots) {
    const best = [...slot.options].sort((a, b) => rank(b) - rank(a))[0];
    add(slot.paragraph, best.text, best.source);
  }
  for (const skill of t.skills) {
    const prefix = skill.content.match(/^[:\s]*/)[0];
    const items = skill.content.slice(prefix.length).split(/,\s*(?![^()]*\))/);
    const supported = items.filter(x => !/^(React|MongoDB|Claude Code)$/i.test(x.trim()));
    const sorted = supported.map((text, i) => ({ text, i, score: relevance([text.replace(/\s*\(.*\)/, '').trim()], requirementsText) }))
      .sort((a, b) => b.score - a.score || a.i - b.i).map(x => x.text);
    add(skill.paragraph, prefix + sorted.join(', '), 'Existing resume skill list; unverified React/MongoDB/Claude Code omitted per KB §5', 1);
  }
  return { track: selection.track, selection, template: resolve(config.folder, t.file), templateSha256: t.sha256,
    baselinePdf: resolve(config.folder, t.baselinePdf), edits, requirements,
    fixedText: [t.paragraphs[0], 'SUMMARY OF QUALIFICATIONS', 'SKILLS', 'EDUCATION', 'PROJECTS', 'WORK EXPERIENCE', ...(t.fixedText || [])],
    engine: '本地规则定制 v1' };
}

export async function generateResume(root, job, knowledge, requested = 'auto', evaluationSnapshot = null) {
  if (!keyPattern.test(job.key || '')) throw new Error('职位标识无效');
  if (job.status && !['Queue', '待提交'].includes(job.status)) throw new Error('该申请状态不允许生成新材料');
  if (!job.jd?.trim() || job.fullJd === false) throw new Error('需要完整 JD 才能定制简历');
  if (deadlineExpired(extractDeadline(job).deadline)) throw new Error('申请已截止，不能生成申请材料');
  const selection = selectResumeTrack(job, requested), base = await activeResumeBase(root, selection.track);
  if (base && !base.ready) throw new Error(base.reason);
  const assessed = assessJob(job, await currentResumeProfiles(root), new Date(), selection.track);
  if (evaluationSnapshot && evaluationSnapshot.assessment.id !== assessed.assessment.id) throw new Error('简历或 JD 已变化，请重新核对后生成');
  if (base && assessed.match.source.sha256 !== base.pdfSha256) throw new Error('基准简历已变化，请重新核对后生成');
  const snapshot = { ...assessmentSnapshot(job, assessed), generationTrack: selection.track };
  if (base) {
    const plan = { ...buildUploadedPlan(job, base, selection.track), assessment: snapshot.assessment, evaluationSnapshot: snapshot };
    const review = `# 上传简历定制记录\n\n基准：${base.name}\n版本：${base.version}\n上传：${base.createdAt}\n\n${base.reason}\n\n${plan.edits.length ? plan.edits.map(e => `- 原文：${e.original}\n  调整：${e.text}`).join('\n') : '没有需要重排的要点，本次保留原文。'}\n\n不混入旧简历或知识库的事实；不代表 ATS 分数或录取保证。原文件和历史版本不变，仍需人工审阅。`;
    return publishResume(root, job.key, plan, review, await resumeRuntime(root));
  }
  const config = await configuration(root);
  const plan = { ...buildResumePlan(job, knowledge, config, requested), assessment: snapshot.assessment, evaluationSnapshot: snapshot };
  const review = `# ${job.company} / ${job.title} — 修改说明\n\n方向：${plan.track.toUpperCase()}；模板：${basename(plan.template)}\n引擎：${plan.engine}（没有模型 API 调用）\n\n实际 PDF 1 页；原 DOCX 字体、字号、段落、页边距和非文字部件检查通过。原文件未修改。自动检查不替代人工事实与视觉审阅。\n\n## 修改与事实依据\n${plan.edits.map(e => `\n- 原文：${e.original}\n  新文：${e.text}\n  依据：${e.source}\n`).join('')}\n## JD 已识别证据\n${(plan.requirements.matched || []).map(x => `- ${x.name}：${x.evidence}`).join('\n') || '未识别，需人工阅读 JD'}\n\n## 未证实与资格待核实\n${(plan.requirements.gaps || []).map(x => `- ${x.name}：没有补进简历`).join('\n')}\n${(plan.requirements.checks || []).map(x => `- ${x}`).join('\n')}\n\n本版采用事先核对的事实表达与关键词规则，不作完整语义推理；保留原稿项目日期。未证实技能未新增，基础技能不升级。成果口径保留估算或采用非数字表述；CMS 后续迭代保留 Codex 辅助说明。此版本仍需人工审阅，不保证 ATS / AI 通过，不代表已投递。\n`;
  return publishResume(root, job.key, plan, review, config.python);
}

async function publishResume(root, key, plan, review, python) {
  const version = `resume-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const folder = resolve(root, 'output', key, version), working = resolve(folder, 'working');
  await mkdir(working, { recursive: true });
  const planPath = resolve(working, 'plan.json'), docx = resolve(working, 'resume.docx'), pdf = resolve(working, 'resume.pdf');
  await writeFile(planPath, JSON.stringify(plan, null, 2), { flag: 'wx' });
  const options = { windowsHide: true, timeout: 90000, maxBuffer: 1024 * 1024 };
  try {
    await run(python, [resolve(root, 'scripts/resume_document.py'), 'patch', planPath, docx], options);
    await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolve(root, 'scripts/export-resume.ps1'), '-InputDocx', docx, '-OutputPdf', pdf], options);
    await run(python, [resolve(root, 'scripts/resume_document.py'), 'verify', planPath, docx, '--pdf', pdf, '--report', resolve(working, 'validation.json')], options);
  } catch (error) {
    const reason = error.stderr?.trim().split('\n').at(-1) || error.message;
    if (reason.includes('Resume exceeds one page')) throw new Error('修改后超过一页，请精简文字后重试；不会缩小字体或页边距');
    throw new Error(`简历生成或版式检查未通过，未发布材料，也未改变申请状态：${reason}`);
  }
  const validation = JSON.parse(await readFile(resolve(working, 'validation.json'), 'utf8'));
  if (validation.passed !== true || validation.pages !== 1) throw new Error('简历未通过一页及版式检查');
  // Only validated files are published at the version root. Failed working files
  // are retained privately and never listed as completed resume downloads.
  for (const name of ['resume.docx', 'resume.pdf', 'validation.json']) await copyFile(resolve(working, name), resolve(folder, name), constants.COPYFILE_EXCL);
  await writeFile(resolve(folder, 'review.md'), review, { flag: 'wx' });
  return { key: key, version, track: plan.track, validation, engine: plan.engine, baseline: plan.baseline || { name: basename(plan.template), version: 'initial-template' },
    files: ['resume.docx', 'resume.pdf', 'review.md', 'validation.json'].map(name => ({ name,
      url: `/api/file?mode=live&key=${key}&version=${version}&name=${name}` })) };
}
