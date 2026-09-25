import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, readdir, realpath, stat } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve, dirname, relative, isAbsolute, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NotionStore } from './notion.mjs';
import { DemoStore } from './demo-store.mjs';
import { normalizeJob, newRecord, comparePreference, TARGET_TERMS, evaluateJob } from './core.mjs';
import { getRecord, ingest, prepare, complete, submit } from './pipeline.mjs';
import { fetchGreenhouse } from './greenhouse.mjs';
import { discover, extractFacts } from './discovery.mjs';
import { discoveryCoverage, sourceName } from './discovery-records.mjs';
import { extractDeadline, deadlineExpired } from './deadlines.mjs';
import { buildProfile, matchJob } from './matching.mjs';
import { classifyResume } from './resume-track.mjs';
import { resumeStatus, generateResume, editableResume, saveManualResume } from './resume.mjs';
import { renderPdf } from './pdf-preview.mjs';

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

export function dashboardServer({ root = projectRoot, storeOverride, discoverImpl = discover } = {}) {
  const csrf = randomBytes(32).toString('hex');
  const demo = new DemoStore();
  let busy = false;
  let search = { state: 'idle', phase: '', report: null, error: null };
  const searchFile = resolve(root, 'output', 'discovery', 'latest.json');
  const loadedSearch = readFile(searchFile, 'utf8').then(data => {
    const report = JSON.parse(data);
    if (report.finishedAt && Array.isArray(report.results)) search = { state: 'done', phase: '上次搜索结果', report, error: null };
  }).catch(() => {});
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
    const { knowledgeText } = await config();
    const profile = buildProfile(mode === 'demo' ? '' : knowledgeText);
    return records.map(record => {
      const extracted = record.indexEvidence ? extractFacts(record) : record;
      const job = { ...record, ...extractDeadline(record), durationMonths: record.durationMonths ?? extracted.durationMonths,
        inGta: extracted.inGta,
        workMode: record.workMode && record.workMode !== 'unknown' ? record.workMode : extracted.workMode };
      const evaluation = evaluateJob(job);
      if (record.fullJd === false) evaluation.reasons.unshift(record.fetchError ? `官方 JD 读取失败：${record.fetchError}` : '此来源暂不支持自动读取全文，需要补充完整 JD');
      return { ...job, ...evaluation, sourceName: sourceName(job), expired: deadlineExpired(job.deadline), match: matchJob(job, profile), resumeClassification: classifyResume(job) };
    });
  }
  async function presentSearch() {
    if (!search.report) return search;
    const results = await presentJobs(search.report.results);
    const visible = results.filter(j => !j.expired);
    return { ...search, report: { ...search.report, expiredCount: results.filter(j => j.expired).length, results: visible, coverage: discoveryCoverage(visible) } };
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
      if (req.method === 'GET' && ['/', '/app.js', '/job-view.js', '/job-facts.js', '/job-summary.js', '/style.css'].includes(url.pathname)) {
        const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        res.writeHead(200, { 'Content-Type': types[extname(file)] });
        res.end(await readFile(resolve(projectRoot, 'web', file))); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/status') {
        const { env, knowledgeReady, knowledgeText } = await config();
        const databaseId = (env.NOTION_DATABASE_ID || '').replaceAll('-', '');
        return send({ csrf, knowledgeReady, notionConfigured: Boolean(env.NOTION_TOKEN || storeOverride), root,
          resume: mode === 'demo' ? { ready: false, reason: '演示模式不使用私人简历' } : await resumeStatus(root, knowledgeText),
          notionUrl: /^[a-f0-9]{32}$/i.test(databaseId) ? `https://app.notion.com/p/${databaseId}` : 'https://www.notion.so', mode });
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
      if (req.method === 'GET' && url.pathname === '/api/discovery') { await loadedSearch; return send(await presentSearch()); }
      if (req.method === 'GET' && url.pathname === '/api/resume/files') {
        const key = url.searchParams.get('key');
        if (mode !== 'live' || !keyPattern.test(key || '')) throw fail('简历版本参数无效');
        return send({ files: (await materials('live', key)).filter(f => f.version.startsWith('resume-')) });
      }
      if (req.method === 'GET' && url.pathname === '/api/resume/edit') {
        if (mode !== 'live') throw fail('演示模式不使用私人简历');
        return send(await editableResume(root, url.searchParams.get('key'), url.searchParams.get('version')));
      }
      const match = url.pathname.match(/^\/api\/jobs\/([a-f0-9]{24})(?:\/(\w+))?$/);
      if (req.method === 'GET' && match && !match[2]) {
        const record = await getRecord(await storeFor(mode), match[1]);
        return send({ ...(await presentJobs([record], mode))[0], localFiles: await materials(mode, record.key) });
      }
      if (req.method !== 'POST') throw fail('未找到', 404);
      if (req.headers['x-csrf-token'] !== csrf) throw fail('页面已过期，请刷新重试', 403);
      if (busy) throw fail('另一个操作正在进行，请稍后再试', 409);
      busy = true; ownsLock = true;
      const body = await jsonBody(req);
      if (url.pathname === '/api/resume/edit') {
        if (mode !== 'live') throw fail('演示模式不使用私人简历');
        return send(await saveManualResume(root, body));
      }
      if (url.pathname === '/api/resume/generate') {
        if (mode !== 'live') throw fail('私人简历只能在真实工作区为选中的职位生成');
        if (!keyPattern.test(body.key || '')) throw fail('职位标识无效');
        let job;
        if (body.source === 'discovery') {
          await loadedSearch;
          if (search.state === 'running') throw fail('搜索尚未完成，请等待去重结束后操作');
          job = search.report?.results.find(x => x.key === body.key);
          if (job?.identityConflict) throw fail('岗位身份有冲突，请核对官网后手动添加');
          if (job) [job] = await presentJobs([job]);
          if (!job || !job.fullJd || evaluateJob({ ...job, ...extractDeadline(job) }).decision === 'REJECT') throw fail('请选择未排除且有完整 JD 的岗位');
        } else if (body.source === 'queue') {
          job = await getRecord(await storeFor(mode), body.key);
        } else throw fail('职位来源无效');
        const { knowledgeText } = await config();
        return send(await generateResume(root, job, knowledgeText, body.resumeTrack ?? 'auto'));
      }
      if (url.pathname === '/api/discovery') {
        await loadedSearch;
        if (mode !== 'live') throw fail('自动搜索使用真实工作区，不写入演示记录');
        if (search.state === 'running') return send(await presentSearch(), 202);
        if (search.state === 'done' && search.report.dataVersion === 4 && JSON.stringify(search.report.targetTerms) === JSON.stringify([...TARGET_TERMS]) && Date.now() - Date.parse(search.report.finishedAt) < 5 * 60 * 1000) return send({ ...(await presentSearch()), cached: true });
        search = { state: 'running', phase: '正在连接职位来源…', report: null, error: null };
        void (async () => {
          try {
            const report = await discoverImpl({ onProgress: update => { search = { state: 'running', ...update, error: null }; } });
            await mkdir(dirname(searchFile), { recursive: true });
            await writeFile(searchFile, JSON.stringify(report));
            search = { state: 'done', phase: '搜索完成', report, error: null };
          } catch (e) { search = { ...search, state: 'error', error: e.message, phase: '搜索未完成' }; }
        })();
        return send(await presentSearch(), 202);
      }
      if (url.pathname === '/api/discovery/save') {
        await loadedSearch;
        if (search.state === 'running') throw fail('搜索尚未完成，请等待去重结束后操作');
        if (mode !== 'live') throw fail('真实搜索结果只能保存到正式 Queue');
        let job = search.report?.results.find(x => x.key === body.key);
        if (job?.identityConflict) throw fail('岗位身份有冲突，请核对官网后手动添加');
        if (job) [job] = await presentJobs([job]);
        if (!job?.fullJd || evaluateJob({ ...job, ...extractDeadline(job) }).decision === 'REJECT') throw fail('此结果还不能入队，请核实筛选条件并补齐 JD');
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
      if (action === 'notes') return send(await store.updateNotes(record, text(body.notes), text(body.nextStep)));
      if (action === 'archive') {
        if (record.status !== 'Queue' || body.confirmed !== true) throw fail('仅可确认归档 Queue 中的职位');
        return send(await store.updateState({ ...record, status: '已归档', nextStep: '用户选择不投' }));
      }
      if (action === 'prepare') {
        if (deadlineExpired(extractDeadline(record).deadline)) throw fail('申请已截止，不能继续准备申请');
        const { knowledge } = await config();
        let knowledgePath = knowledge;
        if (mode === 'demo') {
          await mkdir(outputFor(mode), { recursive: true });
          knowledgePath = resolve(outputFor(mode), 'demo-knowledge.md');
          await writeFile(knowledgePath, '# 演示资料\n虚构测试学生；只用于操作演示，不可用于真实申请。');
        }
        return send(await prepare(store, key, knowledgePath, outputFor(mode), { resumeTrack: body.resumeTrack ?? 'auto' }));
      }
      if (action === 'complete') {
        if (body.checked !== true) throw fail('请先确认已检查材料的事实与排版');
        if (!['Queue', '待提交'].includes(record.status)) throw fail('该状态不允许替换材料');
        const specs = { resume: '.pdf', docx: '.docx', reviewNotes: '.md', coverLetter: '.pdf' };
        if (!body.files?.resume || !body.files.docx || !body.files.reviewNotes || (record.coverLetterRequired === true && !body.files.coverLetter)) throw fail('请提供 PDF、DOCX、修改说明，以及岗位要求的 Cover Letter');
        const buffers = {}; let total = 0;
        for (const [field, ext] of Object.entries(specs)) {
          if (!body.files[field]) continue;
          const data = Buffer.from(text(body.files[field], 28 * 1024 * 1024), 'base64');
          if (!data.length || (ext === '.pdf' && data.subarray(0, 5).toString() !== '%PDF-') || (ext === '.docx' && data.subarray(0, 2).toString() !== 'PK')) throw fail('材料格式无效');
          buffers[field] = data; total += data.length;
        }
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
        return send(await complete(store, key, paths, true));
      }
      if (action === 'submitted') return send(await submit(store, key, body.date, body.confirmed === true));
      if (action === 'progress') {
        if (!['已投递', '面试中', '已结束'].includes(record.status) || !['面试中', '已结束'].includes(body.status)) throw fail('只有投递后的申请可更新进展');
        return send(await store.updateState({ ...record, status: body.status, nextStep: text(body.nextStep) }));
      }
      throw fail('未知操作', 404);
    } catch (error) { if (!res.headersSent) send({ error: error.code === 'ENOENT' ? '文件不存在，请检查知识库或材料路径' : error.message }, error.status ?? 400); else res.end(); }
    finally { if (ownsLock) busy = false; }
  });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4317);
  dashboardServer().on('error', error => { console.error(`Dashboard 启动失败：${error.message}`); process.exitCode = 1; })
    .listen(port, '127.0.0.1', () => console.log(`Career Queue Dashboard: http://127.0.0.1:${port}`));
}
