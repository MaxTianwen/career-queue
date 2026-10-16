import {EmailAccounts} from './email-accounts.mjs';
import {schoolCapture} from './school-capture.mjs';
import { browserFillBridge } from './browser-fill.mjs';
import { rehearsalFields } from './fill-rehearsal.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WorkspaceStore, FILE_BYTES, SESSION_MS, fail } from './store.mjs';
import { extractResume, extractDocumentText, scoreFor, resumeProfile } from './resume.mjs';
import { fetchCatalogue, recommend } from './catalogue.mjs';
import { renderPdf } from './pdf-preview.mjs';
import { prepareWord, generateWord, prepareWordEdit, editWord } from './generation.mjs';
import { digest } from './resume.mjs';
import { deadlineExpired, extractDeadline } from '../deadlines.mjs';
import { availabilityGate } from './availability.mjs';
import { workspaceId } from '../background-services.mjs';
import { CatalogueRunner } from './discovery-runner.mjs';
import { networkAvailable } from '../automation.mjs';
import { readGreenhouseForm } from './greenhouse-form.mjs';
import { timingSafeEqual } from 'node:crypto';
import { exportArchive, wordWorkUsage } from './data.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const assets = new Map([['/file-preview.js',['file-preview.js','text/javascript']],['/application-table.js',['application-table.js','text/javascript']],['/files.js',['files.js','text/javascript']],['/src/publication-facts.mjs',['../../src/publication-facts.mjs','text/javascript']],['/src/deadlines.mjs',['../../src/deadlines.mjs','text/javascript']],['/editorial.css',['editorial.css','text/css']],['/school-capture-ui.js',['school-capture-ui.js','text/javascript']],['/src/job-category.mjs',['../../src/job-category.mjs','text/javascript']],['/src/job-country.mjs',['../../src/job-country.mjs','text/javascript']],['/src/internship-options.mjs',['../../src/internship-options.mjs','text/javascript']],['/page-stability.js',['page-stability.js','text/javascript']],['/src/duration-facts.mjs',['../../src/duration-facts.mjs','text/javascript']],['/requirements.js', ['requirements.js','text/javascript']], ['/opportunity-view.js', ['opportunity-view.js','text/javascript']], ['/refresh-controller.js',['refresh-controller.js','text/javascript']],['/src/resume-track.mjs', ['../../src/resume-track.mjs', 'text/javascript']], ['/opportunity.js', ['opportunity.js', 'text/javascript']],['/question-diff.js', ['question-diff.js', 'text/javascript']], ['/', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']], ['/application.js', ['application.js', 'text/javascript']], ['/school.js', ['school.js', 'text/javascript']], ['/style.css', ['style.css', 'text/css']]]);
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

export function workspaceServer({ database = resolve(root, 'private/v2-local/workspaces.sqlite'), now, extract = extractResume, discover = fetchCatalogue, preview = renderPdf, documentText = extractDocumentText, prepare = prepareWord, generate = generateWord, prepareEdit = prepareWordEdit, edit = editWord, archive = exportArchive, workUsage = wordWorkUsage, availability, applicationForm = readGreenhouseForm, automationToken = null, online = networkAvailable, mailTransport = null, legacyRegistration = false, httpServer = null } = {}) {
  const store = new WorkspaceStore(database, { now });
  try {
  const emailAccounts = new EmailAccounts(store, mailTransport);
  const bridge = browserFillBridge(store);
  const gate = availabilityGate(store, availability);
  const runner = new CatalogueRunner(store, { discover:discover===fetchCatalogue?()=>fetchCatalogue({cachedJobs:store.catalogue().jobs}):discover, online, configured: typeof automationToken === 'string' && /^[a-f0-9]{64}$/.test(automationToken) });
  let parsing = false;
  let generating = false;
  let exporting = false;
  const scored = (owner, job, resume=store.activeResume(owner), profile=resumeProfile(resume)) => ({ ...job, eligibilityExclusion:store.citizenExclusion(owner,job), match: scoreFor(job, resume, profile) });
  const server = httpServer ?? createServer();
  server.on('request', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    try {
      const host = `127.0.0.1:${server.address().port}`, origin = `http://${host}`;
      const path = new URL(req.url, origin).pathname;
      const bridgePath = /^\/api\/browser-fill\/(preview|confirm)$/.test(path);
      const extensionOrigin = /^chrome-extension:\/\/[a-p]{32}$/.test(req.headers.origin ?? '');
      const extensionRequest = bridgePath && extensionOrigin && ['POST','OPTIONS'].includes(req.method);
      if (extensionRequest) { res.setHeader('Access-Control-Allow-Origin',req.headers.origin); res.setHeader('Vary','Origin'); res.setHeader('Access-Control-Allow-Methods','POST'); res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization'); }
      if (req.headers.host !== host || (!extensionRequest && ((req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site'))) fail(403, '仅允许本机工作区访问');
      if (extensionRequest && req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
      const mutation = !['GET', 'HEAD'].includes(req.method);
      if (mutation && !extensionRequest && req.headers.origin !== origin) fail(403, '请求来源不正确');
      if (req.method === 'GET' && assets.has(path)) {
        const [name, type] = assets.get(path);
        res.setHeader('Content-Type', `${type}; charset=utf-8`);
        return res.end(await readFile(resolve(root, 'web/v2', name)));
      }
      if (req.method === 'GET' && path === '/api/health') return json(res, 200, { app: 'career-queue-v2-local', stage: 'workspace-preview', workspaceId: workspaceId(root), ready: true });
      if (req.method === 'GET' && path === '/api/registration') return json(res, 200, { registrationOpen: store.registrationOpen(), securityVersion: 1, emailVerification: !legacyRegistration, emailReady: emailAccounts.ready });
      const emailRoutes = {'/api/email/resend':'resend','/api/email/verify':'verify','/api/password/request':'request','/api/password/reset':'reset'};
      if(req.method==='POST' && (emailRoutes[path] || (path==='/api/register'&&!legacyRegistration))) {
        const input=await jsonBody(req),source=req.socket.remoteAddress||'unknown',kind=emailRoutes[path];
        const result=kind==='verify'||kind==='reset'?await emailAccounts.complete(input,kind,source):kind==='request'?emailAccounts.requestReset(input,source):emailAccounts.requestVerification(input,source,kind==='resend');
        return json(res,kind==='verify'||kind==='reset'?200:202,result);
      }
      if (req.method === 'POST' && ['/api/register', '/api/login'].includes(path)) {
        const account = await store.authenticate(await jsonBody(req), path === '/api/register', req.socket.remoteAddress || 'unknown');
        const previous = tokenFrom(req);
        if (previous) store.logout(previous);
        res.setHeader('Set-Cookie', cookie(account.token));
        return json(res, 200, { user: account.user, csrf: account.csrf, expires: account.expires });
      }
      if (path === '/api/discovery/tick' && req.method === 'POST') {
        const supplied = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
        if (!runner.configured || !/^[a-f0-9]{64}$/.test(supplied) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(automationToken))) fail(403, '后台入口认证失败');
        await jsonBody(req);
        const result = await runner.start('scheduled');
        return json(res, 200, { skipped: result.skipped, waiting: result.waiting, finishedAt: result.finishedAt });
      }
      if (bridgePath && req.method === 'POST') {
        if (!extensionRequest) fail(403,'仅支持本机浏览器扩展连接');
        const value=await jsonBody(req), code=req.headers.authorization?.replace(/^Bearer /,'');
        return json(res,200,bridge.use(code,value,path.endsWith('/confirm')));
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
      if(['/api/admin/invitations','/api/admin/accounts','/api/admin/security-events'].includes(path)||/^\/api\/admin\/(?:invitations\/[a-f0-9-]{36}\/revoke|accounts\/[a-f0-9-]{36}\/status)$/.test(path)) {
        store.security.admin(owner);
        if(mutation)store.security.resource(owner,'admin');
        if(path==='/api/admin/invitations'&&req.method==='GET')return json(res,200,store.security.invitations(owner));
        if(path==='/api/admin/invitations'&&req.method==='POST')return json(res,201,store.security.issue(owner,await input()));
        if(path==='/api/admin/accounts'&&req.method==='GET')return json(res,200,store.security.users(owner));
        if(path==='/api/admin/security-events'&&req.method==='GET')return json(res,200,store.security.events(owner));
        const invitation=path.match(/^\/api\/admin\/invitations\/([a-f0-9-]{36})\/revoke$/);
        if(invitation&&req.method==='POST')return json(res,200,store.security.revoke(owner,invitation[1],await input()));
        const status=path.match(/^\/api\/admin\/accounts\/([a-f0-9-]{36})\/status$/);
        if(status&&req.method==='PUT')return json(res,200,store.security.status(owner,status[1],await input()));
      }
      if(mutation){
        const kind=path==='/api/files'?'upload':/\/parse$/.test(path)?'parse':/\/(?:(?:history-)?preview|view)$/.test(path)&&path.startsWith('/api/files/')?'preview':/\/(?:generation(?:-draft)?|edit|edit-draft)$/.test(path)?'generation':path==='/api/data/export'?'export':/^\/api\/recommendations\/(update|refresh)$/.test(path)?'refresh':null;
        if(kind)store.security.resource(owner,kind);
      }
      if (req.method === 'POST' && path === '/api/logout') {
        store.logout(token); res.setHeader('Set-Cookie', cookie('', 0));
        return json(res, 200, { ok: true });
      }
      if (path === '/api/preferences' && ['GET', 'PUT'].includes(req.method)) return json(res, 200, store.preferences(owner, req.method === 'PUT' ? await input() : undefined));
      if (path === '/api/data/migrations' && req.method === 'GET') return json(res, 200, store.migrationReceipts(owner));
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
      if (['/api/school/capture-preview','/api/school/capture-import'].includes(path) && req.method === 'POST') return json(res,200,schoolCapture(store,owner,await input(),path.endsWith('capture-import')));
      if (path === '/api/school/opportunities' && req.method === 'GET') return json(res,200,store.pendingSchoolOpportunities(owner));
      if (path === '/api/school/opportunities' && req.method === 'POST') return json(res,200,store.confirmSchoolOpportunities(owner,await input()));
      if (path === '/api/school/opportunities/start' && req.method === 'POST') { const value=await input(); return json(res,200,store.startSchoolOpportunity(owner,value.schoolId,value.fingerprint)); }
      if (path === '/api/school' && req.method === 'GET') return json(res, 200, store.schoolRecords(owner).map(row=>({...row,eligibilityExclusion:store.citizenExclusion(owner,{...row.row,schoolId:row.schoolId})})));
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
      const availabilityPath = path.match(/^\/api\/jobs\/([a-f0-9-]{36})\/availability$/);
      if (availabilityPath && req.method === 'POST') {
        await input();
        const result = await gate.refresh(owner, availabilityPath[1], session.csrf);
        if (!store.session(token)) fail(401, '请重新登录');
        return json(res, 200, result);
      }
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
        const checked = operation === 'edit-draft' ? await gate.refresh(owner, id, session.csrf) : (gate.require(owner, id, session.csrf, value), value.availability);
        if (checked.status === 'closed') fail(409, `岗位已关闭：${checked.evidence}`);
        if (!store.session(token)) fail(401, '请重新登录');
        const file = store.file(owner, parent.docxId);
        if (generating) fail(409, '另一个 Word 任务正在处理，请稍后重试');
        generating = true;
        try {
          const result = operation === 'edit-draft' ? await prepareEdit(owner, context, file) : await edit(owner, context, file, value);
          if (!store.session(token)) fail(401, '请重新登录；未保存修改稿');
          if (store.materialContext(owner, id).hash !== context.hash) fail(409, '岗位或简历已变化，未保存修改稿');
          if (operation === 'edit-draft') return json(res, 200, { ...result, contextHash: context.hash, parentId, availability: checked });
          gate.require(owner, id, session.csrf, value);
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
          const checked = operation === 'generation-draft' ? await gate.refresh(owner, id, session.csrf) : (gate.require(owner, id, session.csrf, value), value.availability);
          if (checked.status === 'closed') fail(409, `岗位已关闭：${checked.evidence}`);
          if (!store.session(token)) fail(401, '请重新登录');
          if (generating) fail(409, '另一个 Word 任务正在处理，请稍后重试');
          generating = true;
          try {
            const result = operation === 'generation-draft' ? await prepare(owner, context, file) : await generate(owner, context, file, value);
            if (!store.session(token)) fail(401, '请重新登录；未保存生成材料');
            if (store.materialContext(owner, id).hash !== context.hash) fail(409, '岗位或简历已变化，请重新准备对照');
            if (operation === 'generation-draft') return json(res, 200, { ...result, contextHash: context.hash, availability: checked });
            gate.require(owner, id, session.csrf, value);
            const fingerprint = digest(JSON.stringify({ context: context.hash, fingerprint: value.fingerprint, decisions: value.decisions }));
            return json(res, 200, store.saveGenerated(owner, id, context, result, fingerprint));
          } finally { generating = false; }
        }
      }
      const formPath = path.match(/^\/api\/jobs\/([a-f0-9-]{36})\/application-form$/);
      if (formPath && req.method === 'POST') {
        const value = await input(), id = formPath[1], before = store.preparation(owner, id);
        if (value.basis !== before.basis) fail(409, '岗位依据已变化，请先刷新准备区');
        let result;
        try { result = await applicationForm(store.job(owner, id).url); }
        catch { fail(422, 'Greenhouse 申请表暂无法读取；请核实官方链接，或在官网查看并手动整理问题。原草稿未改。'); }
        if (!store.session(token)) fail(401, '请重新登录');
        if (store.preparation(owner, id).basis !== before.basis) fail(409, '读取期间依据已变化，请重试');
        return json(res, 200, { ...result, basis: before.basis });
      }
      const pair = path.match(/^\/api\/jobs\/([a-f0-9-]{36})\/browser-fill-code$/);
      if (pair && req.method === 'POST') return json(res,200,bridge.issue(owner,pair[1],token,await input()));
      const rehearsal = path.match(/^\/api\/jobs\/([a-f0-9-]{36})\/fill-rehearsal$/);
      if (rehearsal && req.method === 'POST') {
        const value = await input(), current = store.questionDraft(owner,rehearsal[1]);
        if (!current.draft || current.stale || value.revision !== current.revision || value.basis !== current.basis) fail(409,'请先保存并核对当前逐题草稿，再重新预演');
        const plan = {...rehearsalFields(current.draft), source:current.draft.form.source, revision:current.revision, basis:current.basis};
        const fingerprint = digest(JSON.stringify(plan));
        if (value.fingerprint !== undefined && (value.confirmed !== true || value.fingerprint !== fingerprint)) fail(409,'填写内容已变化或尚未确认，请重新预演');
        return json(res,200,{...plan,fingerprint,mode:'local-simulation'});
      }
      const questionHistory = path.match(/^\/api\/jobs\/([a-f0-9-]{36})\/question-history\/(\d+)$/);
      if (questionHistory && req.method === 'GET') return json(res, 200, store.questionHistory(owner,questionHistory[1],Number(questionHistory[2])));
      if(path==='/api/withdrawn-applications' && req.method==='GET')return json(res,200,store.withdrawnApplications(owner));
      const confirmationChange=path.match(/^\/api\/jobs\/([a-f0-9-]{36})\/submission-confirmations\/([a-f0-9-]{36})\/changes$/);
      if(confirmationChange && req.method==='POST')return json(res,200,store.changeConfirmation(owner,confirmationChange[1],confirmationChange[2],await input()));
      const application = path.match(/^\/api\/jobs\/([a-f0-9-]{36})\/(application|preparation|question-draft|channel|materials|submission|submission-confirmation)$/);
      if (application) {
        const [, id, operation] = application;
        if (operation === 'question-draft' && req.method === 'GET') return json(res, 200, store.questionDraft(owner, id));
        if (operation === 'question-draft' && req.method === 'PUT') return json(res, 200, store.saveQuestionDraft(owner, id, await input()));
        if (operation === 'preparation' && req.method === 'GET') return json(res, 200, store.preparation(owner, id));
        if (operation === 'preparation' && req.method === 'PUT') return json(res, 200, store.savePreparation(owner, id, await input()));
        if (operation === 'application' && req.method === 'GET') return json(res, 200, store.application(owner, id));
        if (operation === 'channel' && req.method === 'PUT') return json(res, 200, store.setApplicationChannel(owner, id, await input()));
        if (operation === 'materials' && req.method === 'POST') return json(res, 200, store.reviewMaterial(owner, id, await input(), session.csrf));
        if (operation === 'submission-confirmation' && req.method === 'POST') return json(res, 200, store.confirmSubmission(owner, id, await input()));
        if (operation === 'submission' && req.method === 'POST') return json(res, 200, store.recordSubmission(owner, id, await input()));
      }
      const viewing=path.match(/^\/api\/files\/([a-f0-9-]{36})\/view$/);
      if(viewing&&req.method==='POST'){
        await input();const file=store.file(owner,viewing[1],{includeDeleted:true});
        if(file.size>FILE_BYTES||file.bytes.length!==file.size||digest(file.bytes)!==file.sha256)fail(422,'文件校验失败，原件保持不变');
        if(parsing)fail(409,'正在读取另一个文件，请稍后重试');parsing=true;
        try{const data=file.format==='pdf'?{mode:'pages',...await preview(file)}:{mode:'text',text:(await documentText(file)).text};
          if(!store.session(token))fail(401,'请重新登录');store.file(owner,file.id,{includeDeleted:true});
          return json(res,200,{...data,id:file.id,name:file.name,format:file.format,sha256:file.sha256});
        }finally{parsing=false;}
      }
      const pdf = path.match(/^\/api\/files\/([a-f0-9-]{36})\/(preview|history-preview)$/);
      if (pdf && req.method === 'POST') {
        const historical=pdf[2]==='history-preview';
        const file = historical?store.historyFile(owner,pdf[1]):store.file(owner,pdf[1]);
        if (file.format !== 'pdf') fail(400, '请选择 PDF 材料');
        if (parsing) fail(409, '正在读取另一个文件，请稍后重试');
        parsing = true;
        try {
          const result = await preview(file);
          if (!store.session(token)) fail(401, '请重新登录');
          if(historical)store.historyFile(owner,file.id);else store.markPdfViewed(owner, file.id, result.pages, session.csrf);
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
      if (path === '/api/discovery/status' && req.method === 'GET') return json(res, 200, { ...runner.status(), canManage: session.role === 'admin' });
      if (path === '/api/discovery/settings' && req.method === 'PUT') {
        if (session.role !== 'admin') fail(403, '仅管理员可调整自动发现');
        return json(res, 200, runner.setEnabled((await input()).enabled));
      }
      if (path === '/api/recommendations' && req.method === 'GET') {
        const data = {...store.catalogue(),jobs:store.pendingOpportunities(owner)}, preferences = store.preferences(owner);
        return json(res, 200, { ...data, total: data.jobs.length, refreshing: Boolean(runner.pending), jobs: recommend(data.jobs, preferences, store.activeResume(owner), new Date(store.now())),
          unsupportedType: Boolean(preferences.jobTypes && !['intern', 'co-op', 'intern,co-op'].includes(preferences.jobTypes)) });
      }
      if(path === '/api/eligibility/exclusions' && req.method === 'GET')return json(res,200,store.eligibilityExclusions(owner));
      if(path === '/api/recommendations/update' && req.method === 'POST') {
        const value=await input();return json(res,202,runner.requestRefresh(value.trigger));
      }
      if (path === '/api/recommendations/refresh'  && req.method === 'POST') {
        await input();
        const result = await runner.start('manual');
        if (!store.session(token)) fail(401, '请重新登录');
        return json(res, 200, { sources: result.sources, finishedAt: result.finishedAt });
      }
      const suggested = path.match(/^\/api\/recommendations\/([a-f0-9]{64})\/(?:save|prepare)$/);
      if (suggested && req.method === 'POST') return json(res, 200, scored(owner, store.saveSuggested(owner, suggested[1])));
      if (path === '/api/jobs' && req.method === 'GET') { const resume=store.activeResume(owner),profile=resumeProfile(resume);return json(res, 200, store.jobs(owner).map(job => scored(owner, job, resume, profile))); }
      if (path === '/api/jobs' && req.method === 'POST') return json(res, 201, scored(owner, store.saveJob(owner, await input())));
      const returned = path.match(/^\/api\/jobs\/([a-f0-9-]{36})\/return$/);
      if (returned && req.method === 'PUT') { await input(); return json(res, 200, scored(owner, store.returnJob(owner, returned[1]))); }
      const visibility = path.match(/^\/api\/jobs\/([a-f0-9-]{36})\/visibility$/);
      if (visibility && req.method === 'PUT') return json(res, 200, scored(owner, store.setJobHidden(owner, visibility[1], (await input()).hidden)));
      const job = path.match(/^\/api\/jobs\/([a-f0-9-]{36})$/);
      if (job && req.method === 'GET') return json(res, 200, scored(owner, store.job(owner, job[1])));
      if (job && req.method === 'PUT') return json(res, 200, scored(owner, store.saveJob(owner, await input(), job[1])));
      if(path==='/api/files/trash'&&req.method==='GET')return json(res,200,store.files(owner,{includeDeleted:true}).filter(file=>file.deletedAt!==null));
      const fileKind=path.match(/^\/api\/files\/([a-f0-9-]{36})\/kind$/);if(fileKind&&req.method==='PUT')return json(res,200,store.setFileKind(owner,fileKind[1],(await input()).kind));
      const fileAction=path.match(/^\/api\/files\/([a-f0-9-]{36})\/(trash|restore)$/);
      if(fileAction&&req.method==='POST'){
        const value=await input();
        return json(res,200,fileAction[2]==='trash'?store.trashFile(owner,fileAction[1],value):store.restoreFile(owner,fileAction[1]));
      }
      if (path === '/api/files' && req.method === 'GET') return json(res, 200, store.files(owner));
      if (path === '/api/files' && req.method === 'POST') {
        if (req.headers['content-type'] !== 'application/octet-stream') fail(415, '请上传原始文件');
        let name;
        try { name = decodeURIComponent(req.headers['x-file-name'] ?? ''); } catch { fail(400, '文件名不正确'); }
        const bytes = await body(req, FILE_BYTES);
        // Recheck after an upload: logout or expiration may happen while reading the body.
        if (!store.session(token)) fail(401, '请重新登录');
        return json(res, 201, store.saveFile(owner, name, bytes,req.headers['x-file-kind']??'unknown'));
      }
      const file = path.match(/^\/api\/files\/([a-f0-9-]{36})(\/view-download)?$/);
      if (file && req.method === 'GET') {
        // A tab opened by another account must not download using a replaced shared cookie.
        if (req.headers['x-cq-csrf'] !== session.csrf) fail(403, '请从当前工作区下载');
        const row = file[2]?store.file(owner,file[1],{includeDeleted:true}):store.downloadFile(owner, file[1]);
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="document.${row.format}"; filename*=UTF-8''${encodeURIComponent(row.name).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase())}`);
        return res.end(Buffer.from(row.bytes));
      }
      fail(404, '未找到此页面');
    } catch (error) { if(error.retryAfter&&!res.headersSent)res.setHeader('Retry-After',String(error.retryAfter)); if (!res.headersSent) json(res, error.status ?? 500, { error: error.status ? error.message : '暂时无法保存或读取，请重试' }); else res.end(); }
  });
  server.requestTimeout = 30000;
  server.on('close', () => { emailAccounts.close(); store.close(); });
  return server;
  } catch (error) { store.close(); throw error; }
}

// Reserve the listener before opening/migrating the database. A duplicate start is read-only.
export async function startWorkspace({port=4322,...options}={}) {
  const server=createServer();
  await new Promise((done,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.removeListener('error',reject);done();});});
  try {return workspaceServer({...options,httpServer:server});}
  catch(error){await new Promise(done=>server.close(done));throw error;}
}
export function startupMessage(error,port=4322) {
  return error.code==='EADDRINUSE' ? port+' 端口已被占用，本次未打开数据库。请检查已有实例，不要重复启动；不会停止现用服务。' : '本机工作区启动失败。请检查配置文件、数据目录权限和数据库完整性；不要删除原数据库。';
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    let automationToken;
    try { automationToken=JSON.parse(await readFile(resolve(root,'private/v2-local/discovery-trigger.json'),'utf8')).token; }
    catch(error){if(error.code!=='ENOENT')throw error;}
    await startWorkspace({automationToken});
    console.log('Career Queue v2 本机工作区预览：http://127.0.0.1:4322/');
  } catch(error) {console.error(startupMessage(error));process.exitCode=1;}
}
