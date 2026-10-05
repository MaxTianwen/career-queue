import { applicationWorkspace } from './application.js';
import { schoolWorkspace } from './school.js';
const $ = selector => document.querySelector(selector);
let reviewedResume = null, recommendations = [], visibleRecommendations = 20;
let account = null, csrf = '', epoch = 0, registering = false, jobs = [], busy = false, expiryTimer, discoveryConfigured = false;
const channel = new BroadcastChannel('career-queue-v2-account');
function clearPrivate(message = '') {
  clearTimeout(expiryTimer); applications.clear(); school.clear();
  reviewedResume = null; recommendations = []; $('#resume-text').textContent = ''; $('#resume-name').textContent = ''; $('#resume-review').hidden = true; $('#job-match').replaceChildren(); $('#recommendations-list').replaceChildren(); $('#source-status').replaceChildren(); $('#active-resume').textContent = '尚未启用简历';
  epoch++; account = null; csrf = ''; jobs = [];
  $('#workspace').hidden = true; $('#account').hidden = true; $('#auth').hidden = false;
  $('#admin-panel').hidden = true; $('#admin-panel').open = false;
  $('#username').textContent = ''; $('#jobs-list').replaceChildren(); $('#files-list').replaceChildren();
  discoveryConfigured = false; $('#discovery-history').replaceChildren(); $('#discovery-status').textContent = ''; $('#discovery-toggle').hidden = true;
  $('#data-usage').replaceChildren(); $('#migration-history').replaceChildren();
  for (const option of document.querySelectorAll('[data-legacy-type]')) option.remove();
  for (const form of document.forms) form.reset();
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
  return data;
}
function setBusy(value) {
  busy = value;
  for (const element of document.querySelectorAll('button,input,select,textarea')) element.disabled = value;
  $('#discovery-toggle').disabled = value || !discoveryConfigured;
}
async function action(status, run) {
  if (busy) return;
  const captured = epoch;
  setBusy(true); $(status).textContent = '处理中…';
  try { await run(); } catch (error) { if (captured === epoch) $(status).textContent = error.message; }
  finally { setBusy(false); }
}
function tab(name) {
  if (name !== 'security') $('#password-form').reset();
  $('#resume-review').hidden = name !== 'files' || !reviewedResume;
  for (const item of ['jobs', 'preferences', 'files', 'recommendations', 'applications', 'school', 'data', 'security']) {
    $(`#${item}-tab`).hidden = item !== name;
    const button = $(`[data-tab="${item}"]`);
    if (item === name) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  }
}
function selectJob(job, preserveApplication = false) {
  if (preserveApplication) applications.refresh().catch(error => { $('#application-status').textContent = `职位已保存；材料区刷新失败：${error.message}`; }); else applications.reset(job?.id ?? null);
  const form = $('#job-form'); form.reset();
  for (const name of ['id', 'company', 'title', 'location', 'url', 'notes', 'jd']) form.elements[name].value = job?.[name] ?? '';
  $('#job-mode').textContent = job ? 'SAVED OPPORTUNITY' : 'NEW OPPORTUNITY';
  $('#job-title').textContent = job ? '职位与备注' : '保存职位';
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
  $('#job-count').textContent = String(jobs.length);
  $('#jobs-list').replaceChildren();
  if (!jobs.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = '还没有保存职位。先把一个感兴趣的机会留在这里。'; $('#jobs-list').append(p); }
  for (const job of jobs) {
    const button = document.createElement('button'); button.className = 'job-card'; button.dataset.id = job.id;
    for (const [tag, text] of [['small', job.company], ['strong', job.title], ['small', job.location || '地点未填写']]) { const node = document.createElement(tag); node.textContent = text; button.append(node); }
    button.addEventListener('click', () => { if (allowJobSwitch()) { selectJob(job); $('#job-form').elements.company.focus(); } });
    $('#jobs-list').append(button);
  }
}
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
  const [preferences, rows, files] = await Promise.all([api('/api/preferences'), api('/api/jobs'), api('/api/files')]);
  jobs = rows; drawJobs(); drawFiles(files); selectJob(null); await refreshAssessment();
  for (const name of ['direction', 'locations', 'jobTypes']) $('#preferences-form').elements[name].value = preferences[name] ?? '';
  if (preferences.jobTypes && !['intern', 'co-op', 'intern,co-op'].includes(preferences.jobTypes)) { const option = new Option(`旧偏好：${preferences.jobTypes}（本期不支持，请重新选择）`, preferences.jobTypes); option.dataset.legacyType = 'true'; $('#preferences-form').elements.jobTypes.add(option); $('#preferences-form').elements.jobTypes.value = preferences.jobTypes; }
  $('#username').textContent = account.username + (account.role === 'admin' ? ' · 管理员' : '');
  $('#admin-panel').hidden = account.role !== 'admin';
  if (account.role === 'admin') $('#admin-form').elements.registrationOpen.value = String((await api('/api/registration')).registrationOpen);
  $('#auth-form').reset(); $('#auth').hidden = true; $('#workspace').hidden = false; $('#account').hidden = false; $('#notice').textContent = '';
  tab('jobs');
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
  jobs = [saved, ...jobs.filter(job => job.id !== saved.id)]; drawJobs(); selectJob(saved, Boolean(id)); $('#job-status').textContent = '已保存';
}); });
$('#preferences-form').addEventListener('submit', event => { event.preventDefault(); action('#preferences-status', async () => {
  const value = Object.fromEntries(['direction', 'locations', 'jobTypes'].map(name => [name, event.target.elements[name].value]));
  await api('/api/preferences', { method: 'PUT', value }); $('#preferences-status').textContent = '偏好已保存';
  try { await loadRecommendations(); } catch { $('#preferences-status').textContent = '偏好已保存；建议列表刷新失败，请重新进入工作区查看'; }
}); });
$('#file-form').addEventListener('submit', event => { event.preventDefault(); action('#file-status', async () => {
  const file = event.target.elements.file.files[0];
  if (!file || file.size > 5 * 1024 * 1024) throw new Error('请选择不超过 5MB 的 PDF 或 DOCX');
  await api('/api/files', { method: 'POST', file }); event.target.reset(); $('#file-status').textContent = '原件已保存';
  try { drawFiles(await api('/api/files')); } catch { $('#file-status').textContent = '原件已保存，但列表刷新失败。请重新登录查看，不必重复上传。'; }
}); });
$('#job-form').elements.jd.addEventListener('input', () => { $('#job-match').replaceChildren(node('p', 'JD 已修改；保存后重新计算匹配度', 'muted')); });
$('#new-job').addEventListener('click', () => { if (allowJobSwitch()) { tab('jobs'); selectJob(null); $('#job-form').elements.company.focus(); } });
for (const button of document.querySelectorAll('[data-tab]')) button.addEventListener('click', () => { tab(button.dataset.tab); if (button.dataset.tab === 'recommendations') action('#recommendation-status', loadRecommendations); if (button.dataset.tab === 'data') action('#data-status', refreshUsage); if (button.dataset.tab === 'school') action('#school-status', school.refresh); });
async function refreshUsage() {
  const [usage, migrations] = await Promise.all([api('/api/data/usage'), api('/api/data/migrations')]);
  $('#migration-history').replaceChildren(...(migrations.length ? migrations.map(entry => {
    const detail = node('details'), summary = node('summary', `${entry.targetAtMigration.company} · ${entry.targetAtMigration.title} · ${new Date(entry.created).toLocaleString()}`);
    detail.append(summary, node('p', `来源：v1 Notion · Key ${entry.sourceKey}`), node('p', `迁入记录：${entry.id}`));
    const original = node('details'); original.append(node('summary', '查看旧版职位快照'));
    for (const [key, label] of [['company','公司'],['title','职位'],['term','入职批次'],['status','旧版状态'],['location','地点'],['url','链接'],['notes','备注'],['jd','JD']]) original.append(node('p', `${label}：${entry.original[key] || '未记录'}`));
    detail.append(original);
    for (const file of entry.documents) { const item = node('details'); item.append(node('summary', `${file.name} · 历史生成稿，未审阅`), node('p', `旧版本：${file.version} · 旧基准：${file.baseline}`), node('p', `SHA-256：${file.sha256}`)); detail.append(item); }
    return detail;
  }) : [node('p', '尚无旧版迁入记录。', 'muted')]));
  $('#data-usage').replaceChildren(
    node('p', `文件：${usage.files.count} / ${usage.files.maxCount} 个 · ${(usage.files.bytes / 1048576).toFixed(2)} / ${usage.files.maxBytes / 1048576} MB`),
    node('p', `已保存职位：${usage.jobs.count} / ${usage.jobs.maxCount}`),
    node('p', `Word 工作目录：${usage.wordWork.count} / ${usage.wordWork.maxCount} 次`),
    node('p', '一次 Word 生成会保存两个文件；准备对照和生成各占一个工作目录。', 'muted'));
  $('#data-status').textContent = '用量已更新';
}
$('#refresh-usage').addEventListener('click', () => action('#data-status', refreshUsage));
$('#export-data').addEventListener('click', () => action('#data-status', async () => {
  const captured = epoch;
  const response = await fetch('/api/data/export', { method: 'POST', headers: { 'X-CQ-CSRF': csrf }, credentials: 'same-origin', cache: 'no-store' });
  if (captured !== epoch) return;
  if (!response.ok) {
    const data = await response.json();
    if ([401, 403].includes(response.status)) clearPrivate('会话已结束，请重新登录。');
    throw new Error(data.error || '导出失败，请重试');
  }
  const blob = await response.blob();
  if (captured !== epoch) return;
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = 'career-queue-personal.zip'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  $('#data-status').textContent = '资料包已交给浏览器下载；请妥善保管其中的个人资料。';
}));
channel.addEventListener('message', () => clearPrivate('其他页面的账号已变化，请重新登录。'));
window.addEventListener('pagehide', () => clearPrivate());
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
// Revalidate on return, keeping private content hidden until the current cookie is checked.
document.addEventListener('visibilitychange', async () => {
  if (!account) return;
  if (document.hidden) { applications.clearPreview(); $('#workspace').hidden = true; $('#account').hidden = true; return; }
  const captured = epoch, expected = account.id;
  try {
    const current = await api('/api/session');
    if (captured !== epoch) return;
    if (current.user.id !== expected || current.csrf !== csrf) return clearPrivate('账号已切换，请重新登录。');
    $('#workspace').hidden = false; $('#account').hidden = false;
  } catch { if (captured === epoch) clearPrivate('暂时无法验证会话，请重新登录。'); }
});
async function boot() {
  setBusy(true);
  try {
    const settings = await api('/api/registration');
    $('#auth-toggle').hidden = !settings.registrationOpen;
    await enter(await api('/api/session'));
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
let discoveryRevision = 0, discoveryEnabled = false;
async function loadDiscoveryStatus() {
  const revision = ++discoveryRevision;
  try {
    const data = await api('/api/discovery/status'); if (revision !== discoveryRevision) return;
    discoveryEnabled = data.enabled; discoveryConfigured = data.configured;
    const state = data.running ? '正在刷新' : data.broken ? '运行记录异常，已停止' : !data.configured ? '后台入口未配置' : data.enabled ? '允许后台触发' : '已暂停';
    $('#discovery-status').textContent = state + ' · 每天多伦多09:00' + (data.waiting ? ' · ' + data.waiting : '') + (data.enabled && data.configured ? (data.due ? ' · 等待当天补跑' : ' · 下次计划 ' + new Date(data.nextScheduledAt).toLocaleString()) : '');
    $('#discovery-toggle').hidden = !data.canManage; $('#discovery-toggle').disabled = !data.configured || busy;
    $('#discovery-toggle').textContent = data.enabled ? '暂停自动发现' : '启用自动发现';
    $('#discovery-history').replaceChildren(...data.runs.slice(-10).reverse().map(run => node('p', new Date(run.startedAt).toLocaleString() + ' · ' + (run.trigger === 'manual' ? '手动' : run.catchUp ? '当天补跑' : '定时') + ' · ' + ({running:'运行中',done:'完成',partial:'部分成功',failed:'失败',interrupted:'中断'}[run.status]) + (run.count != null ? ' · '+run.count+'条，新增'+run.added+'条' : '') + (run.error ? ' · '+run.error : ''))));
  } catch (error) { if (revision !== discoveryRevision || !account) return; discoveryConfigured = false; $('#discovery-status').textContent = '运行状态暂无法读取：' + error.message; $('#discovery-toggle').disabled = true; }
}
$('#discovery-reload').addEventListener('click', () => action('#recommendation-status', loadRecommendations));
$('#discovery-toggle').addEventListener('click', () => action('#recommendation-status', async () => {
  await api('/api/discovery/settings', {method:'PUT',value:{enabled:!discoveryEnabled}}); await loadDiscoveryStatus();
  $('#recommendation-status').textContent = '日程开关已更新；已开始的搜索会完成，不会中断保存。';
}));
async function loadRecommendations() {
  await loadDiscoveryStatus();
  const data = await api('/api/recommendations'); recommendations = data.jobs; visibleRecommendations = 20;
  $('#recommendation-status').textContent = data.unsupportedType ? '已保存的职位类型超出本期范围，请在求职偏好中重新选择。' : data.finishedAt ? `${data.jobs.length} 个符合当前偏好的机会 · 最近刷新 ${new Date(data.finishedAt).toLocaleString()}` : '尚未读取公开列表，点击“刷新公开来源”开始。';
  $('#source-status').replaceChildren(...data.sources.map(source => node('p', `${source.name} · ${{ complete: '完整读取', partial: '部分读取', failed: '读取失败' }[source.status] || '待核实'} · ${source.count} 条本次结果 · ${source.detailed ?? 0} 条正文${source.error ? ' · ' + source.error : ''}`)));
  drawRecommendations();
}
function drawRecommendations() {
  $('#recommendations-list').replaceChildren();
  for (const job of recommendations.slice(0, visibleRecommendations)) {
    const card = node('article', '', 'recommendation-card');
    card.append(node('small', `${job.company} · ${job.classification.label || job.classification.track}`), node('h3', job.title), node('p', `${job.location} · ${job.workMode} · ${job.salary}`));
    card.append(node('small', `来源：${job.source.name}${job.stale ? ' · 本次未读到，保留上次结果，请核实是否开放' : ''}${job.deadline ? ' · 截止 ' + job.deadline : ''}`), matchView(job.match));
    const detail = document.createElement('details'); detail.append(node('summary', '查看完整 JD'), node('pre', job.jd || job.detailError || '来源未提供完整 JD，暂不评分'));
    const link = node('a', '打开官方岗位 ↗'); link.href = job.url; link.target = '_blank'; link.rel = 'noreferrer noopener';
    const save = node('button', '保存到我的职位');
    save.addEventListener('click', () => action('#recommendation-status', async () => {
      const saved = await api(`/api/recommendations/${job.id}/save`, { method: 'POST', value: {} });
      jobs = [saved, ...jobs.filter(row => row.id !== saved.id)]; drawJobs();
      $('#recommendation-status').textContent = '已保存在“已保存职位”；重复保存不会覆盖原备注'; save.textContent = '已保存';
    }));
    const actions = node('div', '', 'actions'); actions.append(save, link); card.append(detail, actions); $('#recommendations-list').append(card);
  }
  $('#more-recommendations').hidden = recommendations.length <= visibleRecommendations;
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
$('#refresh-sources').addEventListener('click', () => action('#recommendation-status', async () => {
  $('#recommendation-status').textContent = '正在读取雇主公开列表，可能需要一两分钟…';
  try { await api('/api/recommendations/refresh', { method: 'POST', value: {} }); } finally { await loadDiscoveryStatus(); }
  try { await loadRecommendations(); } catch { $('#recommendation-status').textContent = '公开列表已刷新，页面读取失败；重新登录查看即可，无需重复刷新'; }
}));
$('#more-recommendations').addEventListener('click', () => { visibleRecommendations += 20; drawRecommendations(); });
const applications = applicationWorkspace({ api, action, jobDirty, downloadFile,
  chooseJob: id => { const job = jobs.find(job => job.id === id); if (job && allowJobSwitch()) { tab('jobs'); selectJob(job); $('#job-title').scrollIntoView({ block: 'start' }); } },
  filesChanged: async () => drawFiles(await api('/api/files'))
});
const school = schoolWorkspace({ api, action,
  jobsChanged: async () => { jobs = await api('/api/jobs'); drawJobs(); },
  chooseJob: async id => {
    if (!allowJobSwitch()) return;
    const job = await api(`/api/jobs/${id}`);
    jobs = [job, ...jobs.filter(row => row.id !== id)]; drawJobs(); tab('jobs'); selectJob(job); $('#job-title').scrollIntoView({ block: 'start' });
  }
});
boot();
