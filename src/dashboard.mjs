import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, readdir, realpath, stat } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { resolve, dirname, relative, isAbsolute, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NotionStore } from './notion.mjs';
import { DemoStore } from './demo-store.mjs';
import { normalizeJob, newRecord, comparePreference, evaluateJob } from './core.mjs';
import { getRecord, ingest, prepare, complete, submit } from './pipeline.mjs';
import { fetchGreenhouse } from './greenhouse.mjs';
import { DiscoveryRunner } from './discovery-runner.mjs';
import { automationAdapter, networkAvailable } from './automation.mjs';
import { workspaceId } from './background-services.mjs';
import { discover, extractFacts, officialJob } from './discovery.mjs';
import { schoolCandidate, completeSchoolCandidate } from './school-candidates.mjs';
import { discoveryCoverage, sourceName } from './discovery-records.mjs';
import { extractDeadline, deadlineExpired } from './deadlines.mjs';
import { currentResumeProfiles } from './resume-profile.mjs';
import { selectResumeTrack } from './resume-track.mjs';
import { assessJob, assessmentSnapshot, materialFreshness, jobInputHash, availabilityState, requireAvailable } from './assessment.mjs';
import { checkAvailability } from './availability.mjs';
import { resumeStatus, prepareResumeDraft, generateResume, editableResume, saveManualResume, latestResume, validatedResume } from './resume.mjs';
import { publicReviewDraft } from './resume-review.mjs';
import { renderPdf } from './pdf-preview.mjs';
import { resumeLibrary, uploadResumeBase, activateResumeBase, readResumeBase } from './resume-bases.mjs';
import { previewPortal, linkPortal, updatePortal, portalRevision, portalSummary } from './portal.mjs';
import { parsePortalPaste } from './portal-paste.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.md': 'text/markdown; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const keyPattern = /^[a-f0-9]{24}$/;
const text = (value, max = 5000) => { if (typeof value !== 'string' || value.length > max) throw fail('文字为空或超过长度限制'); return value; };
function within(base, path) {
  const rel = relative(base, path);
  if (rel.startsWith('..') || isAbsolute(rel)) throw fail('不允许的文件路径', 403);
  return path;
}
async function jsonBody(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw fail('需要 JSON 请求', 415);
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 30 * 1024 * 1024) throw fail('上传总大小超过限制', 413); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fail('请求内容不是有效 JSON'); }
}

export function dashboardServer({ root = projectRoot, storeOverride, discoverImpl = discover, officialJobImpl = officialJob, availabilityImpl = checkAvailability, profilesImpl = currentResumeProfiles, automationImpl, clock, onlineImpl = networkAvailable } = {}) {
  const csrf = randomBytes(32).toString('hex');
  const demo = new DemoStore();
  let busy = false;
  const portalPreviews = new Map();
  const resumeDrafts = new Map();
  const runner = new DiscoveryRunner({ root, discover: discoverImpl, clock, online: onlineImpl });
  const loadedSearch = runner.ready;
  const automation = automationImpl || automationAdapter(root);
  async function config() {
    let local = {};
    try { local = parseEnv(await readFile(resolve(root, '.env'), 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const env = { ...process.env, ...local };
    const knowledge = resolve(root, env.CAREER_KNOWLEDGE_PATH || 'career_knowledge_base.md');
    let knowledgeText = '';
    try { knowledgeText = await readFile(knowledge, 'utf8'); } catch {}
    return { env, knowledge, knowledgeReady: Boolean(knowledgeText.trim()), knowledgeText };
  }
  async function presentJobs(records, mode = 'live') {
    const profiles = mode === 'demo' ? Object.fromEntries(['cs', 'data'].map(track => [track, { available: false, source: { track }, reason: '演示模式不读取私人简历' }])) : await profilesImpl(root);
    return records.map(record => {
      const extracted = record.indexEvidence ? extractFacts(record) : record;
      const job = { ...record, ...extractDeadline(record), durationMonths: record.durationMonths ?? extracted.durationMonths,
        inGta: extracted.inGta,
        workMode: record.workMode && record.workMode !== 'unknown' ? record.workMode : extracted.workMode };
      const evaluation = evaluateJob(job);
      if (record.fullJd === false) evaluation.reasons.unshift(record.schoolCandidate ? '学校列表尚无正文，请补齐官网链接与完整 JD' : record.fetchError ? `官方 JD 读取失败：${record.fetchError}` : '此来源暂不支持自动读取全文，需要补充完整 JD');
      const assessed = assessJob(job, profiles);
      const availability = availabilityState(job);
      if (availability.status === 'closed' || assessed.eligibility?.summary.hardConflict) {
        evaluation.decision = 'REJECT'; evaluation.reasons.unshift(availability.status === 'closed' ? '官方岗位已关闭或截止' : '本人已确认与必需资格冲突');
      }
      return { ...job, ...evaluation, sourceName: sourceName(job), expired: deadlineExpired(job.deadline), ...assessed, availabilityView: availability, materialFreshness: materialFreshness(record.materialVersion, assessed.assessment),
        portalRevision: portalRevision(record), portalSummary: portalSummary(record) };
    });
  }
  async function presentSearch() {
    if (!runner.search.report) return runner.search;
    const results = await presentJobs(runner.search.report.results);
    const visible = results.filter(j => !j.expired);
    return { ...runner.search, report: { ...runner.search.report, expiredCount: results.filter(j => j.expired).length, results: visible, coverage: discoveryCoverage(visible) } };
  }
  async function storeFor(mode) {
    if (mode === 'demo') return demo;
    if (storeOverride) return storeOverride;
    const { env } = await config();
    if (!env.NOTION_TOKEN) throw fail('Notion 尚未连接。请在项目 .env 填入 NOTION_TOKEN，并授权 Career Queue，然后点“重新连接”。', 503);
    const store = new NotionStore({ token: env.NOTION_TOKEN, dataSourceId: env.NOTION_DATA_SOURCE_ID });
    if (!store.dataSourceId && env.NOTION_DATABASE_ID) await store.resolveDatabase(env.NOTION_DATABASE_ID);
    await store.check();
    return store;
  }
  const outputFor = mode => resolve(root, 'output', mode === 'demo' ? 'dashboard-demo' : '');
  async function selectedJob(source, key, mode) {
    if (!keyPattern.test(key || '')) throw fail('职位标识无效');
    if (source === 'queue') return getRecord(await storeFor(mode), key);
    if (source !== 'discovery' || mode !== 'live') throw fail('职位来源无效');
    await loadedSearch;
    if (runner.search.state === 'running') throw fail('请等待搜索结束后核查');
    const job = runner.search.report?.results.find(j => j.key === key);
    if (!job || job.identityConflict) throw fail('岗位不存在或身份冲突，请重新选择');
    return job;
  }
  async function saveJobEvidence(source, before, changes, mode) {
    const current = await selectedJob(source, before.key, mode);
    if (jobInputHash(current) !== jobInputHash(before)) throw fail('JD 已变化，请重新打开详情后操作', 409);
    const next = { ...current, ...changes };
    if (source === 'queue') await (await storeFor(mode)).updateState(next);
    else {
      runner.search.report.results = runner.search.report.results.map(j => j.key === next.key ? next : j);
      await runner.saveEvidence(runner.search.report);
    }
    return next;
  }
  async function recheckJob(source, job, mode) {
    const check = mode === 'demo' ? { status: 'unknown', checkedAt: new Date().toISOString(), sourceUrl: job.url, evidence: '演示岗位，不代表真实开放状态' } : await availabilityImpl(job);
    const changes = {};
    if (check.job && check.status === 'open' && ['Queue', '待提交', undefined].includes(job.status)) {
      for (const field of ['jd', 'fullJd', 'title', 'deadline', 'deadlineEvidence', 'sourceEvidence']) if (check.job[field] != null) changes[field] = check.job[field];
    }
    const { job: freshJob, ...evidence } = check;
    changes.availability = { ...evidence, jdHash: jobInputHash({ ...job, ...changes }) };
    return saveJobEvidence(source, job, changes, mode);
  }
  async function evaluated(job, mode) { return (await presentJobs([job], mode))[0]; }
  async function snapshotFile(job, assessed, mode, prefix) {
    const folder = resolve(outputFor(mode), job.key, `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}`);
    await mkdir(folder, { recursive: true });
    const path = resolve(folder, 'assessment.json');
    await writeFile(path, JSON.stringify(assessmentSnapshot(job, assessed), null, 2), { flag: 'wx' });
    return path;
  }
  async function materials(mode, key) {
    const base = resolve(outputFor(mode), key);
    const files = [];
    let versions;
    try { versions = await readdir(base, { withFileTypes: true }); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    for (const version of versions.filter(x => x.isDirectory() && !x.isSymbolicLink())) {
      for (const file of await readdir(resolve(base, version.name), { withFileTypes: true })) {
        if (file.isFile() && types[extname(file.name)]) files.push({ name: file.name, version: version.name,
          modified: (await stat(resolve(base, version.name, file.name))).mtime.toISOString(),
          url: `/api/file?mode=${mode}&key=${key}&version=${encodeURIComponent(version.name)}&name=${encodeURIComponent(file.name)}` });
      }
    }
    return files.sort((a, b) => b.modified.localeCompare(a.modified));
  }
  async function generatedMaterial(mode, key, job) {
    if (mode !== 'live') return null;
    try { const material = await latestResume(root, key); return material && job ? { ...material, freshness: materialFreshness(material, job.assessment) } : material; }
    catch (e) { return { error: e.message }; }
  }
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const send = (value, status = 200) => { res.writeHead(status, { 'Content-Type': types['.json'] }); res.end(JSON.stringify(value)); };
    let ownsLock = false;
    try {
      const expectedHost = `127.0.0.1:${server.address().port}`;
      if (req.headers.host !== expectedHost) throw fail('请使用本机 127.0.0.1 地址', 403);
      const origin = `http://${expectedHost}`;
      if ((req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site') throw fail('不接受跨站请求', 403);
      const url = new URL(req.url, origin);
      const mode = url.searchParams.get('mode') ?? 'live';
      if (!['live', 'demo'].includes(mode)) throw fail('无效模式');
      if (req.method === 'GET' && ['/', '/app.js', '/automation-view.js', '/assessment-view.js', '/resume-review-view.js', '/discovery-sources-view.js', '/portal-import.js', '/job-view.js', '/job-facts.js', '/job-summary.js', '/job-description.js', '/style.css', '/workbench.css'].includes(url.pathname)) {
        const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        res.writeHead(200, { 'Content-Type': types[extname(file)] });
        res.end(await readFile(resolve(projectRoot, 'web', file))); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/health') {
        await loadedSearch;
        return send({ service: 'career-queue', workspaceId: workspaceId(root), ready: true });
      }
      if (req.method === 'GET' && url.pathname === '/api/automation') {
        await loadedSearch;
        if (mode !== 'live') return send({ demo: true, runs: [] });
        return send({ ...runner.info(), schedule: await automation.status() });
      }
      if (req.method === 'GET' && url.pathname === '/api/status') {
        const { env, knowledgeReady, knowledgeText } = await config();
        const databaseId = (env.NOTION_DATABASE_ID || '').replaceAll('-', '');
        return send({ csrf, knowledgeReady, notionConfigured: Boolean(env.NOTION_TOKEN || storeOverride), root,
          resume: mode === 'demo' ? { ready: false, reason: '演示模式不使用私人简历' } : await resumeStatus(root, knowledgeText),
          notionUrl: /^[a-f0-9]{32}$/i.test(databaseId) ? `https://app.notion.com/p/${databaseId}` : 'https://www.notion.so', mode });
      }
      if (req.method === 'GET' && url.pathname.startsWith('/api/resume-base')) {
        if (mode !== 'live') throw fail('演示模式不使用私人简历');
        if (url.pathname === '/api/resume-base') return send(await resumeLibrary(root));
        if (url.pathname !== '/api/resume-base/file' || url.searchParams.get('name') !== 'preview.pdf') throw fail('基准文件参数无效');
        const base = await readResumeBase(root, url.searchParams.get('version'));
        if (url.searchParams.get('render') === '1') return send(await renderPdf(root, base.pdf, Number(url.searchParams.get('page') || 1)));
        res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'self'");
        res.writeHead(200, { 'Content-Type': types['.pdf'], 'Content-Disposition': 'inline; filename="baseline.pdf"' });
        res.end(await readFile(base.pdf)); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/file') {
        const key = url.searchParams.get('key'), version = url.searchParams.get('version'), name = url.searchParams.get('name');
        if (!keyPattern.test(key ?? '') || !version || basename(version) !== version || !name || basename(name) !== name || !types[extname(name)]) throw fail('文件参数无效');
        const base = await realpath(outputFor(mode));
        const jobBase = within(base, await realpath(resolve(base, key)));
        const path = within(jobBase, await realpath(resolve(jobBase, version, name)));
        if (url.searchParams.get('render') === '1') {
          if (extname(name) !== '.pdf') throw fail('仅支持 PDF 在线预览');
          return send(await renderPdf(root, path, Number(url.searchParams.get('page') || 1)));
        }
        const preview = url.searchParams.get('preview') === '1';
        if (preview && extname(name) !== '.pdf') throw fail('仅支持 PDF 在线预览');
        if (preview) res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'self'");
        res.writeHead(200, { 'Content-Type': types[extname(name)], 'Content-Disposition': `${preview ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}` });
        res.end(await readFile(path)); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/jobs') {
        const store = await storeFor(mode);
        const records = await presentJobs(await store.list(), mode);
        return send({ jobs: records.filter(x => x.status !== '已归档' && !(x.status === 'Queue' && x.expired)).sort(comparePreference) });
      }
      if (req.method === 'GET' && url.pathname === '/api/portal') {
        const records = await (await storeFor(mode)).list();
        return send({ jobs: records.map(j => ({ key: j.key, company: j.company, title: j.title, location: j.location, term: j.term,
          status: j.status, applicationDate: j.applicationDate, portal: j.portal || null, summary: portalSummary(j) })) });
      }
      if (req.method === 'GET' && url.pathname === '/api/discovery') { await loadedSearch; return send(await presentSearch()); }
      if (req.method === 'GET' && url.pathname === '/api/assessment') {
        return send(await evaluated(await selectedJob(url.searchParams.get('source'), url.searchParams.get('key'), mode), mode));
      }
      if (req.method === 'GET' && url.pathname === '/api/resume/files') {
        const key = url.searchParams.get('key');
        if (mode !== 'live' || !keyPattern.test(key || '')) throw fail('简历版本参数无效');
        await loadedSearch;
        const source = url.searchParams.get('source');
        let record = source === 'discovery' ? runner.search.report?.results.find(j => j.key === key) : null;
        if (!record) {
          const { env } = await config();
          if (storeOverride || env.NOTION_TOKEN) record = await (await storeFor(mode)).find(key);
          record ||= runner.search.report?.results.find(j => j.key === key);
        }
        const job = record && (await presentJobs([record], mode))[0];
        return send({ files: (await materials('live', key)).filter(f => f.version.startsWith('resume-')), assessment: job?.assessment, generatedMaterial: await generatedMaterial(mode, key, job) });
      }
      if (req.method === 'GET' && url.pathname === '/api/resume/review') {
        if (mode !== 'live') throw fail('演示模式不使用私人简历');
        const checked = await validatedResume(root, url.searchParams.get('key'), url.searchParams.get('version'));
        return send({ version: checked.version, review: checked.provenance.review || null });
      }
      if (req.method === 'GET' && url.pathname === '/api/resume/edit') {
        if (mode !== 'live') throw fail('演示模式不使用私人简历');
        return send(await editableResume(root, url.searchParams.get('key'), url.searchParams.get('version')));
      }
      const match = url.pathname.match(/^\/api\/jobs\/([a-f0-9]{24})(?:\/([\w-]+))?$/);
      if (req.method === 'GET' && match && !match[2]) {
        const record = await getRecord(await storeFor(mode), match[1]);
        const job = (await presentJobs([record], mode))[0];
        return send({ ...job, localFiles: await materials(mode, record.key), generatedMaterial: await generatedMaterial(mode, record.key, job) });
      }
      if (req.method !== 'POST') throw fail('未找到', 404);
      if (req.headers['x-csrf-token'] !== csrf) throw fail('页面已过期，请刷新重试', 403);
      if (busy) throw Object.assign(fail('另一个操作正在进行，请稍后再试', 409), { code: 'OPERATION_BUSY' });
      busy = true; ownsLock = true;
      const body = await jsonBody(req);
      if (url.pathname === '/api/assessment/recheck' || url.pathname === '/api/assessment/confirm' || url.pathname === '/api/assessment/eligibility') {
        let job = await selectedJob(body.source, body.key, mode);
        if (url.pathname.endsWith('/recheck')) job = await recheckJob(body.source, job, mode);
        else {
          const assessed = await evaluated(job, mode);
          if (body.assessmentId !== assessed.assessment.id) throw fail('简历或 JD 已变化，请重新核对', 409);
          if (body.confirmed !== true) throw fail('需要本人明确核实后确认');
          if (url.pathname.endsWith('/confirm')) {
            const state = availabilityState(job);
            if (!state.recent || state.status !== 'unknown' || body.checkedAt !== state.checkedAt) throw fail('请先重新核查；明确关闭的岗位不能人工改为开放');
            const note = text(body.note, 1000).trim(); if (!note) throw fail('请简述在官网确认仍开放的依据');
            job = await saveJobEvidence(body.source, job, { availability: { ...job.availability,
              manual: { checkedAt: state.checkedAt, jdHash: jobInputHash(job), confirmedAt: new Date().toISOString(), note } } }, mode);
          } else {
            const requirement = assessed.eligibility?.requirements.find(r => r.id === body.requirementId);
            if (!requirement || !['met', 'conflict', 'unknown'].includes(body.outcome)) throw fail('请选择当前 JD 中的条件及核实结果');
            const note = text(body.note, 1000).trim(); if (!note) throw fail('请填写本人核实依据，不从旧知识库推断');
            const confirmations = [...(job.eligibilityConfirmations || [])].filter(c => !(c.jdHash === jobInputHash(job) && c.requirementId === requirement.id));
            if (confirmations.length >= 40) throw fail('核实历史已达本版上限，请保留历史并联系维护');
            confirmations.push({ requirementId: requirement.id, outcome: body.outcome, note, jdHash: jobInputHash(job), confirmedAt: new Date().toISOString() });
            job = await saveJobEvidence(body.source, job, { eligibilityConfirmations: confirmations }, mode);
          }
        }
        return send(await evaluated(job, mode));
      }
      if (url.pathname === '/api/portal/parse') return send(parsePortalPaste(body.text));
      if (url.pathname === '/api/portal/preview') {
        const records = await (await storeFor(mode)).list();
        const rows = previewPortal(body.rows, records), token = randomUUID();
        for (const [key, entry] of portalPreviews) if (Date.now() - entry.at > 600000) portalPreviews.delete(key);
        if (portalPreviews.size >= 5) portalPreviews.delete(portalPreviews.keys().next().value);
        portalPreviews.set(token, { mode, at: Date.now(), rows, revisions: new Map(records.map(j => [j.key, portalRevision(j)])) });
        return send({ token, rows, jobs: records.map(j => ({ key: j.key, title: j.title, company: j.company, term: j.term, status: j.status, externalSubmitted: portalSummary(j).externalSubmitted, linkedId: j.portal?.id || null })) });
      }
      if (url.pathname === '/api/portal/link') {
        const preview = portalPreviews.get(body.token);
        if (!preview || preview.mode !== mode || Date.now() - preview.at > 600000) throw fail('预览已过期，请重新匹配');
        if (body.confirmed !== true || !Array.isArray(body.selections) || !body.selections.length || body.selections.length > 100) throw fail('请勾选并核对需要保存的关联');
        const store = await storeFor(mode), records = await store.list();
        const keys = new Set(), ids = new Set();
        const plan = body.selections.map(selection => {
          if (selection.key === '__new__') {
            const item = preview.rows[selection.index];
            if (!Number.isInteger(selection.index) || item?.category !== 'unmatched' || ids.has(item.row.id)) throw fail('只能将本次未匹配的学校岗位保存为新候选');
            ids.add(item.row.id);
            return { record: schoolCandidate(item.row, records), create: true, row: item.row };
          }
          const item = preview.rows[selection.index], record = records.find(j => j.key === selection.key);
          if (!Number.isInteger(selection.index) || !item?.row || !record) throw fail('选择的学校岗位或申请不存在，请重新预览');
          if (keys.has(record.key) || ids.has(item.row.id)) throw fail('同一申请或学校职位本次只能关联一次');
          keys.add(record.key); ids.add(item.row.id);
          if (preview.revisions.get(record.key) !== portalRevision(record)) throw fail('申请记录已变化，请重新预览');
          return { record, next: linkPortal(record, item.row, records, { confirmed: true }) };
        });
        portalPreviews.delete(body.token);
        const saved = [], errors = [];
        for (const { record, next, create, row } of plan) {
          try {
            const fresh = await store.list();
            if (create) {
              const candidate = schoolCandidate(row, fresh);
              if (!fresh.some(j => j.key === candidate.key)) await store.create(candidate);
              saved.push(candidate.key); continue;
            }
            const current = fresh.find(j => j.key === record.key);
            if (!current || portalRevision(current) !== portalRevision(record)) throw fail('申请记录已变化，请重新预览');
            linkPortal(current, next.portal, fresh, { confirmed: true });
            if (portalRevision(next) !== portalRevision(record)) await store.updateState({ ...current, portal: next.portal, portalHistory: next.portalHistory });
            saved.push(record.key);
          } catch (e) { errors.push({ key: record.key, error: e.message }); break; }
        }
        return send({ saved, errors, remaining: plan.length - saved.length, message: errors.length ? '部分记录未完成；已保存结果保留，请重新预览后继续' : '候选可在待处理职位中查看；学校提交要求请在详情确认' });
      }
      if (url.pathname === '/api/resume-base' || url.pathname === '/api/resume-base/activate') {
        if (mode !== 'live') throw fail('演示模式不使用私人简历');
        return send(url.pathname.endsWith('/activate') ? await activateResumeBase(root, body.version) : await uploadResumeBase(root, body));
      }
      if (url.pathname === '/api/resume/edit') {
        if (mode !== 'live') throw fail('演示模式不使用私人简历');
        return send(await saveManualResume(root, body));
      }
      if (['/api/resume/generate', '/api/resume/proposal'].includes(url.pathname)) {
        if (mode !== 'live') throw fail('私人简历只能在真实工作区为选中的职位生成');
        if (!keyPattern.test(body.key || '')) throw fail('职位标识无效');
        let job;
        if (body.source === 'discovery') {
          await loadedSearch;
          if (runner.search.state === 'running') throw fail('搜索尚未完成，请等待去重结束后操作');
          job = runner.search.report?.results.find(x => x.key === body.key);
          if (job?.identityConflict) throw fail('岗位身份有冲突，请核对官网后手动添加');
          if (job) [job] = await presentJobs([job]);
          if (!job || !job.fullJd || evaluateJob({ ...job, ...extractDeadline(job) }).decision === 'REJECT') throw fail('请选择未排除且有完整 JD 的岗位');
        } else if (body.source === 'queue') {
          job = await getRecord(await storeFor(mode), body.key);
        } else throw fail('职位来源无效');
        // Check only the selected official posting. A failed read requires a separate human confirmation.
        job = await selectedJob(body.source, body.key, mode);
        if (!availabilityState(job).recent) job = await recheckJob(body.source, job, mode);
        requireAvailable(job);
        const assessed = await evaluated(job, mode);
        if (assessed.eligibility?.summary.hardConflict) throw fail('本人已确认与岗位必需条件冲突，不能生成');
        if (body.assessmentId !== assessed.assessment.id) throw fail('简历或官方 JD 已变化，请重新打开详情核对后生成', 409);
        if (url.pathname === '/api/resume/proposal') {
          for (const [id, d] of resumeDrafts) if (d.expiresAt < Date.now()) resumeDrafts.delete(id);
          if (resumeDrafts.size >= 20) resumeDrafts.delete(resumeDrafts.keys().next().value);
          const draft = await prepareResumeDraft(root, job, body.resumeTrack ?? 'auto', assessmentSnapshot(job, assessed));
          const id = randomUUID(), expiresAt = Date.now() + 20 * 60 * 1000;
          resumeDrafts.set(id, { draft, key: job.key, source: body.source, expiresAt });
          return send({ ...publicReviewDraft(draft), id, expiresAt });
        }
        const saved = resumeDrafts.get(body.proposalId);
        if (!saved || saved.expiresAt < Date.now() || saved.key !== job.key || saved.source !== body.source || body.resumeTrack !== saved.draft.track) throw fail('修改对照已失效或不属于当前岗位，请重新准备', 409);
        const result = await generateResume(root, job, '', saved.draft.track, assessmentSnapshot(job, assessed),
          { draft: saved.draft, confirmed: body.confirmed, decisions: body.decisions });
        resumeDrafts.delete(body.proposalId);
        return send(result);
      }
      if (url.pathname.startsWith('/api/automation')) {
        if (mode !== 'live') throw fail('演示模式不操作真实日程');
        if (url.pathname === '/api/automation/enabled') {
          if (typeof body.enabled !== 'boolean') throw fail('日程开关无效');
          return send(await automation.setEnabled(body.enabled));
        }
        if (url.pathname === '/api/automation/tick') {
          const schedule = await automation.status();
          if (!schedule.connected || !schedule.enabled) return send({ skipped: true, reason: '日程未启用或无法核实' });
          return send(await runner.start('scheduled'));
        }
        throw fail('未知日程操作', 404);
      }
      if (url.pathname === '/api/discovery') {
        if (mode !== 'live') throw fail('自动搜索使用真实工作区，不写入演示记录');
        const result = await runner.start('manual');
        return send({ ...(await presentSearch()), ...result }, result.running ? 202 : 200);
      }
      if (url.pathname === '/api/discovery/save') {
        await loadedSearch;
        if (runner.search.state === 'running') throw fail('搜索尚未完成，请等待去重结束后操作');
        if (mode !== 'live') throw fail('真实搜索结果只能保存到正式 Queue');
        let job = runner.search.report?.results.find(x => x.key === body.key);
        if (job?.identityConflict) throw fail('岗位身份有冲突，请核对官网后手动添加');
        if (job) [job] = await presentJobs([job]);
        if (!job?.fullJd || job.decision === 'REJECT') throw fail('此结果还不能入队，请核实筛选条件并补齐 JD');
        if (deadlineExpired(extractDeadline(job).deadline)) throw fail('申请已截止，不能加入 Queue');
        return send(await ingest(await storeFor('live'), [job]));
      }
      if (url.pathname === '/api/fetch') return send(await fetchGreenhouse(text(body.url), text(body.company, 200)));
      if (url.pathname === '/api/preview') return send(newRecord(normalizeJob(body.job)));
      if (url.pathname === '/api/ingest') {
        if (!Array.isArray(body.jobs) || body.jobs.length > 50) throw fail('每次最多导入 50 个职位');
        return send(await ingest(await storeFor(mode), body.jobs));
      }
      if (!match || !match[2]) throw fail('未找到', 404);
      const store = await storeFor(mode), key = match[1], action = match[2];
      const record = await getRecord(store, key);
      if (action === 'school-details') {
        if (body.confirmed !== true) throw fail('请确认官网链接与 JD 对应当前学校岗位');
        if (body.revision !== portalRevision(record) || body.jdHash !== jobInputHash(record)) throw fail('岗位已变化，请重新打开后补齐', 409);
        const url = text(body.url, 2000), jd = text(body.jd || '', 100000).trim();
        const details = jd ? { url, jd } : await officialJobImpl({ url, company: record.company, title: record.title, location: record.location, term: record.term });
        if (!details?.jd?.trim()) throw fail('此链接暂不支持读取，请粘贴官网完整 JD 后保存');
        const current = await getRecord(store, key);
        if (portalRevision(current) !== body.revision || jobInputHash(current) !== body.jdHash) throw fail('读取期间岗位已变化，请重新打开', 409);
        return send(await store.updateJob(completeSchoolCandidate(current, details, await store.list())));
      }
      if (['prepare', 'complete'].includes(action) && record.fullJd === false) throw fail('请先补齐完整 JD，再准备材料');
      if (action === 'portal') {
        if (body.revision !== portalRevision(record)) throw fail('申请记录已变化，请重新打开详情后操作', 409);
        const next = body.action === 'link' ? linkPortal(record, body.row, await store.list(), body) : updatePortal(record, body);
        if (portalRevision(next) === portalRevision(record)) return send(record);
        return send(await store.updateState(next));
      }
      if (action === 'notes') return send(await store.updateNotes(record, text(body.notes), text(body.nextStep)));
      if (action === 'archive') {
        if (record.status !== 'Queue' || body.confirmed !== true) throw fail('仅可确认归档 Queue 中的职位');
        return send(await store.updateState({ ...record, status: '已归档', nextStep: '用户选择不投' }));
      }
      if (action === 'prepare') {
        if (deadlineExpired(extractDeadline(record).deadline)) throw fail('申请已截止，不能继续准备申请');
        const checked = mode === 'demo' || availabilityState(record).recent ? record : await recheckJob('queue', record, mode);
        if (mode === 'live') requireAvailable(checked);
        const assessed = mode === 'demo' ? await evaluated(checked, mode) : assessJob(checked, await profilesImpl(root), new Date(), selectResumeTrack(checked, body.resumeTrack ?? 'auto').track);
        if (assessed.eligibility?.summary.hardConflict) throw fail('本人已确认与必需条件冲突，不能准备材料');
        const { knowledge } = await config();
        let knowledgePath = knowledge;
        if (mode === 'demo') {
          await mkdir(outputFor(mode), { recursive: true });
          knowledgePath = resolve(outputFor(mode), 'demo-knowledge.md');
          await writeFile(knowledgePath, '# 演示资料\n虚构测试学生；只用于操作演示，不可用于真实申请。');
        }
        return send(await prepare(store, key, knowledgePath, outputFor(mode), { resumeTrack: body.resumeTrack ?? 'auto', evaluationSnapshot: assessmentSnapshot(checked, assessed) }));
      }
      if (action === 'complete') {
        if (body.checked !== true) throw fail('请先确认已检查材料的事实与排版');
        if (!['Queue', '待提交'].includes(record.status)) throw fail('该状态不允许替换材料');
        const assessed = await evaluated(record, mode);
        if (mode === 'live' && body.assessmentId !== assessed.assessment.id) throw fail('简历或 JD 已变化，请重新预览材料后确认', 409);
        const specs = { resume: '.pdf', docx: '.docx', reviewNotes: '.md', coverLetter: '.pdf' };
        let generated;
        if (body.generatedVersion) {
          if (mode !== 'live' || body.files?.resume) throw fail('请选择生成版本或本机上传，不要同时提供两份简历');
          generated = await validatedResume(root, key, body.generatedVersion);
          if (body.resumeHash !== generated.validation.pdfSha256) throw fail('材料已变化，请重新预览并确认');
          if (materialFreshness(generated.provenance, assessed.assessment).needsReview && body.staleReviewed !== true) throw fail('这份材料基于旧版或未记录的输入；请重新生成，或明确重新审阅后继续');
        }
        if ((!generated && !body.files?.resume) || (record.coverLetterRequired === true && !body.files?.coverLetter)) throw fail('请提供简历 PDF，以及岗位要求的 Cover Letter');
        const buffers = {}; let total = 0;
        for (const [field, ext] of Object.entries(specs)) {
          if (!body.files?.[field]) continue;
          const data = Buffer.from(text(body.files[field], 28 * 1024 * 1024), 'base64');
          if (!data.length || (ext === '.pdf' && data.subarray(0, 5).toString() !== '%PDF-') || (ext === '.docx' && data.subarray(0, 2).toString() !== 'PK')) throw fail('材料格式无效');
          buffers[field] = data; total += data.length;
        }
        if (generated) { buffers.resume = await readFile(generated.pdf); total += buffers.resume.length; }
        if (total > 20 * 1024 * 1024) throw fail('材料总大小不得超过 20MB');
        const folder = resolve(outputFor(mode), key, `materials-${Date.now()}-${randomUUID().slice(0, 8)}`);
        await mkdir(folder, { recursive: true });
        const paths = {};
        const stem = `${record.company}-${record.title}`.replace(/[^\p{L}\p{N}-]/gu, '_').slice(0, 32);
        const version = new Date().toISOString().replace(/\D/g, '').slice(0, 17);
        const labels = { resume: 'resume', docx: 'resume', reviewNotes: 'review', coverLetter: 'cover-letter' };
        for (const [field, data] of Object.entries(buffers)) {
          paths[field] = resolve(folder, `${stem}-${key.slice(0, 6)}-${version}-${labels[field]}${specs[field]}`);
          await writeFile(paths[field], data, { flag: 'wx' });
        }
        const snapshotPath = resolve(folder, 'assessment.json');
        await writeFile(snapshotPath, JSON.stringify(assessmentSnapshot(record, assessed), null, 2), { flag: 'wx' });
        return send(await complete(store, key, paths, true, {
          version: generated?.version || basename(folder), sha256: createHash('sha256').update(buffers.resume).digest('hex'),
          baseline: generated?.provenance.baseline || null, assessment: assessed.assessment, snapshotPath,
          generatedAssessment: generated?.provenance.assessment || null, staleReviewed: body.staleReviewed === true,
          reviewedAt: new Date().toISOString() }));
      }
      if (action === 'submitted') {
        const assessed = await evaluated(record, mode);
        if (mode === 'live' && body.assessmentId !== assessed.assessment.id) throw fail('当前输入已变化，请重新核对实际投递的材料', 409);
        if (mode === 'live' && materialFreshness(record.materialVersion, assessed.assessment).needsReview && body.staleReviewed !== true) throw fail('已确认材料与当前输入版本不同，请核对实际使用的 PDF 后确认');
        // Record an already completed application even if the posting closed afterwards.
        const context = { assessment: assessed.assessment, snapshotPath: await snapshotFile(record, assessed, mode, 'submission'), staleReviewed: body.staleReviewed === true };
        return send(await submit(store, key, body.date, body.confirmed === true, new Date(), body.receipt ?? '', context));
      }
      if (action === 'progress') {
        if (!['已投递', '面试中', '已结束'].includes(record.status) || !['面试中', '已结束'].includes(body.status)) throw fail('只有投递后的申请可更新进展');
        return send(await store.updateState({ ...record, status: body.status, nextStep: text(body.nextStep) }));
      }
      throw fail('未知操作', 404);
    } catch (error) { if (!res.headersSent) send({ error: error.code === 'ENOENT' ? '文件不存在，请检查知识库或材料路径' : error.message,
      ...(error.code === 'OPERATION_BUSY' ? { code: error.code } : {}) }, error.status ?? 400); else res.end(); }
    finally { if (ownsLock) busy = false; }
  });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4317);
  dashboardServer().on('error', error => { console.error(`Dashboard 启动失败：${error.message}`); process.exitCode = 1; })
    .listen(port, '127.0.0.1', () => console.log(`Career Queue Dashboard: http://127.0.0.1:${port}`));
}
