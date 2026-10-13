import { returnGuard, preserveList, viewLoader, viewNavigation } from './page-stability.js';
import { mountView } from './opportunity-view.js';
import { schoolRequirement } from './requirements.js';
import { deadlineSummary, factBadges, factsLabel, matchesOpportunity, mountFilters, platform } from './opportunity.js';
import { applicationWorkspace } from './application.js';
import { schoolWorkspace } from './school.js';
import { refreshController } from './refresh-controller.js';
const $ = selector => document.querySelector(selector);
const viewReads=viewLoader();
const readView=(key,load,options)=>viewReads.run(key,load,options);
const reading=new WeakMap();
async function backgroundRead(selector,run){const status=$(selector),ticket={epoch};reading.set(status,ticket);try{await run();if(ticket.epoch===epoch&&reading.get(status)===ticket)status.dataset.state='success';}catch(error){if(ticket.epoch===epoch&&reading.get(status)===ticket){status.dataset.state='error';status.textContent='读取未完成，已有内容保留；可重新切页或手动刷新重试。'+error.message;}}}
let reviewedResume = null, recommendations = [], visibleRecommendations = 20;
let account = null, csrf = '', epoch = 0, registering = false, jobs = [], busy = false, expiryTimer;
const channel = new BroadcastChannel('career-queue-v2-account');
function clearPrivate(message = '') {
  viewReads.invalidate(); navigation.reset();
  document.body.classList.remove('session-check');$('#workspace').inert=false;sessionReturn.stop();
  clearTimeout(expiryTimer); updates.stop(); applications.clear(); school.clear();
  reviewedResume = null; recommendations = []; $('#resume-text').textContent = ''; $('#resume-name').textContent = ''; $('#resume-review').hidden = true; $('#job-match').replaceChildren(); $('#recommendations-list').replaceChildren(); $('#source-status').replaceChildren(); $('#active-resume').textContent = '尚未启用简历';
  $('#show-hidden-jobs').checked = false;
  epoch++; account = null; csrf = ''; jobs = [];
  document.body.classList.remove('signed-in'); $('#workspace').hidden = true; $('#account').hidden = true; $('#auth').hidden = false;
  $('#admin-panel').hidden = true; $('#admin-panel').open = false;
  $('#username').textContent = ''; $('#jobs-list').replaceChildren(); $('#files-list').replaceChildren();
  $('#discovery-history').replaceChildren(); $('#discovery-status').textContent = '';
  for (const form of document.forms) form.reset();
  for(const e of document.querySelectorAll('.opportunity-filters input,.opportunity-filters select')) { if(e.type==='checkbox')e.checked=false;else e.value=''; }
  for (const node of document.querySelectorAll('[role=status]')) node.textContent = '';
  $('#job-link').hidden = true; $('#job-link').removeAttribute('href');
  $('#notice').textContent = message;
}
async function api(path, { method = 'GET', value, file } = {}) {
  const captured = epoch;
  const headers = { 'X-CQ-CSRF': csrf };
  if (value) headers['Content-Type'] = 'application/json';
  if (file) { headers['Content-Type'] = 'application/octet-stream'; headers['X-File-Name'] = encodeURIComponent(file.name); }
  const response = await fetch(path, { method, headers, credentials: 'same-origin', cache: 'no-store', body: file || (value ? JSON.stringify(value) : undefined) });
  const data = await response.json();
  if (captured !== epoch) throw new Error('账号已切换，请重试');
  if (!response.ok) {
    if (account && [401, 403].includes(response.status)) clearPrivate('会话已结束或账号已切换，请重新登录。');
    throw new Error(data.error || '请求失败，请重试');
  }
  if(method!=='GET'&&path!=='/api/recommendations/update')viewReads.invalidate();
  return data;
}
function setBusy(value) {
  busy = value;
  for (const element of document.querySelectorAll('button,input,select,textarea')) element.disabled = value;
}
async function action(status, run) {
  if (busy) return;
  const captured = epoch, statusNode = typeof status === 'string' ? $(status) : status;
  setBusy(true); statusNode.dataset.state='loading';statusNode.setAttribute('aria-busy','true');statusNode.textContent = '处理中…';
  try { await run(); } catch (error) { if (captured === epoch) {statusNode.dataset.state='error';statusNode.textContent = error.message;} }
  finally { if(statusNode.dataset.state==='loading')statusNode.dataset.state='success';statusNode.removeAttribute('aria-busy');setBusy(false); }
}
function tab(name) { navigation.visit(name==='school'?'school-jobs':name); }
function renderTab(name) {
  if(name==='school') name='school-jobs';
  const labels={recommendations:['发现机会','筛选适合你的机会，直接开始准备。'],'school-jobs':['学校职位','导入学校列表，与官网申请分开跟进。'],applications:['申请记录','只记录真实提交；误标可以撤回。'],files:['我的文件','原始简历与准备好的材料。'],jobs:['准备申请','围绕这份职位，完成需要的材料。'],security:['账号设置','管理本机账号。']};
  document.body.dataset.view=name;
  $('#view-title').textContent=labels[name]?.[0] || '工作区';$('#view-subtitle').textContent=labels[name]?.[1] || '';
  if(name!=='jobs') $('#job-detail').hidden=true;
  if (name !== 'security') $('#password-form').reset();
  $('#resume-review').hidden = name !== 'files' || !reviewedResume;
  for (const item of ['jobs', 'files', 'recommendations', 'applications', 'school', 'school-jobs', 'security']) {
    if(item!=='school') $(`#${item}-tab`).hidden = item !== name;
    const button = $(`[data-tab="${item}"]`);
    if (item === name) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  }
}
function selectJob(job, preserveApplication = false) {
  $('#job-detail').hidden=false; $('#job-edit-details').open=!job || !job.jd;
  $('#selected-job-summary').textContent=job ? job.company+' · '+job.title+' · '+factsLabel(job) : '从链接或 JD 开始准备';
  $('#preparation-route').textContent=job ? (platform(job.url).questions?'可以读取这份申请表的问题，也可以直接准备简历后到官网申请。':'先准备和检查简历，再打开岗位官网申请。需要的问答可记在下方，不需要浏览器配对。') : '';
  $('#browser-assistant').hidden=!job || !platform(job.url).questions;
  $('#read-application-form').hidden=!job || !platform(job.url).questions;
  if (preserveApplication) applications.refresh().catch(error => { $('#application-status').textContent = `职位已保存；材料区刷新失败：${error.message}`; }); else applications.reset(job?.id ?? null);
  const form = $('#job-form'); form.reset();
  for (const name of ['id', 'company', 'title', 'location', 'url', 'notes', 'jd']) form.elements[name].value = job?.[name] ?? '';
  $('#job-mode').textContent = job?.schoolId ? '学校职位 · School ID '+job.schoolId : job ? 'APPLICATION DRAFT' : 'NEW OPPORTUNITY';
  $('#back-school-jobs').hidden = !job?.schoolId;
  $('#job-title').textContent = job?.schoolId ? '学校职位与申请准备' : job ? '职位与备注' : '准备职位资料';
  $('#job-status').textContent = ''; $('#job-match').replaceChildren(matchView(job?.match));
  $('#job-link').hidden = !job?.url;
  if (job?.url) $('#job-link').href = job.url; else $('#job-link').removeAttribute('href');
  for (const node of document.querySelectorAll('.job-card')) node.setAttribute('aria-pressed', String(node.dataset.id === job?.id));
}
function jobDirty() {
  const form = $('#job-form'), original = jobs.find(job => job.id === form.elements.id.value);
  return ['company', 'title', 'location', 'url', 'notes', 'jd'].some(name => form.elements[name].value !== (original?.[name] ?? ''));
}
function allowJobSwitch() { return (!jobDirty() && !applications.dirty()) || window.confirm('这个职位或材料区有未保存的内容。放弃修改并切换？'); }
function drawJobs() {
  $('#job-count').textContent = String(jobs.filter(job => !job.hidden && !job.returned && !job.schoolId && !job.eligibilityExclusion).length);
  const visible = jobs.filter(job => !job.schoolId && !job.eligibilityExclusion && Boolean(job.hidden) === $('#show-hidden-jobs').checked && matchesOpportunity(job,savedFilters()));
  $('#saved-filter-count').textContent=`符合筛选 ${visible.length} 个职位`;
  $('#jobs-list').replaceChildren();
  if (!visible.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = $('#show-hidden-jobs').checked ? '没有已隐藏职位。' : '暂无准备草稿。从下方职位直接开始；这里也会保留原有资料。'; $('#jobs-list').append(p); }
  for (const job of visible) {
    const button = document.createElement('button'); button.className = 'job-card'; button.dataset.id = job.id;
    for (const [tag, text] of [['small', job.company], ['strong', job.title], ['small', job.location || '地点未填写'], ['small',factsLabel(job)]]) { const node = document.createElement(tag); node.textContent = text; button.append(node); }
    button.addEventListener('click', () => { if (allowJobSwitch()) { openPreparation(job,'recommendations'); } });
    const hide = node('button', job.hidden ? '恢复到清单' : '不需要，隐藏');
    hide.className = 'quiet'; hide.setAttribute('aria-label', (job.hidden ? '恢复 ' : '隐藏 ') + job.company + ' · ' + job.title);
    hide.addEventListener('click', () => {
      if ($('#job-form').elements.id.value === job.id && !allowJobSwitch()) return;
      action('#job-list-status', async () => {
        const saved = await api('/api/jobs/' + job.id + '/visibility', {method:'PUT',value:{hidden:!job.hidden}});
        jobs = jobs.map(row => row.id === saved.id ? saved : row);
        if ($('#job-form').elements.id.value === job.id) selectJob(null);
        drawJobs(); drawRecommendations(); $('#job-list-status').textContent = saved.hidden ? '已隐藏；可在“查看已隐藏”中恢复。材料和投递记录保留。' : '已恢复到机会清单。';
      });
    });
    const row = node('div'); row.append(button);
    const actions = node('div', '', 'actions');
    actions.append(hide); row.append(actions); $('#jobs-list').append(row);
  }
}
$('#show-hidden-jobs').addEventListener('change', drawJobs);
$('#back-school-jobs').addEventListener('click',()=>{ tab('school-jobs'); action('#school-jobs-status',school.refreshOpportunities); });
function drawFiles(files) {
  $('#files-list').replaceChildren();
  if (!files.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = '暂未保存原始文件。'; $('#files-list').append(p); }
  for (const file of files) {
    const row = document.createElement('div'); row.className = 'file-row';
    const text = document.createElement('div'), name = document.createElement('strong'), meta = document.createElement('small');
    name.textContent = file.name; meta.textContent = `${file.format.toUpperCase()} · ${Math.ceil(file.size / 1024)} KB · ${new Date(file.created).toLocaleDateString()} · 原件`;
    text.append(name, meta);
    const button = document.createElement('button'); button.textContent = '下载'; button.setAttribute('aria-label', `下载 ${file.name}`);
    button.addEventListener('click', () => action('#file-status', async () => {
      await downloadFile(file); $('#file-status').textContent = '已交给浏览器下载';
    }));
    const parse = document.createElement('button'); parse.textContent = '解析并查看'; parse.setAttribute('aria-label', `解析并查看 ${file.name}`);
    parse.addEventListener('click', () => action('#file-status', async () => {
      reviewedResume = await api(`/api/files/${file.id}/parse`, { method: 'POST', value: {} });
      $('#resume-name').textContent = file.name; $('#resume-text').textContent = reviewedResume.text; $('#activate-form').reset(); $('#resume-status').textContent = ''; $('#resume-review').hidden = false; $('#file-status').textContent = '解析完成，请核对下方文字再启用'; $('#resume-review').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    row.append(text, parse, button); $('#files-list').append(row);
  }
}
async function downloadFile(file) {
  const captured = epoch;
  const response = await fetch(`/api/files/${file.id}`, { headers: { 'X-CQ-CSRF': csrf }, cache: 'no-store' });
  if (!response.ok) {
    if ([401, 403].includes(response.status)) clearPrivate('会话已结束，请重新登录。');
    throw new Error('无法下载，请重新登录或重试');
  }
  const blob = await response.blob();
  if (captured !== epoch) return;
  const link = document.createElement('a'), url = URL.createObjectURL(blob); link.href = url; link.download = file.name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function enter(session) {
  account = session.user; csrf = session.csrf;
  clearTimeout(expiryTimer);
  expiryTimer = setTimeout(() => clearPrivate('会话已过期，请重新登录。'), Math.max(0, session.expires - Date.now()));
  const captured=epoch;
  selectJob(null);
  $('#username').textContent=account.username+(account.role==='admin'?' · 管理员':'');
  $('#admin-panel').hidden=account.role!=='admin';
  $('#auth-form').reset();$('#auth').hidden=true;$('#workspace').hidden=false;$('#account').hidden=false;$('#notice').textContent='';
  document.body.classList.add('signed-in');tab('recommendations');
  void backgroundRead('#notice',()=>readView('basics',async current=>{
   const [rows,files,resume,registration]=await Promise.all([api('/api/jobs'),api('/api/files'),api('/api/resume'),account.role==='admin'?api('/api/registration'):null]);
   if(captured!==epoch||!current())return;
   jobs=rows;drawJobs();drawFiles(files);$('#active-resume').textContent=resume?`当前评分基准：${resume.name} · ${resume.textHash.slice(0,8)}`:'尚未启用简历；可以浏览职位，暂不评分';
   if(registration)$('#admin-form').elements.registrationOpen.value=String(registration.registrationOpen);
   try{const draft=jobs.find(job=>job.id===sessionStorage.getItem('cq-draft-'+account.id));if(draft&&document.body.dataset.view==='recommendations'&&!jobDirty())openPreparation(draft);}catch{}
  }));
  void backgroundRead('#recommendation-status',()=>loadRecommendations(false));
  void updates.refresh('open');

}
function authMode(value) {
  registering = value;
  $('#auth-title').textContent = registering ? '创建本机账号' : '登录工作区';
  $('#auth-submit').textContent = registering ? '创建并进入' : '登录';
  $('#auth-toggle').textContent = registering ? '已有账号？返回登录' : '没有账号？创建本机账号';
  $('#auth-form').elements.password.autocomplete = registering ? 'new-password' : 'current-password';
  $('#auth-status').textContent = '';
}
$('#auth-toggle').addEventListener('click', () => authMode(!registering));
$('#password-form').addEventListener('submit', event => { event.preventDefault(); action('#password-status', async () => {
  const form = event.target;
  try {
    if (!form.elements.saved.checked) throw new Error('请先保存其他页面的修改，再确认退出登录');
    await api('/api/account/password', { method: 'POST', value: Object.fromEntries(['currentPassword', 'newPassword', 'confirmPassword'].map(name => [name, form.elements[name].value])) });
    clearPrivate('密码已修改，请用新密码重新登录。'); channel.postMessage('changed'); $('#auth-form').elements.username.focus();
  } finally {
    for (const name of ['currentPassword', 'newPassword', 'confirmPassword']) form.elements[name].value = '';
  }
}); });
$('#admin-form').addEventListener('submit', event => { event.preventDefault(); action('#admin-status', async () => {
  const registrationOpen = event.target.elements.registrationOpen.value === 'true';
  await api('/api/admin/registration', { method: 'PUT', value: { registrationOpen } });
  $('#auth-toggle').hidden = !registrationOpen;
  if (!registrationOpen) authMode(false);
  $('#admin-status').textContent = registrationOpen ? '已开放注册' : '已关闭注册；已有账号仍可登录';
}); });
$('#auth-form').addEventListener('submit', event => { event.preventDefault(); action('#auth-status', async () => {
  const form = event.target;
  const result = await api(registering ? '/api/register' : '/api/login', { method: 'POST', value: { username: form.elements.username.value, password: form.elements.password.value } });
  form.elements.password.value = ''; channel.postMessage('changed');
  try { await enter(result); } catch (error) { clearPrivate(`账号已登录，但工作区读取失败。请重新登录重试：${error.message}`); }
}); });
$('#logout').addEventListener('click', () => action('#notice', async () => {
  await api('/api/logout', { method: 'POST', value: {} });
  clearPrivate('已退出登录。'); channel.postMessage('changed'); $('#auth-form').elements.username.focus();
}));
$('#job-form').addEventListener('submit', event => { event.preventDefault(); action('#job-status', async () => {
  const form = event.target, id = form.elements.id.value;
  const value = Object.fromEntries(['company', 'title', 'location', 'url', 'notes', 'jd'].map(name => [name, form.elements[name].value]));
  const saved = await api(id ? `/api/jobs/${id}` : '/api/jobs', { method: id ? 'PUT' : 'POST', value });
  jobs = [saved, ...jobs.filter(job => job.id !== saved.id)]; drawJobs(); selectJob(saved, Boolean(id)); $('#job-status').textContent = '准备草稿已更新，尚未提交';
  try{sessionStorage.setItem('cq-draft-'+account.id,saved.id);}catch{}
}); });
$('#file-form').addEventListener('submit', event => { event.preventDefault(); action('#file-status', async () => {
  const file = event.target.elements.file.files[0];
  if (!file || file.size > 5 * 1024 * 1024) throw new Error('请选择不超过 5MB 的 PDF 或 DOCX');
  await api('/api/files', { method: 'POST', file }); event.target.reset(); $('#file-status').textContent = '原件已保存';
  try { drawFiles(await api('/api/files')); } catch { $('#file-status').textContent = '原件已保存，但列表刷新失败。请重新登录查看，不必重复上传。'; }
}); });
$('#job-form').elements.jd.addEventListener('input', () => { $('#job-match').replaceChildren(node('p', 'JD 已修改；保存后重新计算匹配度', 'muted')); });
$('#new-job').addEventListener('click', () => { if (allowJobSwitch()) { tab('jobs'); selectJob(null); $('#job-form').elements.company.focus(); } });
function readTab(name) {
 if(name==='recommendations')void backgroundRead('#recommendation-status',()=>loadRecommendations(false));
 if(name==='school-jobs')void backgroundRead('#school-jobs-status',()=>school.refreshOpportunities(false));
 if(name==='applications')void backgroundRead('#applications-status',()=>applications.records(false));
}
const navigation=viewNavigation({render:renderTab,read:readTab,views:['recommendations','school-jobs','applications','files','jobs','security']});
for(const button of document.querySelectorAll('[data-tab]'))button.addEventListener('click',()=>{tab(button.dataset.tab);readTab(button.dataset.tab);});
channel.addEventListener('message', () => clearPrivate('其他页面的账号已变化，请重新登录。'));
const sessionReturn=returnGuard({
 validate:async()=>{const captured=epoch,expected=account?.id,current=await api('/api/session');return captured===epoch&&current.user.id===expected&&current.csrf===csrf;},
 mask:value=>{document.body.classList.toggle('session-check',value);$('#workspace').inert=value;},
 clearPreview:()=>applications.clearPreview(),invalid:()=>clearPrivate('会话已变化，请重新登录。')
});
window.addEventListener('pagehide',()=>sessionReturn.hide());
window.addEventListener('pageshow',event=>{if(event.persisted&&account)void sessionReturn.show();});
document.addEventListener('visibilitychange',()=>{if(!account)return;if(document.hidden)sessionReturn.hide();else void sessionReturn.show();});
async function boot() {
  setBusy(true);
  try {
    const [settings,session]=await Promise.allSettled([api('/api/registration'),api('/api/session')]);
    $('#auth-toggle').hidden=settings.status!=='fulfilled'||!settings.value.registrationOpen;
    if(session.status==='rejected')throw session.reason;
    await enter(session.value);
  }
  catch (error) { clearPrivate(error.message === '请重新登录' ? '' : `工作区读取失败：${error.message}`); }
  finally { setBusy(false); }
}

function node(tag, text, className) { const el = document.createElement(tag); el.textContent = text; if (className) el.className = className; return el; }
function matchView(match) {
  const box = node('div', '', 'match-view');
  if (!match) return box;
  box.append(node('strong', match.score === null ? '暂不评分' : `${match.score} / 100 · 关键词证据覆盖`));
  if (match.reason) box.append(node('p', match.reason, 'muted'));
  if (match.source) box.append(node('small', `基于 ${match.source.name} · 简历 ${match.source.textHash.slice(0,8)} · JD ${match.source.jdHash.slice(0,8)}`));
  if (match.score !== null) {
    const detail = document.createElement('details'); detail.append(node('summary', '匹配依据与未体现要求'));
    detail.append(node('p', '这是本地规则的文字覆盖度，不是 ATS 通过率；简历未体现不等于不会。', 'muted'));
    for (const item of [...(match.matched || []), ...(match.gaps || [])]) {
      detail.append(node('strong', `${item.name} · ${item.level > 0 ? item.level < 1 ? '基础接触' : '有证据' : '未体现'}`));
      detail.append(node('p', item.evidence || '当前简历没有对应文字', 'quote'));
      for (const requirement of item.jdEvidence || []) detail.append(node('p', `JD：${requirement.quote}`, 'quote'));
    }
    box.append(detail);
  }
  return box;
}
$('#prepare-baseline').addEventListener('click',()=>{if(allowJobSwitch())tab('files');});
let returnTab='recommendations',returnPosition=0,returnFocus=null;
function openPreparation(job,from='recommendations') {
 returnPosition=window.scrollY;returnFocus=document.activeElement;returnTab=from;try{sessionStorage.setItem('cq-draft-'+account.id,job.id);}catch{}tab('jobs');selectJob(job);$('#job-detail').scrollIntoView({block:'start'});$('#selected-job-summary').focus();
}
$('#back-opportunities').addEventListener('click',()=>{if(allowJobSwitch()){try{sessionStorage.removeItem('cq-draft-'+account.id);}catch{}tab(returnTab);window.scrollTo(0,returnPosition);if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});}});
const discoveryFilters=mountFilters($('#discovery-filters'),()=>{visibleRecommendations=20;drawRecommendations();});
const discoveryView=mountView($('#recommendations-list'),'discovery',drawRecommendations);
const savedFilters=mountFilters($('#saved-filters'),drawJobs);
let discoveryRevision=0;
function showRefresh(data) {
 const el=$('#refresh-status'),last=data.runs?.at(-1);
 el.dataset.state=data.error || ['failed','interrupted'].includes(last?.status)?'error':data.running?'loading':'success';
 el.textContent=data.error ? '更新暂未完成 · '+data.error+' · 保留已有岗位，可点击重试。' : data.running ? '正在更新公开岗位 · 可以继续浏览' : last && ['failed','interrupted'].includes(last.status) ? '上次更新未完成 · 已保留已有岗位，点击刷新重试' : last?.finishedAt ? '最近更新 '+new Date(last.finishedAt).toLocaleString()+(last.status==='partial'?' · 部分来源待重试':'') : '打开时刷新 · 尚无更新记录';
 $('#refresh-sources').textContent=data.running?'查看更新进度':'刷新岗位';
}
async function loadDiscoveryStatus() {
 const revision=++discoveryRevision;
 const data=await api('/api/discovery/status');if(revision!==discoveryRevision)return data;
 showRefresh(data);
 $('#discovery-status').textContent='打开应用时更新，也可手动刷新；无后台每日计划。';
 $('#discovery-history').replaceChildren(...data.runs.slice(-10).reverse().map(run=>node('p',new Date(run.startedAt).toLocaleString()+' · '+({open:'打开应用',manual:'手动',scheduled:'历史定时'}[run.trigger]||run.trigger)+' · '+({running:'正在更新',done:'完成',partial:'部分完成',failed:'失败',interrupted:'中断'}[run.status])+(run.count!=null?' · '+run.count+' 条 / 新增 '+run.added:'') )));
 return data;
}
const updates=refreshController({
 request:trigger=>api('/api/recommendations/update',{method:'POST',value:{trigger}}),
 status:loadDiscoveryStatus,updated:()=>{viewReads.invalidate('discovery');return loadRecommendations();},changed:showRefresh
});
let recommendationRevision=0;
function loadRecommendations(force=true){return readView('discovery',readRecommendations,{force});}
async function readRecommendations(current) {
  const revision=++recommendationRevision,captured=epoch;
  const [data,exclusions]=await Promise.all([api('/api/recommendations'),api('/api/eligibility/exclusions')]);if(!current()||revision!==recommendationRevision||captured!==epoch)return;recommendations=data.jobs;
  $('#recommendation-status').textContent = data.unsupportedType ? '已保存的职位类型超出本期范围，请在求职偏好中重新选择。' : data.finishedAt ? `去重库 ${data.total ?? data.jobs.length} 条 · 截止与偏好筛选后 ${data.jobs.length} 条 · 最近刷新 ${new Date(data.finishedAt).toLocaleString()}` : '尚未读取公开列表，点击“刷新公开来源”开始。';
  $('#source-status').replaceChildren(...data.sources.map(source => node('p', `${source.name} · ${{ complete: '完整读取', partial: '部分读取', failed: '读取失败' }[source.status] || '待核实'} · 读取 ${source.raw ?? source.count} 条，范围内 ${source.count} 条 · ${source.detailed ?? 0} 条正文${source.error ? ' · ' + source.error : ''}`)));

  $('#eligibility-exclusions').replaceChildren(...exclusions.map(row=>node('p',`${row.company} · ${row.title} · ${row.reason.reason || '明确仅限加拿大公民'} · ${row.reason.quote || (row.reason.evidence || []).join(' ')}`)));
  $('#eligibility-filter-note').hidden=!exclusions.length;
  preserveList($('#recommendations-list'),drawRecommendations);
}
function drawRecommendations() {
  $('#recommendations-list').replaceChildren();
  const available=recommendations.filter(job=>matchesOpportunity(job,discoveryFilters()) && !jobs.some(saved=>(job.draftIds || []).includes(saved.id)&&saved.hidden));
  $('#recommendations-list').append(node('p',`${available.length} 个机会 · 显示 ${Math.min(available.length,visibleRecommendations)} 个`,'list-meta'));
  if(!available.length)$('#recommendations-list').append(node('p',recommendations.length?'没有符合当前条件的职位。试试清空筛选，或允许保留未知条件。':'还没有可浏览的职位。点击刷新公开来源，或从学校列表开始。','empty'));
  for (const job of available.slice(0, visibleRecommendations)) {
    const card = node('article', '', 'recommendation-card'+(job.hasSchool?' school-opportunity':''));card.dataset.jobId=job.id;
    const header=node('div','','card-header');header.append(node('span',job.company,'company-name'));card.append(header,node('h3',job.title),node('p',job.location || '地点未知','card-location'),factBadges(job),deadlineSummary(job));
    if(job.hasSchool){const confirmed=(job.schoolSources||[]).map(s=>s.requirement).filter(r=>r?.source==='user');const requirement=confirmed.length?(new Set(confirmed.map(r=>r.kind)).size===1?confirmed[0]:{kind:'unknown'}):schoolRequirement((job.schoolSources||[]).map(s=>s.row),job);card.append(node('p',({both:'学校 Portal + 官网均需提交',portal_only:'仅学校 Portal 提交',unknown:'申请途径待确认'})[requirement.kind],'route-summary'));}
    const detail=document.createElement('details');detail.className='card-detail';detail.append(node('summary','职位详情与匹配依据'));
    detail.append(node('p',`${job.workMode || '办公方式未知'} · ${job.salary || '薪资未披露'}`,'muted'));
    detail.append(node('small',`来源：${(job.sources || [job.source]).map(s=>s.name).join(' / ')}${job.stale?' · 待核实更新':''}${job.deadline?' · 截止 '+job.deadline:''}`),matchView(job.match),node('pre',job.jd || job.detailError || '暂无完整 JD'));
    if(job.hasPublic) detail.append(node('p','网络来源更新：'+(job.publicUpdated || '未知')+' · '+(job.stale?'状态待核实':'以官网当前状态为准')));
    for(const source of job.schoolSources || []) {
      detail.append(node('p',`学校 ID ${source.schoolId} · 更新 ${new Date(source.updated).toLocaleString()} · 状态 ${source.row.sourceStatus || '未知'} · 截止 ${source.row.deadlineText || '未知'}`));
      detail.append(node('p',`${source.row.company} · ${source.row.title} · ${source.row.location || '地点未知'} · ${source.row.term || '学期未知'} · 官网编号 ${source.row.requisitionId || '未知'}`));
      if(source.conflicts.length)detail.append(node('p','已明确关联，但来源字段不同：'+source.conflicts.join(' / ')));
      for(const [label,url] of [['学校原文',source.row.url],['学校提供的官网链接',source.row.externalUrl]])if(url){const a=node('a',label);a.href=url;a.target='_blank';a.rel='noopener noreferrer';detail.append(a);}
    }
    if(/remote/i.test(job.location))detail.append(node('p','远程地点来自招聘信息；加拿大工作资格需核实。','muted'));
    const link=node('a','官网申请 ↗');link.href=job.url;link.target='_blank';link.rel='noreferrer noopener';link.className='button-link';link.addEventListener('click',event=>event.stopPropagation());
    let savedJob=job.draftIds?.length===1?jobs.find(row=>job.draftIds.includes(row.id)):null;
    const prepare=node('button',savedJob?'继续准备申请':'准备申请');prepare.type='button';prepare.className='primary';
    const submitted=node('button','已提交？');submitted.type='button';submitted.className='quiet';
    const status=node('p','');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    async function prepareHere(confirmResult=false) {
      if(busy || !allowJobSwitch())return;
      await action(status,async()=>{
        if(!savedJob) savedJob=await api(`/api/recommendations/${job.id}/prepare`,{method:'POST',value:{}});
        else savedJob=await api('/api/jobs/'+savedJob.id);
        jobs=[savedJob,...jobs.filter(row=>row.id!==savedJob.id)];drawJobs();
        prepare.textContent='继续准备申请';status.textContent='已打开准备，尚未提交。';openPreparation(savedJob);
        if(confirmResult){$('#submission-details').open=true;$('#confirmation-form').scrollIntoView({block:'start'});}
      });
    }
    prepare.addEventListener('click',()=>prepareHere());submitted.addEventListener('click',()=>prepareHere(true));
    const actions = node('div', '', 'card-actions'); actions.append(prepare);if(job.url)actions.append(link);detail.append(submitted); card.append(detail, actions,status); $('#recommendations-list').append(card);
  }
  discoveryView();
  $('#more-recommendations').hidden = available.length <= visibleRecommendations;
}
async function refreshAssessment() {
  const resume = await api('/api/resume');
  $('#active-resume').textContent = resume ? `当前评分基准：${resume.name} · ${resume.textHash.slice(0,8)}` : '尚未启用简历；可以浏览职位，暂不评分';
  jobs = await api('/api/jobs'); drawJobs();
  // Keep every unsaved form value; only refresh its saved assessment.
  const current = jobs.find(job => job.id === $('#job-form').elements.id.value);
  $('#job-match').replaceChildren($('#job-form').elements.jd.value !== (current?.jd ?? '') ? node('p', 'JD 已修改；保存后重新计算匹配度', 'muted') : matchView(current?.match));
  await loadRecommendations(); await applications.refresh(); await applications.records();
}
$('#activate-form').addEventListener('submit', event => { event.preventDefault(); action('#resume-status', async () => {
  if (!reviewedResume) throw new Error('请先解析并核对文件');
  await api('/api/resume/activate', { method: 'POST', value: { fileId: reviewedResume.fileId, fileSha: reviewedResume.fileSha, textHash: reviewedResume.textHash, confirmed: event.target.elements.confirmed.checked } });
  $('#resume-status').textContent = '已启用';
  try { await refreshAssessment(); } catch { $('#resume-status').textContent = '简历已启用，但评分刷新失败。请重新登录查看，不必重新启用。'; }
}); });
$('#clear-resume').addEventListener('click', () => action('#file-status', async () => {
  await api('/api/resume/clear', { method: 'POST', value: {} }); $('#file-status').textContent = '已停用评分基准，原件仍保留';
  try { await refreshAssessment(); } catch { $('#file-status').textContent = '已停用，页面刷新失败，请重新登录查看'; }
}));
$('#refresh-sources').addEventListener('click',()=>{void updates.refresh('manual');});
$('#more-recommendations').addEventListener('click', () => { visibleRecommendations += 20; drawRecommendations(); });
const applications = applicationWorkspace({ api, action, readView, jobDirty, downloadFile,
  chooseJob: id => { const job = jobs.find(job => job.id === id); if (job && allowJobSwitch()) { openPreparation(job,'applications'); } },
  filesChanged: async () => drawFiles(await api('/api/files'))
});
const school = schoolWorkspace({ api, action, readView,
  jobsChanged: async () => { jobs = await api('/api/jobs'); drawJobs(); await loadRecommendations(); },
  chooseJob: async id => {
    if (!allowJobSwitch()) return;
    const job = await api(`/api/jobs/${id}`);
    jobs = [job, ...jobs.filter(row => row.id !== id)]; drawJobs(); openPreparation(job,'school-jobs');
  }
});
boot();
