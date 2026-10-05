import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WorkspaceStore, FILE_BYTES, SESSION_MS, fail } from './store.mjs';
import { extractResume, scoreFor } from './resume.mjs';
import { fetchCatalogue, recommend } from './catalogue.mjs';
import { renderPdf } from './pdf-preview.mjs';
import { prepareWord, generateWord, prepareWordEdit, editWord } from './generation.mjs';
import { digest } from './resume.mjs';
import { deadlineExpired, extractDeadline } from '../deadlines.mjs';
import { exportArchive, wordWorkUsage } from './data.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const assets = new Map([['/', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']], ['/application.js', ['application.js', 'text/javascript']], ['/school.js', ['school.js', 'text/javascript']], ['/style.css', ['style.css', 'text/css']]]);
const cookie = (token, age = SESSION_MS / 1000) => `cq_v2_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}`;
function tokenFrom(req) { return req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith('cq_v2_session='))?.slice('cq_v2_session='.length) ?? ''; }
async function body(req, limit) {
  if (Number(req.headers['content-length']) > limit) fail(413, '内容过大');
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) fail(413, '内容过大'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
async function jsonBody(req, limit = 16384) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') fail(415, '请求需为 JSON');
  let value;
  try { value = JSON.parse((await body(req, limit)).toString()); } catch (error) { if (error.status) throw error; fail(400, '内容格式不正确'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, '内容格式不正确');
  return value;
}
function json(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); }

export function workspaceServer({ database = resolve(root, 'private/v2-local/workspaces.sqlite'), now, extract = extractResume, discover = fetchCatalogue, preview = renderPdf, prepare = prepareWord, generate = generateWord, prepareEdit = prepareWordEdit, edit = editWord, archive = exportArchive, workUsage = wordWorkUsage } = {}) {
  const store = new WorkspaceStore(database, { now });
  let parsing = false, refreshing = false, lastRefresh = 0;
  let generating = false;
  let exporting = false;
  const scored = (owner, job) => ({ ...job, match: scoreFor(job, store.activeResume(owner)) });
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    try {
      const host = `127.0.0.1:${server.address().port}`, origin = `http://${host}`;
      if (req.headers.host !== host || (req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site') fail(403, '仅允许本机工作区访问');
      const path = new URL(req.url, origin).pathname;
      const mutation = !['GET', 'HEAD'].includes(req.method);
      if (mutation && req.headers.origin !== origin) fail(403, '请求来源不正确');
      if (req.method === 'GET' && assets.has(path)) {
        const [name, type] = assets.get(path);
        res.setHeader('Content-Type', `${type}; charset=utf-8`);
        return res.end(await readFile(resolve(root, 'web/v2', name)));
      }
      if (req.method === 'GET' && path === '/api/health') return json(res, 200, { app: 'career-queue-v2-local', stage: 'workspace-preview' });
      if (req.method === 'GET' && path === '/api/registration') return json(res, 200, { registrationOpen: store.registrationOpen() });
      if (req.method === 'POST' && ['/api/register', '/api/login'].includes(path)) {
        const account = await store.authenticate(await jsonBody(req), path === '/api/register');
        const previous = tokenFrom(req);
        if (previous) store.logout(previous);
        res.setHeader('Set-Cookie', cookie(account.token));
        return json(res, 200, { user: account.user, csrf: account.csrf, expires: account.expires });
      }
      const token = tokenFrom(req), session = store.session(token);
      if (!session) fail(401, '请重新登录');
      if (path !== '/api/session' && req.headers['x-cq-csrf'] !== session.csrf) fail(403, '页面已失效，请刷新后重试');
      const owner = session.id;
      const input = async () => {
        const value = await jsonBody(req, path.startsWith('/api/school') ? 1048576 : path.startsWith('/api/jobs') ? 262144 : 16384);
        if (!store.session(token)) fail(401, '请重新登录');
        return value;
      };
      if (req.method === 'GET' && path === '/api/session') return json(res, 200, { user: { id: owner, username: session.username, role: session.role }, csrf: session.csrf, expires: session.expires });
      if (req.method === 'POST' && path === '/api/account/password') {
        const result = await store.changePassword(token, await input());
        res.setHeader('Set-Cookie', cookie('', 0));
        return json(res, 200, result);
      }
      if (req.method === 'PUT' && path === '/api/admin/registration') return json(res, 200, store.setRegistration(owner, (await input()).registrationOpen));
      if (req.method === 'POST' && path === '/api/logout') {
        store.logout(token); res.setHeader('Set-Cookie', cookie('', 0));
        return json(res, 200, { ok: true });
      }
      if (path === '/api/preferences' && ['GET', 'PUT'].includes(req.method)) return json(res, 200, store.preferences(owner, req.method === 'PUT' ? await input() : undefined));
      if (path === '/api/data/usage' && req.method === 'GET') {
        const work = await workUsage(owner);
        if (!store.session(token)) fail(401, '请重新登录');
        return json(res, 200, { ...store.usage(owner), wordWork: { count: work, maxCount: 50 } });
      }
      if (path === '/api/data/export' && req.method === 'POST') {
        if (exporting) fail(409, '正在准备另一份导出，请稍后重试');
        exporting = true;
        try {
          const bytes = await archive(store.exportData(owner));
          if (!store.session(token)) fail(401, '会话已结束，未发送私人导出');
          res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="career-queue-personal.zip"' });
          return res.end(bytes);
        } finally { exporting = false; }
      }
      if (path === '/api/applications' && req.method === 'GET') return json(res, 200, store.applications(owner));
      if (path === '/api/school' && req.method === 'GET') return json(res, 200, store.schoolRecords(owner));
      if (path === '/api/school/history' && req.method === 'GET') return json(res, 200, { events: store.schoolHistory(owner), sources: store.schoolSubmissionSources(owner) });
      const schoolContext = path.match(/^\/api\/jobs\/([a-f0-9-]{36})\/school-context$/);
      if (schoolContext && req.method === 'GET') return json(res, 200, store.schoolContext(owner, schoolContext[1]));
      const schoolChange = path.match(/^\/api\/school\/(\d+)\/(change-preview|changes)$/);
      if (schoolChange && req.method === 'POST') return json(res, 200, schoolChange[2] === 'change-preview'
        ? store.schoolChangePreview(owner, schoolChange[1], await input()) : store.changeSchool(owner, schoolChange[1], await input()));
      if (path === '/api/school/preview' && req.method === 'POST') return json(res, 200, store.schoolPreview(owner, (await input()).text));
      if (path === '/api/school/import' && req.method === 'POST') return json(res, 200, store.importSchool(owner, await input()));
      const correction = path.match(/^\/api\/jobs\/([a-f0-9-]{36})\/submissions\/([a-f0-9-]{36})\/corrections$/);
      if (correction && req.method === 'POST') return json(res, 200, store.correctSubmission(owner, correction[1], correction[2], await input()));
      const editing = path.match(/^\/api\/jobs\/([a-f0-9-]{36})\/generation\/([a-f0-9-]{36})\/(edit-draft|edit)$/);
      if (editing && req.method === 'POST') {
        const [, id, parentId, operation] = editing, value = await input();
        const parent = store.generatedResumes(owner, id).find(row => row.id === parentId);
        if (!parent) fail(404, '未找到此岗位的生成稿');
        const context = store.materialContext(owner, id);
        if (parent.stale || !context.ready) fail(409, '岗位或当前简历已变化，请重新生成后编辑');
        if (deadlineExpired(extractDeadline(context.job).deadline, new Date(store.now()))) fail(409, 'JD 中的明确截止时间已过，不能继续准备材料');
        if (operation === 'edit' && (value.contextHash !== context.hash || value.confirmed !== true || value.openConfirmed !== true)) fail(409, '请核对修改、当前依据，并确认岗位仍开放');
        if (generating) fail(409, '另一个 Word 任务正在处理，请稍后重试');
        const file = store.file(owner, parent.docxId);
        generating = true;
        try {
          const result = operation === 'edit-draft' ? await prepareEdit(owner, context, file) : await edit(owner, context, file, value);
          if (!store.session(token)) fail(401, '请重新登录；未保存修改稿');
          if (store.materialContext(owner, id).hash !== context.hash) fail(409, '岗位或简历已变化，未保存修改稿');
          if (operation === 'edit-draft') return json(res, 200, { ...result, contextHash: context.hash, parentId });
          const fingerprint = digest(JSON.stringify({ context: context.hash, parentId, review: result.review }));
          return json(res, 200, store.saveGenerated(owner, id, context, result, fingerprint, parentId));
        } finally { generating = false; }
      }
      const word = path.match(/^\/api\/jobs\/([a-f0-9-]{36})\/(generation|generation-draft)$/);
      if (word) {
        const [, id, operation] = word;
        store.job(owner, id);
        if (operation === 'generation' && req.method === 'GET') return json(res, 200, store.generatedResumes(owner, id));
        if (req.method === 'POST') {
          const value = await input(), context = store.materialContext(owner, id);
          if (!context.ready) fail(409, '请先保存 JD 并启用自己的 Word 简历');
          if (deadlineExpired(extractDeadline(context.job).deadline, new Date(store.now()))) fail(409, 'JD 中的明确申请截止时间已过，不能继续生成');
          const file = store.file(owner, context.resume.fileId);
          if (file.format !== 'docx') fail(409, '严格版式生成需要启用同版 Word；不会沿用旧模板');
          if (generating) fail(409, '另一个简历正在生成，请稍后重试');
          if (operation === 'generation' && (value.contextHash !== context.hash || value.openConfirmed !== true)) fail(409, '请核对岗位与简历，并确认岗位仍开放');
          generating = true;
          try {
            const result = operation === 'generation-draft' ? await prepare(owner, context, file) : await generate(owner, context, file, value);
            if (!store.session(token)) fail(401, '请重新登录；未保存生成材料');
            if (store.materialContext(owner, id).hash !== context.hash) fail(409, '岗位或简历已变化，请重新准备对照');
            if (operation === 'generation-draft') return json(res, 200, { ...result, contextHash: context.hash });
            const fingerprint = digest(JSON.stringify({ context: context.hash, fingerprint: value.fingerprint, decisions: value.decisions }));
            return json(res, 200, store.saveGenerated(owner, id, context, result, fingerprint));
          } finally { generating = false; }
        }
      }
      const application = path.match(/^\/api\/jobs\/([a-f0-9-]{36})\/(application|channel|materials|submission)$/);
      if (application) {
        const [, id, operation] = application;
        if (operation === 'application' && req.method === 'GET') return json(res, 200, store.application(owner, id));
        if (operation === 'channel' && req.method === 'PUT') return json(res, 200, store.setApplicationChannel(owner, id, await input()));
        if (operation === 'materials' && req.method === 'POST') return json(res, 200, store.reviewMaterial(owner, id, await input(), session.csrf));
        if (operation === 'submission' && req.method === 'POST') return json(res, 200, store.recordSubmission(owner, id, await input()));
      }
      const pdf = path.match(/^\/api\/files\/([a-f0-9-]{36})\/preview$/);
      if (pdf && req.method === 'POST') {
        const file = store.file(owner, pdf[1]);
        if (file.format !== 'pdf') fail(400, '请选择 PDF 材料');
        if (parsing) fail(409, '正在读取另一个文件，请稍后重试');
        parsing = true;
        try {
          const result = await preview(file);
          if (!store.session(token)) fail(401, '请重新登录');
          store.markPdfViewed(owner, file.id, result.pages, session.csrf);
          return json(res, 200, { ...result, id: file.id, name: file.name, sha256: file.sha256 });
        } finally { parsing = false; }
      }
      if (path === '/api/resume' && req.method === 'GET') return json(res, 200, store.activeResume(owner));
      if (path === '/api/resume/activate' && req.method === 'POST') return json(res, 200, store.activateResume(owner, await input()));
      if (path === '/api/resume/clear' && req.method === 'POST') { store.clearResume(owner); return json(res, 200, { ok: true }); }
      const parsed = path.match(/^\/api\/files\/([a-f0-9-]{36})\/parse$/);
      if (parsed && req.method === 'POST') {
        const file = store.file(owner, parsed[1]), cached = store.parsedResume(owner, parsed[1]);
        if (cached) return json(res, 200, cached);
        if (parsing) fail(409, '另一个文件正在解析，请稍后重试');
        parsing = true;
        try {
          const result = await extract(file);
          if (!store.session(token)) fail(401, '请重新登录');
          return json(res, 200, store.saveParsed(owner, file.id, result));
        } finally { parsing = false; }
      }
      if (path === '/api/recommendations' && req.method === 'GET') {
        const data = store.catalogue(), preferences = store.preferences(owner);
        return json(res, 200, { ...data, refreshing, jobs: recommend(data.jobs, preferences, store.activeResume(owner), new Date(store.now())),
          unsupportedType: Boolean(preferences.jobTypes && !['intern', 'co-op', 'intern,co-op'].includes(preferences.jobTypes)) });
      }
      if (path === '/api/recommendations/refresh' && req.method === 'POST') {
        if (refreshing) fail(409, '公开列表正在刷新，请稍后查看');
        if (lastRefresh && store.now() - lastRefresh < 60000) fail(429, '请间隔一分钟后再刷新公开来源');
        refreshing = true; lastRefresh = store.now();
        try {
          const result = store.saveCatalogue(await discover());
          if (!store.session(token)) fail(401, '请重新登录');
          return json(res, 200, { sources: result.sources, finishedAt: result.finishedAt });
        } finally { refreshing = false; }
      }
      const suggested = path.match(/^\/api\/recommendations\/([a-f0-9]{64})\/save$/);
      if (suggested && req.method === 'POST') return json(res, 200, scored(owner, store.saveSuggested(owner, suggested[1])));
      if (path === '/api/jobs' && req.method === 'GET') return json(res, 200, store.jobs(owner).map(job => scored(owner, job)));
      if (path === '/api/jobs' && req.method === 'POST') return json(res, 201, scored(owner, store.saveJob(owner, await input())));
      const job = path.match(/^\/api\/jobs\/([a-f0-9-]{36})$/);
      if (job && req.method === 'GET') return json(res, 200, scored(owner, store.job(owner, job[1])));
      if (job && req.method === 'PUT') return json(res, 200, scored(owner, store.saveJob(owner, await input(), job[1])));
      if (path === '/api/files' && req.method === 'GET') return json(res, 200, store.files(owner));
      if (path === '/api/files' && req.method === 'POST') {
        if (req.headers['content-type'] !== 'application/octet-stream') fail(415, '请上传原始文件');
        let name;
        try { name = decodeURIComponent(req.headers['x-file-name'] ?? ''); } catch { fail(400, '文件名不正确'); }
        const bytes = await body(req, FILE_BYTES);
        // Recheck after an upload: logout or expiration may happen while reading the body.
        if (!store.session(token)) fail(401, '请重新登录');
        return json(res, 201, store.saveFile(owner, name, bytes));
      }
      const file = path.match(/^\/api\/files\/([a-f0-9-]{36})$/);
      if (file && req.method === 'GET') {
        // A tab opened by another account must not download using a replaced shared cookie.
        if (req.headers['x-cq-csrf'] !== session.csrf) fail(403, '请从当前工作区下载');
        const row = store.file(owner, file[1]);
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="document.${row.format}"; filename*=UTF-8''${encodeURIComponent(row.name)}`);
        return res.end(Buffer.from(row.bytes));
      }
      fail(404, '未找到此页面');
    } catch (error) { if (!res.headersSent) json(res, error.status ?? 500, { error: error.status ? error.message : '暂时无法保存或读取，请重试' }); else res.end(); }
  });
  server.requestTimeout = 30000;
  server.on('close', () => store.close());
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = workspaceServer();
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? '4322 端口已被占用，请检查已有本机预览' : '本机预览启动失败'); process.exitCode = 1; });
  server.listen(4322, '127.0.0.1', () => console.log('Career Queue v2 本机工作区预览：http://127.0.0.1:4322/'));
}
