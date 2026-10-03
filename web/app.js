import { placementTermText } from './placement-options.js';
import { automationView } from './automation-view.js';
import { resumeReviewView, resumeReviewHistory } from './resume-review-view.js';
import { discoverySourcesView, fieldEvidenceView } from './discovery-sources-view.js';
import { openPortalImport } from './portal-import.js';
import { schoolAssociationView } from './school-association.js';
import { matchesFilters, sortJobs } from './job-view.js';
import { publication, recentPublication, durationText, workModeText } from './job-facts.js';
import { jobHighlights, skillHighlights, scoreBasisText, scoreComponentsView, workplaceBadge } from './job-summary.js';
import { jobDescription } from './job-description.js';
import { eligibilityBadge, assessmentPanel, freshnessReview } from './assessment-view.js';
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = value => { try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) ? esc(u.href) : '#'; } catch { return '#'; } };
let mode = 'live', view = ['discover', 'queue', 'applications', 'resumes', 'portal'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'discover', jobs = [], csrf = '', status, selected, connected = false, listError = '', refreshId = 0;
let portalJobs = [], portalLoad = 0;
let automationState = null;
let automationPollId = 0;
let detailContext = null;
let detailRequest = 0, detailOpener = null;
let detailReturnY = 0, detailReturnView = '';
let highlightedKey = '', loadingJobs = true, listPage = 0, pageSize = 20;
let searchState = { state: 'idle', report: null }, searchPage = 0, searchTimer, importedSource = null;
const applyView = rows => sortJobs(rows.filter(j => matchesFilters(j, { term: $('#term-filter').value, track: $('#track-filter').value, duration: $('#duration-filter').value,
  workMode: $('#work-mode-filter').value, location: $('#location-filter').value, city: $('#city-filter').value })), $('#sort-order').value);
const appStates = ['待提交', '已投递', '面试中', '已结束'];
function feedback(message, error = false) { const node = $('#feedback'); node.hidden = false; node.className = `feedback${error ? ' error' : ''}`; node.textContent = message; }
function dialogError(dialog, error) {
  let box = dialog.querySelector('.dialog-error');
  if (!box) { box = document.createElement('div'); box.className = 'feedback error dialog-error'; box.setAttribute('role', 'alert'); dialog.querySelector('.dialog-content').prepend(box); }
  box.textContent = error.message;
}
async function api(path, body) {
  const response = await fetch(`${path}${path.includes('?') ? '&' : '?'}mode=${mode}`, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(body)
  });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || '请求失败'); return data;
}
function renderBanner() {
  const banner = $('#mode-banner'); banner.className = `notice${mode === 'demo' ? ' demo' : ''}`;
  banner.innerHTML = mode === 'demo' ? '<span><b>演示工作区</b> · 所有职位均为虚构，操作不写入 Notion。记录在服务重启后清空。</span><button data-action="mode">返回真实工作区 →</button>'
    : connected ? '<span>Notion 已连接 · 你的操作会保存到 Career Queue。</span><button data-action="settings">连接设置 →</button>'
      : '<span>自动搜索可直接使用。连接 Notion 后，可将选中的结果保存到正式 Queue。</span><button data-action="settings">连接 Notion →</button>';
  $('#connection-text').textContent = mode === 'demo' ? '演示模式 · 本机' : connected ? 'Notion 已连接' : 'Notion 尚未连接';
  $('#connection-dot').className = `dot${connected ? ' ok' : ''}`;
}
function render() {
  const isQueue = view === 'queue', isDiscover = view === 'discover';
  document.body.dataset.view = view;
  $('#browse-workspace').hidden = ['resumes', 'portal'].includes(view);
  $('#resume-library').hidden = view !== 'resumes';
  $('#portal-workspace').hidden = view !== 'portal';
  $('.filter-panel').hidden = ['resumes', 'portal'].includes(view);
  $('.heading-actions').hidden = ['resumes', 'portal'].includes(view);
  $('#discovery').hidden = !isDiscover;
  $('#automation').hidden = !isDiscover || mode === 'demo';
  $('#workspace-list').hidden = isDiscover || ['resumes', 'portal'].includes(view);
  $('#breadcrumb').textContent = isDiscover ? '发现职位' : isQueue ? '已保存 Queue' : '申请记录';
  $('#page-title').textContent = isDiscover ? '发现职位' : isQueue ? '已保存的机会' : '申请进展';
  $('#page-subtitle').textContent = isDiscover ? '发现职位 → 保存到 Queue → 定制简历 → 跟进申请' : isQueue ? '从发现页、手动添加或学校列表保存的职位。选择一份，补齐信息并准备申请。' : '集中查看待提交材料、真实投递日期和后续进展。';
  if (view === 'resumes') {
    $('#page-title').textContent = '我的简历';
    $('#page-subtitle').textContent = '分别维护 CS 与 Data 简历。上传后持续使用，重启或下次打开也会保留。';
    $('#breadcrumb').textContent = '我的简历';
  }
  if (view === 'portal') {
    $('#page-title').textContent = '学校待办';
    $('#page-subtitle').textContent = '关联学校职位，分别追踪两边的截止日期、提交记录和材料版本。';
    $('#breadcrumb').textContent = '学校待办';
  }
  $('#list-title').textContent = isQueue ? '待处理职位' : '申请记录';
  $('#list-caption').textContent = mode === 'demo' ? '演示记录 · 仅本机' : '同步自 Notion · Career Queue';
  document.querySelectorAll('.nav-item').forEach(n => { n.classList.toggle('active', n.dataset.action === view); n.setAttribute('aria-current', n.dataset.action === view ? 'page' : 'false'); });
  $('#queue-count').textContent = connected ? jobs.filter(j => j.status === 'Queue').length : '—';
  $('#app-count').textContent = connected ? jobs.filter(j => appStates.includes(j.status)).length : '—';
  const query = $('#filter').value.trim().toLowerCase();
  const hasFilters = ['term-filter','track-filter','duration-filter','work-mode-filter','location-filter','city-filter','filter'].some(id => $(`#${id}`).value.trim());
  const rows = applyView(jobs.filter(j => (isQueue ? j.status === 'Queue' : appStates.includes(j.status)) && `${j.company} ${j.title} ${j.location} ${termText(j)} ${(j.indexEvidence?.terms ?? []).join(' ')}`.toLowerCase().includes(query)));
  $('#list-footer').textContent = connected ? `${rows.length} 个${isQueue ? '待处理职位' : '申请记录'}${mode === 'demo' ? ' · 演示数据' : ''}` : '等待连接正式记录';
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  listPage = Math.max(0, Math.min(listPage, pages - 1));
  $('#list-pagination').innerHTML = connected && !loadingJobs ? paginationControls(rows.length, listPage, pages, 'list') : '';
  if (loadingJobs) { $('#job-list').innerHTML = '<div class="empty"><h3>正在读取已保存职位…</h3><p>正在连接工作区，请稍候。</p></div>'; syncDetailSelection(); return; }
  if (!connected || !rows.length) {
    $('#job-list').innerHTML = `<div class="empty"><div class="empty-icon">${connected ? '▤' : '↗'}</div><h3>${!connected ? '连接你的求职工作区' : hasFilters ? '当前筛选下没有职位' : isQueue ? '为下一次机会留个位置' : '第一份申请，从 Queue 开始'}</h3><p>${!connected ? esc(listError) : hasFilters ? '已保存的职位可能被筛选条件隐藏。清除条件即可查看全部。' : isQueue ? '在“发现职位”中点击“保存到 Queue”，职位就会出现在这里。' : '材料准备、检查并上传成功后，职位会出现在这里，状态为“待提交”。'}</p>${!connected ? '<button class="button primary" data-action="mode">体验演示工作区</button> <button class="button secondary" data-action="settings">连接 Notion</button>' : hasFilters ? '<button class="button secondary" data-action="reset-filters">清除筛选</button>' : isQueue ? '<button class="button primary" data-action="discover">去发现职位 →</button>' : ''}</div>`; syncDetailSelection(); return;
  }
  $('#job-list').innerHTML = rows.slice(listPage * pageSize, (listPage + 1) * pageSize).map(j => savedCard(j, isQueue)).join('');
  syncDetailSelection();
}
function savedCard(j, isQueue) {
  return `<article data-job-key="${j.key}" class="discovery-card saved-card ${j.key === highlightedKey ? 'saved-highlight' : ''}">
    <div class="card-overline"><span class="company-icon">${esc(j.company.slice(0,1))}</span><strong>${esc(j.company)}</strong><span class="badge">${esc(j.schoolCandidate ? '学校候选 · 待补 JD' : j.jdSource === 'school' ? '学校来源 · JD 已保存' : j.status)}</span></div>
    <div class="card-title-row"><button class="job-title" data-action="detail" data-key="${j.key}">${esc(j.title)}</button><div class="card-score" title="当前简历覆盖分，不代表录取概率">${scoreBadge(j)}<span>${esc(scoreBasisText(j.match))}</span></div></div>
    <div class="card-tags">${directionBadge(j)}${workplaceBadge(j)}${eligibilityBadge(j)}</div>
    <dl class="card-facts"><div><dt>入职时间</dt><dd>${fieldTag(termText(j),'term', termText(j).includes('待核实'))}</dd></div><div><dt>工作时长</dt><dd>${fieldTag(durationText(j),'duration', durationText(j).includes('待核实'))}</dd></div><div><dt>地点 / 方式</dt><dd>${esc(j.location || '待核实')} · ${esc(modeText(j))}</dd></div><div><dt>薪资</dt><dd>${esc(j.salary || '未披露')}</dd></div></dl>
    <p class="card-dates">${isQueue ? esc(publicationText(j)) : '申请日期：' + esc(j.applicationDate || '尚未投递')}</p>
    ${j.notes || j.nextStep ? '<p class="card-note">' + esc(isQueue ? j.notes || j.nextStep : j.nextStep || j.notes) + '</p>' : ''}
    <div class="card-actions"><button class="button secondary compact" data-action="detail" data-key="${j.key}">查看与处理 →</button></div></article>`;
}
function syncDetailSelection() {
  const dialog = $('#detail');
  const key = dialog.open ? detailContext?.key : null;
  let visible = false;
  for (const row of document.querySelectorAll('#browse-list [data-job-key]')) {
    const active = row.dataset.jobKey === key;
    row.classList.toggle('is-selected', active);
    if (active && row.closest('section')?.hidden !== true) visible = true;
    for (const button of row.querySelectorAll('[data-action="detail"], [data-action="search-detail"]')) button.setAttribute('aria-current', active ? 'true' : 'false');
  }
  const note = $('#detail-selection-note');
  if (note) note.hidden = visible || dialog.dataset.layout !== 'split';
}
function showDetailSurface({ focus = true } = {}) {
  const dialog = $('#detail'), split = ['discover','queue','applications'].includes(view);
  dialog.inert = false;
  if (!split) {
    document.body.append(dialog); dialog.dataset.layout = 'overlay';
    if (!dialog.open) dialog.showModal();
  } else {
    $('#detail-column').append(dialog); dialog.dataset.layout = 'split';
    if (!dialog.open) dialog.show();
    $('#browse-workspace').classList.add('has-detail');
  }
  $('#detail-title').tabIndex = -1;
  const close = $('#detail [data-action="close"]');
  close.textContent = split ? '← 返回' : '×'; close.setAttribute('aria-label', split ? '返回职位列表' : '关闭详情'); close.classList.toggle('detail-back', split);
  $('#detail-body').insertAdjacentHTML('afterbegin', '<p id="detail-selection-note" class="selection-note" hidden>所选职位不在当前筛选或分页中，详情仍为上次所选职位。</p>');
  dialog.scrollTop = 0; syncDetailSelection();
  if (focus) $('#detail-title').focus({ preventScroll: true });
  if (split && matchMedia('(max-width: 900px)').matches) $('#browse-workspace').scrollIntoView({block:'start'});
}
function detailFeedback(key, error) {
  const focus = !error || Boolean(document.activeElement?.closest('#detail'));
  const job = jobs.find(j => j.key === key) || portalJobs.find(j => j.key === key);
  $('#detail').dataset.state = error ? 'failed' : 'loading';
  $('#detail-body').innerHTML = `<div class="dialog-head"><div><span class="eyebrow">${esc(job?.company || '已保存职位')}</span><h2 id="detail-title">${esc(job?.title || '职位详情')}</h2></div><button class="close" data-action="close" aria-label="关闭详情">×</button></div><div class="dialog-content detail-status"><p role="${error ? 'alert' : 'status'}">${error ? `详情读取失败：${esc(error.message)}` : '正在读取这份职位…'}</p>${error ? `<p>尚未载入当前详情，可以重试或选择其他职位。</p><button class="button primary" data-action="retry-detail" data-key="${esc(key)}">重新读取详情</button>` : '<p>读取完成后显示当前要求与材料。</p>'}</div>`;
  showDetailSurface({ focus });
}
function formFeedback(form, message, kind = 'success') {
  let box = form.nextElementSibling;
  if (!box?.classList.contains('form-status')) {
    box = document.createElement('p'); box.className = 'form-status'; box.tabIndex = -1;
    form.insertAdjacentElement('afterend', box);
  }
  box.dataset.state = kind; box.setAttribute('role', kind === 'error' ? 'alert' : 'status'); box.textContent = message;
  if (kind === 'error') { box.focus({preventScroll:true}); box.scrollIntoView({block:'nearest'}); }
}
function detailNotice(message) {
  const box = document.createElement('p'); box.className = 'form-status'; box.setAttribute('role', 'status');
  box.textContent = message; $('#detail .dialog-content').prepend(box);
}
function markDetailFormSaved(form) {
  delete form.dataset.dirty;
  if (!$('#detail').querySelector('form[data-dirty="true"]')) delete $('#detail').dataset.dirty;
}
function deferDetailRefresh() {
  const dialog = $('#detail');
  if (!dialog.dataset.dirty) return false;
  dialog.dataset.refreshPending = 'true';
  if (!$('#detail-refresh-notice')) {
    const box = document.createElement('div'); box.id = 'detail-refresh-notice'; box.className = 'form-status'; box.setAttribute('role', 'status');
    box.innerHTML = '<p>有最新详情等待读取。其他未保存输入已保留；保存完成后会刷新，不会替你自动保存。</p><button type="button" class="button secondary compact" data-action="refresh-detail">放弃未保存修改并刷新</button>';
    $('#detail .dialog-content').prepend(box);
  }
  return true;
}
$('#detail').addEventListener('close', () => {
  // A previous dialog close event may arrive after another job has opened.
  if ($('#detail').open) return;
  const key = detailContext?.key;
  detailRequest++; detailContext = null;
  $('#detail').inert = false;
  delete $('#detail').dataset.dirty;
  delete $('#detail').dataset.refreshPending;
  $('#browse-workspace').classList.remove('has-detail');
  syncDetailSelection();
  const returnButton = detailOpener?.isConnected && detailOpener.getClientRects().length ? detailOpener :
    [...document.querySelectorAll('#browse-list [data-action="detail"], #browse-list [data-action="search-detail"]')].find(button => button.dataset.key === key && button.getClientRects().length);
  if (returnButton) returnButton.focus({preventScroll:true});
  else if (!$('#browse-workspace').hidden) $('#browse-list').focus({preventScroll:true});
  if (view === detailReturnView && !$('#browse-workspace').hidden && matchMedia('(max-width: 900px)').matches) window.scrollTo({top:detailReturnY,behavior:'instant'});
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && $('#detail').open && $('#detail').dataset.layout === 'split' && !document.querySelector('dialog:modal')) {
    event.preventDefault(); requestClose($('#detail'));
  }
});
function fieldTag(text, kind, pending = false) {
  return `<span class="field-tag field-${pending ? 'pending' : kind}">${esc(text)}</span>`;
}
function termText(job) {
  return placementTermText(job);
}
function paginationControls(total, page, pages, prefix) {
  return `<label class="page-size">每页 <select aria-label="${prefix === 'list' ? '已保存列表' : '发现职位'}每页数量" data-page-size>${[10, 20, 50].map(n => `<option value="${n}" ${n === pageSize ? 'selected' : ''}>${n} 条</option>`).join('')}</select></label><span>${total ? `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, total)} / ${total} 条` : '0 条'} · 第 ${page + 1} / ${pages} 页</span><div><button class="button secondary compact" data-action="${prefix}-prev" ${page === 0 ? 'disabled' : ''}>上一页</button> <button class="button secondary compact" data-action="${prefix}-next" ${page + 1 >= pages ? 'disabled' : ''}>下一页</button></div>`;
}
async function refresh() {
  const id = ++refreshId;
  const info = await api('/api/status'); if (id !== refreshId) return;
  status = info; csrf = status.csrf;
  try { const result = await api('/api/jobs'); if (id !== refreshId) return; jobs = result.jobs; connected = true; listError = ''; }
  catch (error) { if (id !== refreshId) return; jobs = []; connected = false; listError = error.message; }
  loadingJobs = false; renderBanner(); render();
  renderSearch();
  if (view === 'resumes') await loadResumeLibrary();
  if (view === 'portal') await loadPortal();
}

async function loadPortal() {
  const request = ++portalLoad, requestedMode = mode;
  $('#portal-list').textContent = '正在读取学校申请记录…';
  try {
    const result = await api('/api/portal');
    if (request !== portalLoad || requestedMode !== mode) return;
    portalJobs = result.jobs; renderPortal();
  } catch (error) { if (request === portalLoad) $('#portal-list').textContent = `读取失败：${error.message}`; }
}
function renderPortal() {
  const filter = $('#portal-filter').value;
  const rows = portalJobs.filter(j => filter === 'all' || (j.summary.category === filter && (filter !== 'unlinked' || j.summary.externalSubmitted)));
  $('#portal-list').innerHTML = rows.length ? `<div class="portal-records">${rows.map(j => `<article class="portal-record"><div><strong>${esc(j.company)}</strong><h3>${esc(j.title)}</h3><p>${esc(j.termLabel || termText(j))} · ${esc(j.location)}</p><div class="portal-statuses"><span class="badge ${j.summary.externalSubmitted ? 'done' : ''}">官网：${j.summary.externalSubmitted ? `已投 ${esc(j.applicationDate)}` : '未确认投递'}</span><span class="badge ${j.summary.category === 'submitted' ? 'done' : ''}">${esc(j.summary.label)}</span></div><p>学校截止：${esc(j.portal?.deadlineText || j.summary.schoolDeadline || '待核实')} · 学校 ID：${esc(j.portal?.id || '未关联')} · 官网截止：${esc(j.summary.employerDeadline || '待核实')}</p></div><div class="form-actions">${j.portal?.url ? `<a class="button secondary" href="${safeUrl(j.portal.url)}" target="_blank" rel="noopener noreferrer">打开学校岗位 ↗</a>` : ''}<button class="button primary" data-action="detail" data-key="${j.key}">${j.portal ? '查看 / 确认学校提交' : '关联学校岗位'}</button></div></article>`).join('')}</div>` : '<div class="empty"><h3>当前范围没有记录</h3><p>可切换到“官网已投 · 尚未关联”或“全部申请记录”，打开详情关联学校岗位。没有学校记录不代表无需提交。</p></div>';
}
function materialSnapshotText(snapshot) {
  if (!snapshot) return '未记录材料版本';
  return snapshot.note || `${snapshot.version?.version || '已保存材料'} · ${Object.values(snapshot.files || {}).map(p => String(p).split(/[\\/]/).pop()).join('、') || '文件未记录'}`;
}
function portalPanel(j) {
  const p = j.portal, s = j.portalSummary;
  const fields = p || { company: j.company, title: j.title, location: j.location, term: j.term === 'Unknown' ? '' : j.term, externalUrl: j.url, requisitionId: j.requisitionId };
  const linkForm = `<form id="portal-link-form"><div class="form-grid">${[['id','学校职位 ID'],['company','学校列出的公司'],['title','学校职位标题'],['location','工作地点（可空）'],['term','入职批次（可空）'],['requisitionId','雇主招聘编号（非学校 ID，可空）']].map(([name,label]) => `<label>${label}<input name="${name}" maxlength="300" value="${esc(fields[name] || '')}" ${['id','company','title'].includes(name) ? 'required' : ''} ${name === 'id' && p ? 'readonly' : ''}></label>`).join('')}<label class="wide">学校岗位链接（可空）<input name="url" type="url" value="${esc(fields.url || '')}"></label><label class="wide">学校提供的雇主申请链接（可空）<input name="externalUrl" type="url" value="${esc(fields.externalUrl || '')}"></label><label>学校截止时间（原文，未知留空）<input name="deadline" value="${esc(fields.deadlineText || fields.deadline || '')}"></label>${!p ? '<label>是否需要学校提交<select name="requirement"><option value="unknown">待确认</option><option value="required">需要</option><option value="not-required">不需要</option></select></label>' : ''}</div><label class="check"><input name="confirmed" type="checkbox" required>我已核对这是同一岗位，学校 ID 与雇主编号没有混淆。</label><button class="button secondary">${p ? '更新学校来源信息' : '保存学校关联'}</button></form>`;
  return `<section class="portal-panel"><h3>学校与官网提交记录</h3><div class="portal-statuses"><span class="badge ${s.externalSubmitted ? 'done' : ''}">官网：${s.externalSubmitted ? `已投 ${esc(j.applicationDate)}` : '未确认投递'}</span><span class="badge ${p?.status === 'submitted' ? 'done' : ''}">${esc(s.label)}</span></div><p>官网截止：${esc(j.deadline || '待核实')} · 学校截止：${esc(p?.deadlineText || p?.deadline || '待核实')}</p>${s.externalSubmitted ? `<p>官网确认时间：${esc(j.externalSubmission?.confirmedAt || '历史记录未保存确认时间')}<br>官网实际材料：${esc(materialSnapshotText(j.externalSubmission?.materials || { files: j.materials, version: j.materialVersion }))}${j.externalSubmission?.receipt ? `<br>官网回执：${esc(j.externalSubmission.receipt)}` : ''}</p>` : ''}
    ${p ? `<p>学校职位 ID：${esc(p.id)} · ${p.url ? `<a href="${safeUrl(p.url)}" target="_blank" rel="noopener noreferrer">打开学校岗位 ↗</a>` : '可在学校按 ID 查找；下方可补充链接'}</p>${s.schoolExpired ? '<p class="badge">学校截止已过；仅可记录真实已完成的提交，不代表学校接受补交。</p>' : ''}
    ${p.status === 'submitted' ? `<div class="hint">学校已交：${esc(p.applicationDate)}<br>确认时间：${esc(p.confirmedAt)}<br>实际材料：${esc(materialSnapshotText(p.materials))}<br>回执：${esc(p.receipt || '未填写')}</div>` : `<form id="portal-requirement-form"><label>学校提交要求<select name="requirement">${[['unknown','待确认'],['required','需要学校提交'],['not-required','不需要学校提交']].map(([v,t]) => `<option value="${v}" ${p.requirement === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label><label class="check"><input name="confirmed" type="checkbox" required>我已核实此岗位的提交要求。</label><button class="button secondary">保存要求</button></form>
    ${p.requirement === 'required' ? `<form id="portal-submit-form"><h4>确认学校实际提交</h4><label>实际提交日期<input name="date" type="date" required></label><label>向学校提交的材料<select name="materialSource">${s.externalSubmitted && j.materials?.resume ? '<option value="external">与官网已投材料相同</option>' : ''}${j.materials?.resume ? '<option value="reviewed">当前已确认保存的材料</option>' : ''}<option value="other">其他版本（下方说明）</option></select></label><label>材料说明 / 额外附件（选其他版本时必填）<input name="materialNote" maxlength="1000" placeholder="例如 CS 简历 9月28日版、成绩单"></label><label>回执编号或成功页说明（可选）<input name="receipt" maxlength="1000"></label><label class="check"><input name="confirmed" type="checkbox" required>我已在学校 portal 完成提交，并核对实际材料。</label><button class="button primary">确认学校已交</button></form>` : ''}<details><summary>编辑学校来源与截止日期</summary>${linkForm}</details>`}
    <details><summary>关联有误？解除后重新关联</summary><form id="portal-unlink-form"><label class="check"><input name="confirmed" type="checkbox" required>确认解除此关联，历史提交与材料快照会保留。</label><button class="button secondary">解除关联</button></form></details>` : `<details ${view === 'portal' ? 'open' : ''}><summary>关联学校岗位</summary><p>已带入官网职位信息，请按学校页面核对；学校 ID、链接和截止日期须另行填写。</p>${linkForm}</details>`}
    ${j.portalHistory?.length ? `<details><summary>学校关联历史（${j.portalHistory.length}）</summary>${j.portalHistory.map(h => `<p>${esc(h.at)} · ${esc({link:'建立关联','refresh-source':'更新来源',requirement:'修改提交要求',submitted:'确认学校提交',unlink:'解除关联'}[h.action] || h.action)} · 原学校 ID ${esc(h.portal?.id || '无')} ${h.portal?.status === 'submitted' ? `· 已交 ${esc(h.portal.applicationDate)} · ${esc(materialSnapshotText(h.portal.materials))}` : ''}</p>`).join('')}</details>` : ''}</section>`;
}
const searchDate = value => value ? /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : new Date(value).toLocaleString('zh-CN', { timeZone: 'America/Toronto' }) : '未提供';
const publicationText = job => { const p = publication(job); return p.at ? `${p.label}：${searchDate(p.at)}${p.dateOnly ? '（未提供具体时间）' : '（多伦多时间）'}` : '发布日期：官方未提供'; };
const modeText = workModeText;
const deadlineDate = value => !value ? '未披露' : /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}（多伦多当日结束）` : searchDate(value);
function directionBadge(job) {
  const classification = job.resumeClassification;
  return `<span class="direction-badge" title="${esc(classification?.basis || '缺少方向依据')}" aria-label="岗位方向">${esc(classification?.label || '方向待判断')}${job.fullJd === false ? ' · 标题初判' : ''}</span>`;
}
function scoreBadge(job) {
  return Number.isFinite(job.match?.score) ? `<span class="match-score">${job.match.score}<small> / 100</small></span>` : '<span class="score-pending">暂不评分</span>';
}
function scoreDetails(job) {
  return `<p><b>简历方向：${esc(job.resumeClassification?.label || '待确认')}</b> · ${esc(job.resumeClassification?.basis || '待分析')}判断，可在准备任务时切换。</p>${matchingDetails(job)}`;
}
function resumeControls(job, source) {
  const school = job.jdSource === 'school' && !job.url;
  if (mode !== 'demo' && (job.availabilityView?.status === 'closed' || job.eligibility?.summary.hardConflict || job.expired || school && (job.schoolAvailabilityView?.expired || job.decision === 'REJECT'))) return `<section class="resume-controls"><h3>已有简历版本</h3><p>停止生成新材料，历史版本仍可预览或下载。</p><button class="button secondary" data-action="resume-versions" data-key="${job.key}">查看已生成版本</button><div id="generate-result" role="status"></div></section>`;
  if ((source === 'discovery' && searchState.state === 'running') || mode === 'demo' || job.identityConflict || job.expired || job.fullJd === false || (source === 'discovery' && job.decision === 'REJECT') || (job.status && !['Queue', '待提交'].includes(job.status))) return '';
  return `<section class="resume-controls"><h3>定制一页简历</h3>${school ? '<p>学校来源材料仅在本机生成、预览与编辑。准备及生成时会检查学校核实是否仍有效。</p>' : ''}<p>${esc(status.resume?.ready ? status.resume.note : status.resume?.reason || '模板尚未就绪')}</p><div class="baseline-summary">${['cs', 'data'].map(track => { const t = status.resume?.tracks?.[track]; return `<p><b>${track.toUpperCase()} 基准</b> · ${esc(t?.name || '未配置')}<small>${esc(t?.version || '最初固定模板')}${t?.ready === false ? ` · ${esc(t.reason)}` : ''}</small></p>`; }).join('')}<button class="text-button" data-action="resumes">管理 / 上传简历 →</button></div><label>生成使用的原始简历<select id="generate-track"><option value="auto">自动：${esc(job.resumeClassification?.label || '待确认')}</option><option value="cs">CS 简历</option><option value="data">Data 简历</option></select></label><div class="form-actions"><button class="button primary" data-action="generate-resume" data-key="${job.key}" data-source="${source}" ${status.resume?.ready ? '' : 'disabled'}>准备简历修改对照</button><button class="button secondary" data-action="resume-versions" data-key="${job.key}">查看已生成版本</button></div><p>原稿只读；新版本保存到本项目。通过原格式与一页检查后提供 DOCX / PDF，申请状态保持不变。</p><div id="generate-result" role="status"></div></section>`;
}
function fileLinks(files) {
  return files.map(f => `<div class="material-file"><div><strong>${esc(f.name)}</strong><small>${esc(f.version || (f.modified ? new Date(f.modified).toLocaleString('zh-CN') : '本次生成'))}</small></div><div class="file-actions">${f.name.endsWith('.pdf') ? `<button class="button secondary compact" data-action="preview-file" data-url="${esc(f.url)}" data-name="${esc(f.name)}" data-version="${esc(f.version || '')}">预览 PDF</button>` : ''}<a class="button secondary compact" href="${esc(f.url)}">下载</a></div></div>`).join('');
}
let resumeEdit = null, resumeProposal = null;
let previewSource = null, previewPage = 1, previewPages = 1, previewRequest = 0;
async function previewFile(file) {
  const url = new URL(file.url, location.origin);
  if (url.origin !== location.origin || !['/api/file', '/api/resume-base/file'].includes(url.pathname)) throw new Error('仅预览本项目的 PDF');
  previewSource = file; previewPage = 1; previewPages = 1;
  const editable = mode === 'live' && url.searchParams.get('name') === 'resume.pdf' && /^resume-\d+-[a-f0-9]{8}$/.test(url.searchParams.get('version') || '');
  url.searchParams.set('preview', '1');
  $('#preview-caption').textContent = `${file.name} · ${file.version || '本次生成'} · 本机查看，未上传外部服务`;
  $('#preview-body').innerHTML = `<div class="preview-actions"><span id="preview-page">正在读取 PDF…</span>${editable ? '<button class="button primary compact" data-action="edit-resume">编辑文字</button><button class="button secondary compact" data-action="resume-review-history">查看修改依据</button>' : ''}<button class="button secondary compact" data-action="preview-prev" disabled>上一页</button><button class="button secondary compact" data-action="preview-next" disabled>下一页</button><button class="button secondary compact" data-action="preview-zoom" aria-pressed="false">放大</button><a class="button secondary compact" href="${esc(url.pathname + url.search)}" target="_blank" rel="noopener">打开 PDF ↗</a><a class="button secondary compact" href="${esc(file.url)}">下载</a></div><div class="pdf-page" id="preview-page-body" role="status">正在本机渲染实际 PDF 页面…</div><p>预览由实际 PDF 渲染，原文档不变。请核对版式与事实内容。</p>`;
  if (!$('#preview').open) $('#preview').showModal();
  else if (!document.activeElement?.closest('#preview')) $('#preview .close').focus();
  await loadPreviewPage();
}
async function loadPreviewPage() {
  const request = ++previewRequest, box = $('#preview-page-body');
  box.textContent = '正在渲染…';
  for (const action of ['preview-prev', 'preview-next']) $(`[data-action="${action}"]`).disabled = true;
  try {
    const result = await api(`${previewSource.url}&render=1&page=${previewPage}`);
    if (request !== previewRequest || !box.isConnected) return;
    previewPages = result.pages;
    $('#preview-page').textContent = `第 ${result.page} / ${result.pages} 页`;
    box.innerHTML = `<img src="${esc(result.image)}" alt="简历 PDF 第 ${result.page} 页，共 ${result.pages} 页">`;
  } catch (error) { if (box.isConnected) box.textContent = error.message; }
  if (request === previewRequest && box.isConnected) {
    $('[data-action="preview-prev"]').disabled = previewPage <= 1;
    $('[data-action="preview-next"]').disabled = previewPage >= previewPages;
  }
}
async function openResumeEditor() {
  const url = new URL(previewSource.url, location.origin);
  const editor = $('#resume-editor');
  resumeEdit = await api(`/api/resume/edit?key=${encodeURIComponent(url.searchParams.get('key'))}&version=${encodeURIComponent(url.searchParams.get('version'))}`);
  delete editor.dataset.dirty;
  $('#editor-body').innerHTML = `<p>正在编辑 ${esc(resumeEdit.track.toUpperCase())} 简历的正文。每个输入框对应原稿的一条内容；自动换行即可，不新增段落。标题、教育和联系方式保持原样。手动输入的事实由你核实。</p><p class="edit-version">来源版本：${esc(resumeEdit.version)}</p><form id="resume-edit-form">${resumeEdit.fields.map(f => `<label class="edit-field">${esc(f.label)}<textarea data-paragraph="${f.paragraph}" rows="3" maxlength="4000" required>${esc(f.text)}</textarea></label>`).join('')}<div class="editor-save"><div id="edit-status" role="status">保存会生成新 DOCX / PDF，旧版本保持不变。</div><button class="button primary" type="submit">保存新版本并预览</button></div></form>`;
  editor.showModal();
  editor.scrollTop = 0;
}
async function refreshScores() {
  try { const result = await api('/api/jobs'); jobs = result.jobs; } catch { /* Connection status is handled by refresh. */ }
  await pollSearch(); render();
}
async function loadResumeLibrary() {
  const box = $('#resume-library-body');
  if (mode !== 'live') { box.innerHTML = '<p>演示模式不使用私人简历，请返回真实工作区。</p>'; return; }
  const library = await api('/api/resume-base');
  box.innerHTML = `<div class="resume-library-grid">${['cs', 'data'].map(track => {
    const current = library.versions.find(v => v.version === library.active[track]);
    const fallback = status.resume?.tracks?.[track];
    const history = library.versions.filter(v => v.track === track && v.version !== current?.version);
    return `<article class="resume-base-card"><div class="base-card-heading"><span class="base-track">${track === 'cs' ? '01 / CS' : '02 / DATA'}</span><span class="badge ${current?.ready || fallback?.ready ? 'ready' : ''}">${current ? current.ready ? '已启用' : '定制暂停' : library.active[track] ? '基准不可用' : fallback?.ready ? '初始模板' : '待上传'}</span></div><h2>${track === 'cs' ? '软件与开发' : '数据与分析'}</h2><div class="base-current"><span class="eyebrow">当前基准</span><h3>${esc(current?.name || fallback?.name || '尚未上传')}</h3><p>${current ? `${esc(searchDate(current.createdAt))} · ${current.format.toUpperCase()} · ${current.pages} 页` : fallback?.ready ? '未上传新文件时，继续使用原有固定模板。' : '上传一页 Word 简历，开始使用此方向。'}</p><p class="base-note">${esc(current?.reason || fallback?.reason || '')}</p>${current ? `<button class="button secondary compact" data-action="preview-file" data-url="${esc(current.preview)}" data-name="${esc(current.name)}" data-version="${current.version}">预览当前基准 ↗</button>` : ''}</div><form class="base-upload" data-resume-track="${track}"><label class="upload-label" for="base-file-${track}"><b>上传新版${track.toUpperCase()} 简历</b><span>Word (.docx) / PDF · 最大 10MB</span></label><input id="base-file-${track}" name="resumeFile" type="file" accept=".docx,.pdf" required><p>上传成功即设为当前基准。PDF 可预览及评分，该方向需补同版 Word 才能定制。</p><button class="button primary" type="submit">上传并设为基准</button><div class="upload-status" role="status"></div></form>${history.length ? `<details class="base-history"><summary>历史基准 · ${history.length} 个版本</summary>${history.map(v => `<div><strong>${esc(v.name)}</strong><small>${esc(searchDate(v.createdAt))} · ${v.format.toUpperCase()}</small><div class="form-actions"><button class="text-button" data-action="preview-file" data-url="${esc(v.preview)}" data-name="${esc(v.name)}" data-version="${v.version}">预览</button><button class="text-button" data-action="activate-base" data-version="${v.version}">重新启用${v.format === 'pdf' ? '（暂停定制）' : ''}</button></div></div>`).join('')}</details>` : ''}</article>`;
  }).join('')}</div><div class="resume-library-note"><b>原版式，原字号，原事实。</b><p>文件仅保存在本项目 private 目录，不发送到模型或 Notion。Word 上传时检查一页；生成后再次检查。复杂格式无法安全编辑时会明确暂停，不回退旧稿。Match Score 读取当前启用的简历；上传或切换后重新计算。</p></div>`;
}
async function saveResumeEditor(form) {
  const editor = $('#resume-editor');
  if (editor.dataset.saving || form.inert) return;
  editor.dataset.saving = 'true';
  const controls = [...form.querySelectorAll('input, select, textarea, button')].map(field => ({ field, disabled: field.disabled }));
  controls.forEach(({ field }) => { field.disabled = true; });
  $('#edit-status').textContent = '正在保存并检查一页与格式，请稍候…';
  let published = false;
  try {
    const edits = Array.from(form.querySelectorAll('textarea')).map(field => ({ paragraph: Number(field.dataset.paragraph), text: field.value }));
    const result = await api('/api/resume/edit', { key: resumeEdit.key, version: resumeEdit.version, sourceHash: resumeEdit.sourceHash, edits });
    published = true;
    delete editor.dataset.dirty;
    editor.close();
    const box = $('#generate-result');
    if (box) box.innerHTML = `<div class="hint">手动新版本已保存 · PDF ${result.validation.pages} 页 · 原格式检查通过。申请状态未改变。</div>${fileLinks(result.files)}`;
    await syncGeneratedMaterials(resumeEdit.key);
    await previewFile({ ...result.files.find(f => f.name === 'resume.pdf'), version: result.version });
  } catch (error) {
    if (published) alert('新版本已保存。自动关联或预览未完成，请重新打开该职位查看最新材料，无需再次保存：' + error.message);
    else $('#edit-status').textContent = `未发布新版本：${error.message}。输入仍保留，可调整后重试。`;
  } finally { delete editor.dataset.saving; controls.forEach(({ field, disabled }) => { field.disabled = disabled; }); }
}

$('#resume-review').addEventListener('change', () => { $('#resume-review').dataset.dirty = 'true'; });
$('#resume-review').addEventListener('submit', async event => {
  if (event.target.id !== 'resume-review-form') return;
  event.preventDefault(); event.stopPropagation();
  const dialog = $('#resume-review'), form = event.target;
  if (dialog.dataset.saving) return;
  const context = { ...resumeProposal };
  dialog.dataset.saving = 'true';
  const controls = [...form.querySelectorAll('input, select, textarea, button')].map(field => ({ field, disabled: field.disabled }));
  controls.forEach(({ field }) => { field.disabled = true; });
  $('#review-status').textContent = '正在按选择生成，并检查原格式与一页限制…';
  let published = false;
  try {
    const decisions = [...form.querySelectorAll('[data-review-group]')].map(select => ({ id: select.dataset.reviewGroup, accepted: select.value === 'apply' }));
    const result = await api('/api/resume/generate', { ...context, decisions, confirmed: form.elements.confirmed.checked });
    published = true;
    delete dialog.dataset.dirty; dialog.close();
    const box = $('#generate-result');
    if (box && detailContext?.key === context.key) box.innerHTML = '<p>已按审阅选择生成，原格式及 PDF 一页检查通过；申请状态未改变。</p>' + fileLinks(result.files);
    await syncGeneratedMaterials(context.key);
    const pdf = result.files.find(f => f.name === 'resume.pdf');
    if (pdf) await previewFile({ ...pdf, version: result.version });
  } catch (error) {
    if (published) alert('材料已生成。自动关联或预览未完成，请重新打开该职位查看最新材料：' + error.message);
    else $('#review-status').textContent = '未发布新版本：' + error.message + '。审阅选择仍保留，可重试；若输入已变化，请关闭后重新准备。';
  } finally { delete dialog.dataset.saving; controls.forEach(({ field, disabled }) => { field.disabled = disabled; }); }
});

function clearViewFilters() {
  for (const id of ['term-filter', 'track-filter', 'duration-filter', 'work-mode-filter', 'location-filter', 'city-filter', 'filter']) $(`#${id}`).value = '';
}
async function revealSaved(key, newlySaved = false) {
  if (!key) throw new Error('保存结果没有职位标识，请刷新 Queue 核实');
  await refresh();
  if (!connected) throw new Error(`保存已返回，但列表刷新失败，请重试刷新，不要重复加入：${listError}`);
  const job = jobs.find(j => j.key === key) || await api(`/api/jobs/${key}`);
  $('#detail').close(); $('#modal').close();
  clearViewFilters(); highlightedKey = key;
  view = appStates.includes(job.status) ? 'applications' : 'queue';
  const ordered = applyView(jobs.filter(j => appStates.includes(job.status) ? appStates.includes(j.status) : j.status === 'Queue'));
  listPage = Math.max(0, Math.floor(ordered.findIndex(j => j.key === key) / pageSize));
  history.replaceState(null, '', `#${view}`); render(); renderSearch();
  if (job.status === '已归档' || job.expired) {
    feedback(`此职位已有记录，当前${job.expired ? '申请已截止' : '已归档'}，未重新加入 Queue。`);
    await detail(key); return;
  }
  feedback(`${newlySaved ? '已保存' : '已定位已有记录'}：${job.title}。位于${view === 'queue' ? '「已保存」' : '「申请记录」'}${mode === 'live' ? '，同步到 Notion Career Queue' : '（演示）'}。已清除筛选，方便找到该职位。`);
  const row = document.querySelector(`[data-job-key="${key}"]`);
  row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  row?.querySelector('.job-title')?.focus({ preventScroll: true });
}
function requestClose(dialog) {
  if (dialog.dataset.saving) return;
  if (dialog.id === 'resume-editor' && dialog.dataset.dirty) {
    $('#edit-status').innerHTML = '有未保存的修改。<button type="button" class="button secondary compact" data-action="continue-edit">继续编辑</button> <button type="button" class="button secondary compact" data-action="discard-edit">放弃修改并关闭</button>';
    $('#edit-status').scrollIntoView({ block: 'nearest' });
    return;
  }
  if (dialog.dataset.dirty && !confirm('有未保存的修改，确定关闭？')) return;
  if (dialog.id === 'detail') detailRequest++;
  dialog.close();
}
for (const dialog of document.querySelectorAll('dialog')) {
  let startedOutside = false;
  const outside = event => { const r = dialog.getBoundingClientRect(); return event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom; };
  dialog.addEventListener('pointerdown', event => { startedOutside = event.target === dialog && outside(event); });
  dialog.addEventListener('click', event => { if (startedOutside && event.target === dialog && outside(event)) requestClose(dialog); startedOutside = false; });
  dialog.addEventListener('cancel', event => { event.preventDefault(); requestClose(dialog); });
  dialog.addEventListener('input', event => { const form = event.target.closest('form'); if (form) { dialog.dataset.dirty = 'true'; form.dataset.dirty = 'true'; } });
}
$('#preview').addEventListener('close', () => { previewRequest++; previewSource = null; $('#preview-body').replaceChildren(); });
function matchingDetails(job) {
  const m = job.match;
  if (!m || m.score == null) return `<div class="hint">Match Score：${esc(m?.reason || '暂不评分')}</div>`;
  return `<section class="match-details"><h3>Match Score · ${scoreBadge(job)}</h3><p><b>评分简历：${esc(m.source?.name || '当前简历')}</b><br>${esc(m.source?.version || '')} · ${esc(m.selection || '')}</p>${m.comparisons?.length > 1 ? `<div class="match-comparisons">${m.comparisons.map(c => `<p><b>${esc(c.source.track.toUpperCase())}：${c.score == null ? '暂不评分' : `${c.score} / 100`}</b> · ${esc(scoreBasisText(c))} · ${esc(c.source.name || c.reason)}<small>${esc(c.source.version || '')}</small></p>`).join('')}</div>` : ''}<p>${esc(m.note)}</p>${scoreComponentsView(m)}<details><summary>查看匹配依据与待核实项（${m.evidenceCount} 项）</summary><h4>简历中的对应内容</h4><ul>${m.matched.length ? m.matched.map(x => `<li><b>${esc(x.name)}</b>${x.level < 1 ? ' · 基础接触，计半项' : ''}<small>${esc(x.evidence)}</small></li>`).join('') : '<li>暂未找到对应证据</li>'}</ul><h4>当前简历未提及</h4><ul>${m.gaps.length ? m.gaps.map(x => `<li>${esc(x.name)}${x.unverified ? ' · 仅原简历列出，案例待核实' : ' · 尚无对应证据'}</li>`).join('') : '<li>已识别项目均有一定证据；不代表所有资格都已符合。</li>'}</ul>${m.checks.length ? `<h4>另需核实的 JD 条件（不计分）</h4><ul>${m.checks.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</details></section>`;
}
function sourceReport(coverage = []) {
  if (!coverage.length) return '';
  return `<details class="source-summary"><summary>查看来源与信息完整度 · ${coverage.length} 类招聘系统</summary><p>以下是全文读取系统，与上方发现入口分开统计。以下按未截止结果统计，包含不符合条件的岗位，不随页面筛选变化；数量不代表市场覆盖率。</p><div class="source-scroll"><table><thead><tr><th>招聘系统</th><th>结果</th><th>完整 JD</th><th>读取失败</th><th>未尝试全文</th><th>有日期</th><th>有时长</th><th>有薪资</th><th>有工作方式</th></tr></thead><tbody>${coverage.map(row => `<tr>${[row.name, row.total, row.fullJd, row.failed, row.unsupported, row.published, row.duration, row.salary, row.workMode].map(value => `<td>${esc(value)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p>未尝试指未适配的来源或链接格式，不代表被阻止或需要付费。字段零值可能表示来源未提供或程序尚未提取。</p></details>`;
}
function sourceLinks(job) {
  return `<p class="source-label">${job.jdSource === 'school' ? '正文来源' : '招聘系统'}：${esc(job.sourceName || '待核实')}${job.discoverySources?.length ? ` · 发现：${esc(job.discoverySources.map(s => s.name).join('、'))}` : ''}${job.sourceLinks?.length > 1 ? ` · ${job.sourceLinks.length} 个来源链接` : ''}</p>${job.duplicateNote && !job.groupedSources ? `<p class="duplicate-note">${esc(job.duplicateNote)}</p>` : ''}${job.sourceLinks?.length ? `<details class="origin-links"><summary>${job.groupedSources ? `已合并 ${job.groupedSources.length} 条记录 · 查看来源与招聘编号` : '查看保留的职位来源链接'}</summary>${job.groupedSources ? `<p>按公司、标题、批次和地点合并展示。正文与字段来自当前主链接，不混合不同来源的要求。</p><ul>${job.groupedSources.map(source => `<li><a href="${safeUrl(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.requisitionId || '招聘编号未提供')}</a> · ${esc(source.salary || '薪资未披露')} · ${esc(durationText(source))} · ${esc(modeText(source))} · 截止：${esc(deadlineDate(source.deadline))}${source.jd ? `<details><summary>此来源 JD</summary><div class="hint">${esc(source.jd)}</div></details>` : ''}</li>`).join('')}</ul>` : ''}<ul>${job.sourceLinks.map(url => `<li><a href="${safeUrl(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a></li>`).join('')}</ul></details>` : ''}`;
}
const discoveryFilterControls = [
  ['term-filter', '入职时间', ''], ['track-filter', '方向', ''], ['duration-filter', '时长', ''],
  ['work-mode-filter', '方式', ''], ['location-filter', '地点', ''], ['city-filter', '城市', ''],
  ['search-filter', '关键词', ''], ['search-kind', '结果类型', 'review'], ['sort-order', '排序', 'match']
];
function renderDiscoveryFilters() {
  const term = $('#term-filter').value;
  $('#discovery-term').textContent = term === 'Unknown' ? '入职时间待核实' : term || '全部入职季 · 2027';
  const active = discoveryFilterControls.filter(([id, , defaultValue]) => $(`#${id}`).value.trim() !== defaultValue);
  $('#active-filters').innerHTML = active.length ? `<div class="filter-chips">${active.map(([id, label]) => {
    const control = $(`#${id}`), value = control.selectedOptions ? control.selectedOptions[0].textContent : control.value.trim();
    const text = `${label}：${value}`;
    return `<button class="filter-chip" data-action="clear-filter" data-filter="${id}" aria-label="${esc(`移除${text}`)}"><span>${esc(text)}</span><span aria-hidden="true">×</span></button>`;
  }).join('')}</div><button class="clear-filters" data-action="reset-filters">一键清空筛选</button>` : '<span class="filters-empty">未设置额外筛选</span>';
}
function savedDiscoveryJob(job) {
  return jobs.find(saved => [job, ...(job.groupedSources || [])].some(source => saved.key === source.key || saved.url === source.url && saved.term === source.term));
}
function discoveryCard(j) {
  const saved = Boolean(savedDiscoveryJob(j));
  const skills = (j.match?.matched || []).filter(s => s.kind === 'skill');
  const term = termText(j);
  return `<article data-job-key="${j.key}" class="discovery-card ${saved ? 'card-saved' : ''}">
    <div class="card-overline"><span class="company-icon">${esc(j.company.slice(0, 1))}</span><strong>${esc(j.company)}</strong><span class="card-state">${saved ? '已保存 ✓' : j.decision === 'REJECT' ? '不符合条件' : j.fullJd ? '完整 JD' : '待补全文'}</span></div>
    <div class="card-title-row"><button class="job-title" data-action="search-detail" data-key="${j.key}">${esc(j.title)}</button><div class="card-score" title="当前简历覆盖分，不代表录取概率">${scoreBadge(j)}<span>${esc(scoreBasisText(j.match))}</span></div></div>
    <div class="card-tags">${directionBadge(j)}${workplaceBadge(j)}<span>${esc(term)}</span>${eligibilityBadge(j)}</div>
    <dl class="card-facts"><div><dt>地点</dt><dd>${esc(j.location || '待核实')}</dd></div><div><dt>时长 / 方式</dt><dd>${esc(durationText(j))} · ${esc(modeText(j))}</dd></div><div><dt>薪资</dt><dd>${esc(j.salary || '未披露')}</dd></div></dl>
    <div class="card-skills"><span>匹配技能</span>${skills.length ? skills.slice(0, 4).map(s => `<span class="skill-chip" title="${esc(s.evidence)}">${esc(s.name)}${s.level < 1 ? ' · 基础' : ''}</span>`).join('') + (skills.length > 4 ? `<span>+${skills.length - 4}</span>` : '') : '<span class="skill-empty">当前简历暂无匹配</span>'}</div>
    <div class="card-dates"><span>${esc(publicationText(j))}</span>${j.deadline ? `<strong>截止 ${esc(deadlineDate(j.deadline))}</strong>` : ''}</div>
    ${j.decision === 'REJECT' || j.fetchError ? `<p class="card-alert">${esc(j.decision === 'REJECT' ? j.reasons[0] : '全文读取失败，查看详情核实')}</p>` : ''}
    <div class="card-actions"><button class="button primary compact" data-action="search-detail" data-key="${j.key}">查看职位 <span aria-hidden="true">↗</span></button><a href="${safeUrl(j.url)}" target="_blank" rel="noopener noreferrer">官网 ↗</a><span class="card-source">${esc(j.sourceName || '来源待核实')}</span></div>
  </article>`;
}
function renderSearch() {
  renderDiscoveryFilters();
  const report = searchState.report, running = searchState.state === 'running';
  document.querySelectorAll('[data-action="search"]').forEach(b => { b.disabled = running; });
  $('#search-tools').hidden = !report;
  $('.discovery-intro').hidden = Boolean(report);
  $('#discovery-count').textContent = report ? '正在筛选…' : running ? '正在搜索…' : '尚未搜索';
  if (!report && searchState.state === 'idle') return;
  const results = report?.results ?? [];
  const recent = j => j.decision !== 'REJECT' && recentPublication(j);
  const accepted = results.filter(j => j.decision !== 'REJECT');
  $('#search-progress').innerHTML = `<div class="search-status${searchState.error ? ' search-error' : ''}"><strong>${esc(searchState.phase || '搜索完成')}</strong>${searchState.error ? `<p>${esc(searchState.error)}。下方保留上次完成的结果，可重试搜索。</p>` : ''}${report ? `<p>扫描 ${report.total} 条公开条目 · ${report.candidates} 条方向 / 地域候选 · ${results.filter(j => j.fullJd).length} 条完整 JD · ${results.filter(recent).length} 条最近 24 小时发布 / 重新发布 · ${results.length - accepted.length} 条不符合求职条件${report.expiredCount ? ` · ${report.expiredCount} 条已截止并剔除` : ''}</p><small>${report.finishedAt ? `完成于 ${esc(searchDate(report.finishedAt))}（多伦多时间）· 5 分钟内复用结果；重新搜索会更新` : '正在读取官方来源，结果会陆续显示'}${report.duplicates ? ` · 合并 ${report.duplicates} 条重复` : ''}</small>${report.errors?.length ? `<p>${esc(report.errors.join('；'))}</p>` : ''}${discoverySourcesView(report)}${sourceReport(report.coverage)}` : '<p>正在连接来源，无需打开搜索网页。</p>'}</div>`;
  if (!running && report) {
    const expanded = $('#search-progress').dataset.expanded === 'true' || Boolean(searchState.error || report.errors?.length);
    const content = $('#search-progress').innerHTML;
    $('#search-progress').innerHTML = `<details class="search-log" ${expanded ? 'open' : ''}><summary>搜索记录与来源覆盖 <span>全部来源结果 · ${esc(searchDate(report.finishedAt))}</span></summary>${content}</details>`;
    $('#search-progress details').addEventListener('toggle', event => { $('#search-progress').dataset.expanded = String(event.target.open); });
  }
  if (!report) { $('#search-results').innerHTML = ''; syncDetailSelection(); return; }
  const query = $('#search-filter').value.trim().toLowerCase(), kind = $('#search-kind').value;
  const filtered = applyView(results.filter(j => (kind === 'rejected' ? j.decision === 'REJECT' : kind === 'ready' ? j.fullJd && j.decision !== 'REJECT' : kind === 'recent' ? recent(j) : j.decision !== 'REJECT') && `${j.company} ${j.title} ${j.location} ${termText(j)} ${(j.indexEvidence?.terms ?? []).join(' ')}`.toLowerCase().includes(query)));
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize)); searchPage = Math.min(searchPage, pages - 1);
  $('#discovery-count').textContent = `${filtered.length} 个结果${running ? ' · 搜索中' : ''}`;
  $('#search-results').innerHTML = filtered.length ? `<div class="discovery-grid">${filtered.slice(searchPage * pageSize, (searchPage + 1) * pageSize).map(discoveryCard).join('')}</div>` : `<div class="search-empty"><h3>${running ? '正在读取…' : kind === 'recent' ? '暂未找到可核实最近 24 小时发布的岗位' : '此筛选下没有结果'}</h3><p>${kind === 'recent' ? '可切换到“候选 · 不限发布日期”；只有日期或未提供日期的岗位仍会保留。' : '可以调整关键词或查看其他结果类型。'}</p></div>`;
  $('#search-pagination').innerHTML = paginationControls(filtered.length, searchPage, pages, 'search');
  syncDetailSelection();
}
async function pollAutomation() {
  const requestId = ++automationPollId;
  try {
    const result = await api('/api/automation');
    if (requestId !== automationPollId) return;
    automationState = result;
    $('.local-label').textContent = !automationState.schedule?.connected ? '本机 · 后台连接待核实' : automationState.schedule.enabled ? '本机 · 自动发现已启用' : '本机 · 自动发现已暂停';
  } catch {
    if (requestId !== automationPollId) return;
    automationState = { ...automationState, schedule: { connected: false, enabled: null, state: 'unavailable', error: '暂时无法读取后台状态，请检查本机服务' } };
    $('.local-label').textContent = '本机 · 后台连接待核实';
  }
  // Capture user changes made while the request was pending, just before rendering.
  const expanded = ['automation-history', 'automation-diagnostics'].filter(name => $(`#automation .${name}`)?.open);
  $('#automation').innerHTML = automationView(automationState);
  for (const name of expanded) { const panel = $(`#automation .${name}`); if (panel) panel.open = true; }
}
async function pollSearch() {
  clearTimeout(searchTimer);
  try { searchState = await api('/api/discovery'); renderSearch(); await pollAutomation(); }
  catch (e) { searchState = { ...searchState, state: 'error', error: e.message, phase: '无法读取搜索进度' }; renderSearch(); }
  searchTimer = setTimeout(pollSearch, searchState.state === 'running' ? 1200 : 30000);
}
function searchDetail(key, updated) {
  detailRequest++;
  $('#detail').dataset.state = 'ready';
  const j = updated || searchState.report?.results.find(x => x.key === key); if (!j) throw new Error('搜索结果已更新，请重新选择');
  const saved = savedDiscoveryJob(j);
  detailContext = { source: 'discovery', key: j.key, job: j };
  delete $('#detail').dataset.dirty;
  delete $('#detail').dataset.refreshPending;
  $('#detail-body').innerHTML = `<div class="dialog-head"><div><span class="eyebrow">自动发现 · ${esc(j.company)}</span><h2 id="detail-title">${esc(j.title)}</h2><p>${j.fullJd ? '已读取官方完整 JD' : '公开来源记录 · 全文尚未取得'}</p></div><button class="close" data-action="close" aria-label="关闭详情">×</button></div><div class="dialog-content">${directionBadge(j)}${workplaceBadge(j)}${jobHighlights(j)}${skillHighlights(j)}${sourceLinks(j)}${fieldEvidenceView(j)}<div class="meta"><span>入职季：${esc(termText(j))}</span><a href="${safeUrl(j.url)}" target="_blank" rel="noopener noreferrer">查看官方岗位 ↗</a></div>${j.decision === 'REJECT' ? `<p class="card-alert">不满足当前筛选条件：${esc(j.reasons[0] || '')}</p>` : ''}<div class="form-actions">${searchState.state === 'running' ? '<p>搜索完成并去重后即可保存或生成材料。</p>' : j.identityConflict || j.decision === 'REJECT' ? '' : saved ? `<button class="button secondary" data-action="show-saved" data-key="${saved.key}">查看已保存职位 · ${esc(saved.status)}</button>` : j.fullJd ? `<button class="button primary" data-action="${connected && mode === 'live' ? 'search-save' : 'search-connect'}" data-key="${j.key}">${connected && mode === 'live' ? '保存到 Queue' : '连接 Notion 后保存'}</button>` : `<button class="button primary" data-action="search-fill" data-key="${j.key}">补充 JD 与核实信息</button>`}</div>${assessmentPanel(j)}${scoreDetails(j)}${resumeControls(j, 'discovery')}${j.fullJd ? `<h3>完整职位描述</h3>${jobDescription(j)}` : `<h3>全文状态</h3><p>${esc(j.fetchError || '该招聘系统暂不支持自动读取全文。基本信息已自动发现，可补充 JD 后入队。')}</p>`}<h3>来源与日期依据</h3><div class="hint">${esc(publicationText(j))}\n申请截止：${esc(deadlineDate(j.deadline))}\n${esc(j.deadlineEvidence || '')}\n索引收录时间：${esc(j.indexEvidence ? searchDate(j.indexEvidence.addedAt) : '此岗位由雇主列表发现')}\n索引标注批次：${esc(j.indexEvidence?.terms?.join(' / ') || '无索引批次')}\n${esc(j.indexEvidence?.note || '')}${j.sourceEvidence ? `\n官方读取时间：${esc(searchDate(j.sourceEvidence.retrievedAt))}\n${esc(j.sourceEvidence.note)}${j.sourceEvidence.publicationError ? `\n${esc(j.sourceEvidence.publicationError)}` : ''}` : ''}</div><p>此结果来自公开招聘信息；尚未生成材料或投递。</p></div>`;
  showDetailSurface();
}
async function refreshAssessmentDetail(context = detailContext, updated) {
  if (!context || !$('#detail').open || detailContext?.key !== context.key || detailContext?.source !== context.source) return false;
  if (deferDetailRefresh()) return false;
  if (context.source === 'queue') {
    if (!await detail(context.key)) return false;
    if (detailContext?.key !== context.key || selected?.key !== context.key) return false;
    jobs = jobs.map(j => j.key === selected.key ? selected : j); render();
  } else {
    const job = updated || await api(`/api/assessment?source=discovery&key=${context.key}`);
    if (!$('#detail').open || detailContext?.key !== context.key || detailContext?.source !== context.source) return false;
    if (deferDetailRefresh()) return false;
    delete $('#detail').dataset.refreshPending;
    if (searchState.report) searchState.report.results = searchState.report.results.map(j => j.key === job.key ? job : j);
    renderSearch(); searchDetail(context.key, job);
  }
  return true;
}
function showModal(title, subtitle, content) {
  delete $('#modal').dataset.dirty;
  $('#modal').classList.remove('school-import-dialog');
  $('#modal-body').innerHTML = `<div class="dialog-head"><div><span class="eyebrow">CAREER QUEUE</span><h2 id="modal-title">${title}</h2><p>${subtitle}</p></div><button class="close" data-action="close" aria-label="关闭弹窗">×</button></div><div class="dialog-content">${content}</div>`;
  $('#modal').showModal();
}
function schoolDetailsForm(j) {
  if (!(j.schoolCandidate || j.jdSource === 'school' && !j.url) || j.status !== 'Queue') return '';
  const form = `<form id="school-details-form"><h3>${j.fullJd ? '补充官网链接' : '补齐职位正文'}</h3>${j.fullJd ? '' : '<label>正文来源<select name="jdSource"><option value="official">官网链接 / 官网 JD</option><option value="school">学校 JD · 无官网链接</option></select></label>'}<label data-school-url>对应官网职位链接<input type="url" name="url" required maxlength="2000" value="${esc(j.pendingSchoolUrl || j.portal?.externalUrl || '')}"></label><label>完整 JD<textarea name="jd" rows="8" maxlength="100000" placeholder="官网链接模式可留空自动读取；学校来源须粘贴完整正文。"></textarea></label><p data-school-note hidden>保存后可阅读和查看匹配；无官网链接时，需本人核实学校仍接受申请后才能生成简历；学校与官网投递状态不变。</p><label class="check"><input type="checkbox" name="confirmed" required>我已核对所提供的链接或正文对应此学校岗位</label><button class="button primary">补齐并保存 JD</button></form>`;
  return j.fullJd ? `<details><summary>补充官网链接（可选）</summary>${form}</details>` : form;
}
function materialForm(j) {
  if (j.jdSource === 'school' && !j.url) return '<p>学校来源材料可在上方生成、预览与编辑；本版暂不上传至 Notion 或设为待提交。学校与官网投递状态保持不变。</p>';
  if (j.fullJd === false) return '<p>补齐完整 JD 后，可以评分和准备申请材料。</p>';
  if (!['Queue', '待提交'].includes(j.status)) return '';
  const generated = j.generatedMaterial?.version ? j.generatedMaterial : null;
  return `<h3>申请材料</h3><form id="materials-form"><div class="hint">${generated ? `已自动关联最新 PDF · ${esc(generated.track.toUpperCase())}<br>${esc(generated.version)}<br>基准：${esc(generated.baseline?.name || '初始模板')}<br>生成或在线编辑后会更新此处，并重新要求确认审阅。` : esc(j.generatedMaterial?.error || '尚无通过检查的定制版本；生成后会自动关联，也可上传自己的 PDF。')}</div>${generated ? `<div class="form-actions"><button type="button" class="button secondary" data-action="preview-file" data-url="${esc(generated.url)}" data-name="resume.pdf" data-version="${generated.version}">预览已关联 PDF</button></div><label>简历来源<select name="materialSource" id="material-source"><option value="generated">使用已关联的定制 PDF</option><option value="upload">改用本机 PDF</option></select></label>` : ''}${generated ? freshnessReview(generated.freshness, { id: 'stale-material-review' }) : ''}<label id="manual-resume-field" ${generated ? 'hidden' : ''}>简历 PDF<input name="resume" type="file" accept=".pdf" ${generated ? '' : 'required'}></label><details class="cover-letter-upload" ${j.coverLetterRequired ? 'open' : ''}><summary>Cover Letter ${j.coverLetterRequired ? '（此岗位必需）' : '（可选）'}</summary><label>Cover Letter PDF<input name="coverLetter" type="file" accept=".pdf" ${j.coverLetterRequired ? 'required' : ''}></label></details><label class="check material-check"><input name="checked" type="checkbox" required>我已预览并检查这份材料的事实与排版，确认用于本职位。</label><p>只提交简历 PDF 和选定的 Cover Letter；DOCX 与修改说明留在本机。${mode === 'demo' ? '演示操作仅保存在本机。' : '确认后保存到 Notion，成功才进入待提交。'}</p><button class="button primary">确认材料，设为待提交</button></form>`;
}
async function syncGeneratedMaterials(key) {
  if (!$('#material-panel') || selected?.key !== key) return;
  try {
    const result = await api(`/api/resume/files?key=${key}&source=queue`);
    if (!$('#material-panel') || selected?.key !== key) return;
    if ($('#materials-form')?.dataset.dirty && deferDetailRefresh()) return;
    selected.generatedMaterial = result.generatedMaterial;
    if (result.assessment) selected.assessment = result.assessment;
    $('#material-panel').innerHTML = materialForm(selected);
  } catch (error) {
    if ($('#material-panel') && selected?.key === key) {
      if ($('#materials-form')?.dataset.dirty && deferDetailRefresh()) return;
      selected.generatedMaterial = null;
      $('#material-panel').innerHTML = `<div class="hint">新版本已保存，但材料区刷新失败：${esc(error.message)}。请重新打开职位详情，再预览并确认材料。</div>`;
    }
  }
}
async function detail(key) {
  if ($('#detail').open && detailContext?.key === key && deferDetailRefresh()) return false;
  delete $('#detail').dataset.refreshPending;
  const requestId = ++detailRequest;
  const requestedView = view, requestedMode = mode;
  const current = () => requestId === detailRequest && view === requestedView && mode === requestedMode;
  selected = null; detailContext = { source: 'queue', key };
  delete $('#detail').dataset.dirty;
  detailFeedback(key);
  let result;
  try { result = await api(`/api/jobs/${key}`); }
  catch (error) { if (current()) detailFeedback(key, error); return false; }
  if (!current()) return false;
  const focus = Boolean(document.activeElement?.closest('#detail'));
  $('#detail').dataset.state = 'ready';
  selected = result;
  const j = selected;
  detailContext = { source: 'queue', key: j.key, job: j };
  delete $('#detail').dataset.dirty;
  $('#detail-body').innerHTML = `<div class="dialog-head"><div><span class="eyebrow">${esc(j.company)}</span><h2 id="detail-title">${esc(j.title)}</h2><p>${esc(termText(j))} · ${esc(j.status)}${mode === 'demo' ? ' · 演示职位' : ''}</p></div><button class="close" data-action="close" aria-label="关闭详情">×</button></div><div class="dialog-content">
    ${directionBadge(j)}${workplaceBadge(j)}${jobHighlights(j)}${skillHighlights(j)}${sourceLinks(j)}${fieldEvidenceView(j)}${j.url ? `<div class="meta"><a href="${safeUrl(j.url)}" target="_blank" rel="noopener noreferrer">查看职位原文 ↗</a></div>` : `<p class="badge">${j.jdSource === 'school' ? '学校来源 · JD 已保存' : '学校候选 · 待补 JD'}</p>`}
    ${j.transferredTo ? `<p class="form-status">学校关联已迁移，原备注和历史保留在此。</p><button class="button secondary" data-action="show-saved" data-key="${esc(j.transferredTo)}">查看关联后的职位</button>` : ''}
    ${[...(j.schoolAssociationHistory || []), ...(j.schoolAssociationTransfer ? [j.schoolAssociationTransfer] : [])].map(t => `<button class="button secondary compact" data-action="detail" data-key="${esc(t.sourceKey)}">查看原学校候选、备注与历史 · ${esc(t.portal?.id)}</button>`).join('')}
    ${schoolDetailsForm(j)}
    <p>${esc(publicationText(j))} · ${esc(modeText(j))}</p>
    ${assessmentPanel(j)}
    ${scoreDetails(j)}
    ${resumeControls(j, 'queue')}
    ${j.expired ? '<div class="hint">申请已截止，保留已有申请记录供追踪。</div>' : ''}
    ${portalPanel(j)}
    ${j.reasons?.length ? `<div class="hint">${esc(j.reasons.join('\n'))}</div>` : ''}
    <div class="form-actions">${j.fullJd !== false && !(j.jdSource === 'school' && !j.url) && ['Queue', '待提交'].includes(j.status) ? `<label>原始简历方向<select id="resume-track"><option value="auto">自动：${esc(j.resumeClassification?.label || '待确认')}</option><option value="cs">CS 简历</option><option value="data">Data 简历</option></select></label><button class="button primary" data-action="prepare">准备定制任务</button>` : ''}${j.status === 'Queue' ? '<button class="button danger" data-action="archive">不投 · 归档</button>' : ''}</div>
    ${j.fullJd !== false && !(j.jdSource === 'school' && !j.url) && ['Queue', '待提交'].includes(j.status) ? '<p>“准备定制任务”另行导出上下文，供助手做进一步审阅或修改；定制请使用上方“准备简历修改对照”，审阅后生成。</p>' : ''}
    <div id="archive-question"></div><div id="prepare-result"></div>${j.fullJd === false ? '' : `<h3>完整职位描述</h3>${jobDescription(j)}`}
    ${j.schoolJd && j.url ? `<details><summary>保留的学校正文</summary><p>学校 ID：${esc(j.schoolJd.schoolId)}</p><div class="hint">${esc(j.schoolJd.text)}</div></details>` : ''}
    <h3>我的备注与下一步</h3><form id="notes-form"><div class="form-grid"><label class="wide">备注<textarea name="notes" maxlength="5000">${esc(j.notes)}</textarea></label><label class="wide">下一步<input name="nextStep" value="${esc(j.nextStep)}" maxlength="5000"></label></div><div class="form-actions"><button class="button secondary">保存备注</button></div></form>
    <hr class="section-line"><h3>材料与版本</h3><div id="files">${j.localFiles.length || j.attachments?.length ? `${fileLinks(j.localFiles)}${(j.attachments ?? []).filter(f => f.url).map(f => `<a class="file-link" href="${safeUrl(f.url)}" target="_blank" rel="noopener noreferrer">↗ Notion · ${esc(f.name)}</a>`).join('')}` : '<p>尚无材料。处理任务文件和上传的简历会按版本保存在这里。</p>'}</div>
    <div id="material-panel">${materialForm(j)}</div>
    ${j.status === '待提交' ? `<hr class="section-line"><h3>确认官网实际投递</h3><form id="submitted-form">${freshnessReview(j.materialFreshness)}<label>实际申请日期<input type="date" name="date" required></label><label>回执编号或成功页说明（可选）<input name="receipt" maxlength="1000"></label><label class="check"><input name="confirmed" type="checkbox" required>我已经在雇主网站完成了这次投递。</label><div class="form-actions"><button class="button primary">确认官网已投递</button></div></form>` : ''}
    ${['已投递', '面试中', '已结束'].includes(j.status) ? `<hr class="section-line"><h3>更新申请进展</h3><form id="progress-form"><div class="form-grid"><label>当前状态<select name="status"><option ${j.status === '面试中' ? 'selected' : ''}>面试中</option><option ${j.status === '已结束' ? 'selected' : ''}>已结束</option></select></label><label>下一步 / 结束原因<input name="nextStep" required value="${esc(j.nextStep)}"></label></div><div class="form-actions"><button class="button secondary">保存进展</button></div></form>` : ''}
    </div>`;
  showDetailSurface({ focus });
  return true;
}
const select = (name, label, options) => `<label>${label}<select name="${name}">${options.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></label>`;
function add() {
  importedSource = null;
  showModal('添加一个职位', '填写或读取完整 JD，预览筛选结果后再加入 Queue。', `<form id="job-form"><div class="form-grid"><label>公司<input name="company" required maxlength="200"></label><label>原始职位名称<input name="title" required maxlength="300"></label><label class="wide">官方职位链接<input name="url" type="url" required placeholder="https://…"></label><div class="wide"><button class="button secondary" type="button" data-action="fetch">从 Greenhouse 链接读取 JD</button><p>其他来源请粘贴正文。读取不会自动入队；发布时间不明会保留标记。</p></div><label class="wide">完整 JD<textarea name="jd" required rows="6" maxlength="25000"></textarea></label><label>实际工作地点<input name="location" placeholder="例如 Toronto, ON"></label>${select('term','开始批次',[['Unknown','待核实'],['Winter 2027','Winter 2027'],['Summer 2027','Summer 2027'],['Fall 2027','Fall 2027'],['Summer/Fall 2027','Summer / Fall 2027']])}${select('workMode','办公方式',[['unknown','待核实'],['hybrid','Hybrid'],['onsite','On-site'],['remote','Remote']])}${select('inGta','是否位于 GTA',[['','待核实'],['true','是'],['false','否']])}<label>任期（月，未知可留空）<input name="durationMonths" type="number" min="1" max="60"></label><label>薪资原文<input name="salary" placeholder="未披露"></label>${select('paid','薪资披露',[['','待核实'],['true','明确有薪'],['false','明确无薪']])}<label>准确发布时间（本机时间，未知留空）<input name="postedAt" type="datetime-local" step="1"></label><label class="wide check"><input name="coverLetterRequired" type="checkbox">岗位明确要求 Cover Letter</label><label class="wide check"><input name="relevant" type="checkbox" required>已核实这是相关方向的 co-op / intern 职位。</label></div><div class="form-actions"><button class="button primary">预览筛选结果</button><button class="button secondary" type="button" data-action="import" hidden>确认加入 Queue</button></div><div id="preview-result" class="result"></div></form>`);
}
function formJob() {
  const f = $('#job-form'), data = Object.fromEntries(new FormData(f));
  return { ...data, isIntern: f.elements.relevant.checked, relevant: f.elements.relevant.checked,
    coverLetterRequired: f.elements.coverLetterRequired.checked ? true : null,
    inGta: data.inGta === '' ? null : data.inGta === 'true', paid: data.paid === '' ? null : data.paid === 'true',
    durationMonths: data.durationMonths ? Number(data.durationMonths) : null,
    postedAt: data.postedAt ? new Date(data.postedAt).toISOString() : null,
    ...(importedSource ? { indexEvidence: importedSource.indexEvidence, requisitionId: importedSource.requisitionId } : {}),
    sourceEvidence: importedSource?.sourceEvidence || '用户通过 Dashboard 输入或核对；未知字段保留待核实。' };
}
async function handle(action, button) {
  if ($('#detail').dataset.saving && button.closest?.('#detail')) return;
  if (['detail', 'search-detail'].includes(action) && $('#detail').open && button.dataset.key === detailContext?.key && (action === 'detail' ? 'queue' : 'discovery') === detailContext?.source) {
    $('#detail-title').focus({ preventScroll: true }); return;
  }
  const leavingDetail = ['discover', 'queue', 'applications', 'resumes', 'portal', 'mode', 'search'].includes(action) ||
    ['detail', 'search-detail', 'show-saved'].includes(action);
  if (leavingDetail && $('#detail').dataset.saving) return;
  if (leavingDetail && $('#detail').dataset.dirty && !confirm('职位中有未保存的修改，确定离开？')) return;
  if (['detail', 'search-detail'].includes(action)) { detailOpener = button; detailReturnY = window.scrollY; detailReturnView = view; }
  if (['discover', 'queue', 'applications', 'resumes', 'portal', 'mode', 'search'].includes(action)) detailRequest++;

  if (action === 'refresh-detail' || action === 'retry-detail') {
    if ($('#detail').dataset.dirty && !confirm('其他输入尚未保存，确定放弃这些修改并读取最新详情？')) return;
    delete $('#detail').dataset.dirty;
    return refreshAssessmentDetail();
  }
  if (action === 'recheck-availability') {
    const context = detailContext;
    if (!context) return;
    const job = await api('/api/assessment/recheck', { source: context.source, key: context.key });
    if (await refreshAssessmentDetail(context, job)) $('#detail .assessment-panel')?.scrollIntoView({ block: 'nearest' });
    else feedback('岗位核查已完成，重新打开对应职位即可查看。');
    return;
  }
  if (action === 'portal-refresh') return loadPortal();
  if (action === 'portal-import') return openPortalImport({ api, esc, showModal, onSaved: async () => { $('#portal-filter').value = 'all'; await refresh(); await loadPortal(); } });
  if (action === 'activate-base') {
    await api('/api/resume-base/activate', { version: button.dataset.version });
    status = await api('/api/status'); csrf = status.csrf;
    await loadResumeLibrary(); await refreshScores(); feedback('已切换当前基准；已生成材料与历史版本保持不变。'); return;
  }
  if (action === 'clear-filter') {
    const control = discoveryFilterControls.find(([id]) => id === button.dataset.filter);
    if (!control) return;
    $(`#${control[0]}`).value = control[2]; searchPage = 0; listPage = 0; render(); renderSearch();
    $(`#${control[0]}`).focus(); return;
  }
  if (action === 'reset-filters') {
    for (const id of ['term-filter', 'track-filter', 'duration-filter', 'work-mode-filter', 'location-filter', 'city-filter', 'filter', 'search-filter']) $(`#${id}`).value = '';
    $('#sort-order').value = 'match'; $('#search-kind').value = 'review'; searchPage = 0; listPage = 0; render(); renderSearch(); return;
  }
  if (action === 'resume-versions') {
    const box = $('#generate-result');
    const result = await api(`/api/resume/files?key=${button.dataset.key}&source=${detailContext?.source || 'queue'}`);
    if (box.isConnected) box.innerHTML = result.files.length ? fileLinks(result.files) : '<p>这个职位还没有通过检查的定制版本。</p>';
    return;
  }
  if (action === 'generate-resume') {
    const context = { key: button.dataset.key, source: button.dataset.source, resumeTrack: $('#generate-track').value, assessmentId: detailContext?.job.assessment?.id };
    const box = $('#generate-result'); box.textContent = '正在准备原文对照，尚未生成文件…';
    try {
      const draft = await api('/api/resume/proposal', context);
      if (!box.isConnected) { feedback('岗位详情已关闭，请重新打开后准备对照。'); return; }
      resumeProposal = { ...context, resumeTrack: draft.track, proposalId: draft.id };
      $('#resume-review-title').textContent = '审阅简历修改';
      $('#resume-review-body').innerHTML = resumeReviewView(draft);
      delete $('#resume-review').dataset.dirty;
      $('#resume-review').showModal(); $('#resume-review').scrollTop = 0; box.textContent = '对照已准备；确认审阅选择后再生成。';
    } catch (error) {
      let refreshed = false;
      try { refreshed = await refreshAssessmentDetail({ source: context.source, key: context.key }); } catch {}
      if (refreshed) dialogError($('#detail'), error); else feedback(error.message, true);
    }
    return;
  }
  if (action === 'resume-review-history') {
    const url = new URL(previewSource.url, location.origin);
    const data = await api('/api/resume/review?key=' + encodeURIComponent(url.searchParams.get('key')) + '&version=' + encodeURIComponent(url.searchParams.get('version')));
    $('#resume-review-title').textContent = '此版本的修改依据';
    $('#resume-review-body').innerHTML = resumeReviewHistory(data);
    delete $('#resume-review').dataset.dirty; $('#resume-review').showModal(); $('#resume-review').scrollTop = 0; return;
  }
  if (action === 'close') { requestClose(button.closest('dialog')); return; }
  if (action === 'continue-edit') { $('#edit-status').textContent = '输入已保留，修改完成后可保存新版本。'; return; }
  if (action === 'discard-edit') { delete $('#resume-editor').dataset.dirty; $('#resume-editor').close(); return; }
  if (action === 'preview-prev' || action === 'preview-next') { previewPage += action === 'preview-prev' ? -1 : 1; return loadPreviewPage(); }
  if (action === 'preview-zoom') { const zoomed = $('#preview-page-body').classList.toggle('zoomed'); button.textContent = zoomed ? '适合宽度' : '放大'; button.setAttribute('aria-pressed', String(zoomed)); return; }
  if (action === 'edit-resume') return openResumeEditor();
  if (action === 'preview-file') return previewFile({ url: button.dataset.url, name: button.dataset.name, version: button.dataset.version });
  if (action === 'show-saved') return revealSaved(button.dataset.key);
  if (['discover', 'queue', 'applications', 'resumes', 'portal'].includes(action)) { if (['discover', 'resumes'].includes(action) && mode === 'demo') { mode = 'live'; await refresh(); } view = action; listPage = 0; history.replaceState(null, '', `#${view}`); $('#filter').value = ''; $('#detail').close(); render(); renderSearch(); window.scrollTo(0, 0); if (view === 'resumes') await loadResumeLibrary(); if (view === 'portal') await loadPortal(); return; }
  if (action === 'mode') { $('#detail').close(); mode = mode === 'demo' ? 'live' : 'demo'; selected = null; $('#feedback').hidden = true; view = 'queue'; await refresh(); return; }
  if (action === 'refresh') { await refresh(); return; }
  if (action === 'detail') return detail(button.dataset.key);
  if (action === 'settings') {
    showModal('连接工作区', '凭证仅保存在本机，页面不会显示你的 token。', `<div class="hint">知识库：${status.knowledgeReady ? '已就位' : '未找到'}\nNotion：${connected && mode === 'live' ? '连接正常' : status.notionConfigured ? '已配置，连接尚待验证' : '尚未配置'}\n项目：${esc(status.root)}</div><ol class="steps"><li>在本机项目 <code>.env</code> 中填写 <code>NOTION_TOKEN</code>。</li><li>在 Notion 中给该 integration 授权访问 Career Queue。</li><li>保存后点击“重新连接”，无需重启页面服务。</li></ol><div class="form-actions"><button class="button primary" data-action="connect">重新连接</button><a class="button secondary" href="${safeUrl(status.notionUrl)}" target="_blank" rel="noopener noreferrer">打开 Notion ↗</a></div><p>自动搜岗无需密钥，可直接使用。已支持本地规则定制与 PDF 预览；可上传审阅后的材料并更新状态。</p>`); return;
  }
  if (action === 'connect') { mode = 'live'; await refresh(); if (!connected) throw new Error(listError); $('#modal').close(); feedback('Notion 连接成功。'); return; }
  if (action === 'automation-toggle') {
    await api('/api/automation/enabled', { enabled: !automationState?.schedule?.enabled });
    await pollAutomation(); return;
  }
  if (action === 'search') {
    $('#detail').close();
    mode = 'live'; view = 'discover'; history.replaceState(null, '', '#discover'); await refresh(); searchPage = 0;
    searchState = await api('/api/discovery', {}); renderSearch();
    $('#discovery').scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (searchState.cached) feedback('已显示 5 分钟内取得的真实结果，无需重复请求来源。');
    if (searchState.state === 'running') searchTimer = setTimeout(pollSearch, 500);
    return;
  }
  if (action === 'list-prev' || action === 'list-next') { listPage += action === 'list-prev' ? -1 : 1; render(); return; }
  if (action === 'search-prev' || action === 'search-next') { searchPage += action === 'search-prev' ? -1 : 1; renderSearch(); return; }
  if (action === 'search-detail') return searchDetail(button.dataset.key);
  if (action === 'search-connect') { $('#detail').close(); return handle('settings', button); }
  if (action === 'search-save') {
    const result = await api('/api/discovery/save', { key: button.dataset.key });
    if (result.errors.length || result.rejected.length) throw new Error(result.errors[0]?.error || result.rejected[0].reasons.join('；'));
    await revealSaved(result.inserted[0]?.key || result.duplicates[0], result.inserted.length > 0); return;
  }
  if (action === 'search-fill') {
    const j = searchState.report.results.find(x => x.key === button.dataset.key);
    $('#detail').close(); add(); importedSource = j;
    const f = $('#job-form');
    for (const name of ['company', 'title', 'url', 'jd', 'location', 'term', 'salary', 'workMode']) if (j[name]) f.elements[name].value = j[name];
    if (j.inGta != null) f.elements.inGta.value = String(j.inGta);
    if (j.durationMonths != null) f.elements.durationMonths.value = j.durationMonths;
    f.elements.relevant.checked = j.relevant === true && j.isIntern === true;
    $('#preview-result').textContent = '已带入自动发现的信息。请粘贴官方全文并核实开始批次，索引批次不会代替官方确认。'; return;
  }
  if (action === 'add') { if ($('#modal').open) $('#modal').close(); add(); return; }
  if (action === 'fetch') {
    const f = $('#job-form');
    const job = await api('/api/fetch', { company: f.elements.company.value, url: f.elements.url.value });
    for (const name of ['title', 'jd', 'location', 'term', 'salary']) if (job[name] && f.elements[name]) f.elements[name].value = job[name];
    if (job.postedAt) { const d = new Date(job.postedAt); f.elements.postedAt.value = new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19); }
    $('#preview-result').textContent = '已读取完整 JD。请核实岗位性质、任期和其他字段后预览。'; return;
  }
  if (action === 'import') {
    if (!$('#job-form').reportValidity()) return;
    const report = await api('/api/ingest', { jobs: [formJob()] });
    if (report.errors.length || report.rejected.length) throw new Error(report.errors[0]?.error || report.rejected[0]?.reasons.join('；'));
    await revealSaved(report.inserted[0]?.key || report.duplicates[0], report.inserted.length > 0); return;
  }
  if (action === 'prepare') { const key = selected.key; let result; try { result = await api(`/api/jobs/${key}/prepare`, { resumeTrack: $('#resume-track').value }); } catch (error) { await detail(key); throw error; } await detail(selected.key); $('#prepare-result').innerHTML = `<div class="hint">${esc(result.resume.track.toUpperCase())} 定制任务已准备好，尚未生成简历。\n请让助手读取：${esc(result.folder)}\n生成并审阅后，在下方上传材料即可转入“待提交”。</div>`; return; }
  if (action === 'archive') {
    $('#archive-question').innerHTML = '<div class="hint">确认不投这个职位？将从列表隐藏，但保留记录用于去重。<div class="form-actions"><button class="button danger" data-action="archive-confirm">确认不投</button><button class="button secondary" data-action="archive-cancel">取消</button></div></div>'; return;
  }
  if (action === 'archive-cancel') { $('#archive-question').replaceChildren(); return; }
  if (action === 'archive-confirm') {
    await api(`/api/jobs/${selected.key}/archive`, { confirmed: true }); $('#detail').close(); await refresh(); feedback('职位已归档；再次发现时不会重新入队。');
  }
}
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]'); if (!button) return;
  button.disabled = true;
  try { await handle(button.dataset.action, button); }
  catch (error) { const dialog = button.closest('dialog'); dialog?.open ? dialogError(dialog, error) : feedback(error.message, true); }
  finally { if (button.isConnected) button.disabled = button.dataset.action === 'search' && searchState.state === 'running' || button.dataset.action === 'preview-prev' && previewPage <= 1 || button.dataset.action === 'preview-next' && previewPage >= previewPages; }
});
document.addEventListener('input', event => {
  if (event.target.closest('#job-form')) { const b = $('[data-action="import"]'); if (b) b.hidden = true; }
  const form = event.target.closest('#school-details-form');
  if (form && ['url', 'jd', 'confirmed', 'jdSource'].includes(event.target.name)) {
    delete form.association; form.querySelector('.school-association')?.remove();
  }
});
document.addEventListener('change', event => {
  if (event.target.name === 'jdSource' && event.target.closest('#school-details-form')) {
    const form = event.target.form, school = event.target.value === 'school';
    form.querySelector('[data-school-url]').hidden = school;
    form.elements.url.disabled = school; form.elements.url.required = !school;
    form.elements.jd.required = school; form.elements.confirmed.checked = false;
    form.querySelector('[data-school-note]').hidden = !school;
    delete form.association; form.querySelector('.school-association')?.remove();
  }
  if (event.target.id === 'material-source') {
    const upload = event.target.value === 'upload', form = $('#materials-form');
    $('#manual-resume-field').hidden = !upload; form.elements.resume.required = upload; form.elements.checked.checked = false;
    const review = $('#stale-material-review');
    if (review) { review.hidden = upload; form.elements.staleReviewed.disabled = upload; form.elements.staleReviewed.required = !upload; form.elements.staleReviewed.checked = false; }
  }
  if (event.target.closest('#materials-form') && ['resume', 'coverLetter'].includes(event.target.name)) $('#materials-form').elements.checked.checked = false;
});
$('#filter').addEventListener('input', () => { listPage = 0; render(); });
$('#portal-filter').addEventListener('change', renderPortal);
document.addEventListener('change', event => {
  if (!event.target.matches('[data-page-size]')) return;
  const value = Number(event.target.value);
  if (![10, 20, 50].includes(value)) return;
  pageSize = value; listPage = 0; searchPage = 0; render(); renderSearch();
});
$('#search-filter').addEventListener('input', () => { searchPage = 0; renderSearch(); });
$('#search-kind').addEventListener('change', () => { searchPage = 0; renderSearch(); });
for (const selector of ['#term-filter', '#track-filter', '#sort-order', '#duration-filter', '#work-mode-filter', '#location-filter']) $(selector).addEventListener('change', () => { searchPage = 0; listPage = 0; render(); renderSearch(); });
$('#city-filter').addEventListener('input', () => { searchPage = 0; listPage = 0; render(); renderSearch(); });
async function base64(file) {
  if (file.size > 20 * 1024 * 1024) throw new Error('单个文件超过 20MB');
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); });
}
document.addEventListener('submit', async event => {
  event.preventDefault(); const form = event.target, button = event.submitter;
  const formDialog = form.closest('dialog');
  const detailForm = formDialog === $('#detail');
  if ((detailForm || form.id === 'resume-edit-form') && (formDialog.dataset.saving || form.inert)) return;
  const lockedForms = detailForm ? [...$('#detail').querySelectorAll('form')].map(form => ({form, inert: form.inert})) : [];
  const buttonText = button?.textContent;
  let saved = false;
  if (detailForm) {
    $('#detail').dataset.saving = 'true'; lockedForms.forEach(({form}) => { form.inert = true; });
    formFeedback(form, '正在保存，请稍候…', 'saving');
    if (button) button.textContent = '正在保存…';
  }
  if (button) button.disabled = true;
  try {
    if (form.classList.contains('base-upload')) {
      const message = form.querySelector('.upload-status');
      message.textContent = '正在保存并检查文档，Word 排版检查可能需要数十秒…';
      try {
        const file = form.elements.resumeFile.files[0];
        if (!file || file.size > 10 * 1024 * 1024) throw new Error('请选择不超过 10MB 的 Word (.docx) 或 PDF');
        const result = await api('/api/resume-base', { track: form.dataset.resumeTrack, name: file.name, data: await base64(file) });
        status = await api('/api/status'); csrf = status.csrf;
        await loadResumeLibrary(); await refreshScores(); feedback(`${result.name} 已设为 ${result.track.toUpperCase()} 基准。${result.ready ? '下次定制将使用此版本。' : result.reason}`);
      } catch (error) { message.textContent = error.message; }
      return;
    }
    if (form.id === 'resume-edit-form') { await saveResumeEditor(form); return; }
    if (form.id === 'resume-review-form') return;
    const values = Object.fromEntries(new FormData(form));
    if (['availability-confirm-form', 'school-availability-confirm-form'].includes(form.id) || form.classList.contains('eligibility-form')) {
      const context = detailContext, eligibility = form.classList.contains('eligibility-form'), school = form.id === 'school-availability-confirm-form';
      if (!context) return;
      const job = await api(`/api/assessment/${eligibility ? 'eligibility' : school ? 'school-confirm' : 'confirm'}`, {
        source: context.source, key: context.key, assessmentId: context.job.assessment?.id,
        confirmed: form.elements.confirmed.checked, note: values.note,
        ...(eligibility ? { requirementId: form.dataset.requirementId, outcome: values.outcome } : school ? { inputHash: context.job.schoolAvailabilityView?.inputHash } : { checkedAt: context.job.availabilityView?.checkedAt })
      });
      saved = true;
      markDetailFormSaved(form);
      if (await refreshAssessmentDetail(context, job)) detailNotice(eligibility ? '已保存本人资格核实；Match Score 保持独立。' : '已记录本人核实，可继续准备材料。'); return;
    }
    if (form.getAttribute('id')?.startsWith('portal-')) {
      const action = { 'portal-link-form': 'link', 'portal-requirement-form': 'requirement', 'portal-submit-form': 'submitted', 'portal-unlink-form': 'unlink' }[form.getAttribute('id')];
      if (!action) return;
      const key = selected.key;
      await api(`/api/jobs/${key}/portal`, { ...values, action, revision: selected.portalRevision,
        confirmed: form.elements.confirmed.checked, ...(action === 'link' ? { row: values } : {}) });
      saved = true;
      markDetailFormSaved(form);
      await refresh(); if (!deferDetailRefresh() && await detail(key)) detailNotice('学校记录已保存；官网申请状态保持不变。'); return;
    }
    if (form.id === 'job-form') {
      const preview = await api('/api/preview', { job: formJob() });
      $('#preview-result').innerHTML = `<div class="hint">${preview.decision === 'REJECT' ? '不满足筛选条件' : preview.decision === 'REVIEW' ? '可入队，需要核实' : '符合已确认条件'}\n${esc(preview.reasons.join('\n'))}</div>`;
      $('[data-action="import"]').hidden = preview.decision === 'REJECT'; return;
    }
    let action, body;
    if (form.id === 'school-details-form') {
      action = 'school-details'; body = { ...values, confirmed: form.elements.confirmed.checked, revision: selected.portalRevision, jdHash: selected.assessment.jdHash };
      if (button?.name === 'transfer' && form.association) {
        action = 'school-transfer'; body = { confirmed: form.elements.transferConfirmed.checked, targetKey: form.association.target.key,
          sourceRevision: form.association.source.revision, targetRevision: form.association.target.revision };
      }
    }
    if (form.id === 'notes-form') { action = 'notes'; body = values; }
    if (form.id === 'materials-form') {
      const files = {}; let total = 0;
      for (const name of ['resume', 'coverLetter']) { if (name === 'resume' && form.elements.materialSource?.value === 'generated') continue; const file = form.elements[name].files[0]; if (file) { total += file.size; files[name] = await base64(file); } }
      if (total > 20 * 1024 * 1024) throw new Error('材料总大小超过 20MB');
      action = 'complete'; body = { files, checked: form.elements.checked.checked, assessmentId: selected.assessment?.id };
      if (form.elements.materialSource?.value === 'generated') body.staleReviewed = form.elements.staleReviewed?.checked === true;
      if (form.elements.materialSource?.value === 'generated') { body.generatedVersion = selected.generatedMaterial.version; body.resumeHash = selected.generatedMaterial.sha256; }
    }
    if (form.id === 'submitted-form') { action = 'submitted'; body = { date: values.date, receipt: values.receipt, confirmed: form.elements.confirmed.checked, assessmentId: selected.assessment?.id, staleReviewed: form.elements.staleReviewed?.checked === true }; }
    if (form.id === 'progress-form') { action = 'progress'; body = values; }
    if (!action) return;
    const result = await api(`/api/jobs/${selected.key}/${action}`, body);
    if (result.association) {
      form.association = result.association;
      form.querySelector('.school-association')?.remove();
      form.insertAdjacentHTML('beforeend', schoolAssociationView(result.association));
      formFeedback(form, '已找到现有职位，尚未修改任何记录。请核对下方对照。');
      form.dataset.focusAssociation = 'true';
      return;
    }
    saved = true;
    markDetailFormSaved(form);
    const key = result.targetKey || selected.key;
    if (action === 'notes') {
      selected = { ...selected, ...values }; detailContext.job = selected;
      jobs = jobs.map(j => j.key === key ? { ...j, ...values } : j);
      render(); renderSearch(); formFeedback(form, '备注已保存。');
      if ($('#detail').dataset.refreshPending && !$('#detail').dataset.dirty) await refreshAssessmentDetail();
      return;
    }
    if (['complete', 'submitted', 'progress'].includes(action)) view = 'applications';
    await refresh();
    if (!deferDetailRefresh() && await detail(key)) detailNotice('已保存。');
  } catch (error) {
    if (detailForm && form.isConnected) formFeedback(form, saved ? `已保存，但页面刷新失败：${error.message}。请重新读取职位核对，不要重复提交。` : `保存结果未确认：${error.message}。输入已保留，请核对后重试。`, 'error');
    else dialogError(formDialog, error);
  }
  finally {
    if (detailForm) {
      delete $('#detail').dataset.saving; lockedForms.forEach(({form, inert}) => { form.inert = inert; });
      if (form.dataset.focusAssociation) { delete form.dataset.focusAssociation; form.querySelector('.school-association h3')?.focus(); }
      if (saved && $('#detail').dataset.state === 'failed') {
        detailNotice('更改已保存，但最新详情尚未读取成功。请重新读取详情，无需再次提交。');
      }
      if (saved && form.isConnected && form.id !== 'notes-form') {
        // The write succeeded even if the subsequent read failed. Do not offer
        // another state-changing submission from this stale form.
        form.inert = true;
        formFeedback(form, $('#detail').dataset.refreshPending ? '本区域已保存；其他输入仍未保存。处理完后会读取最新详情。' : '已保存。请重新读取职位，核对最新状态后再操作。');
        const reload = document.createElement('button'); reload.type = 'button'; reload.className = 'button secondary compact';
        reload.dataset.action = 'refresh-detail'; reload.textContent = $('#detail').dataset.dirty ? '放弃未保存修改并刷新' : '重新读取详情';
        form.nextElementSibling.append(' ', reload);
      }
    }
    if (button) button.disabled = false;
    if (detailForm && button?.isConnected) button.textContent = buttonText;
  }
});
render();
Promise.all([refresh(), pollSearch()]).then(async () => {
  const link = new URLSearchParams(location.search), key = link.get("job"), source = link.get("source");
  if (!key) return;
  if (!/^[a-f0-9]{24}$/.test(key) || !["queue", "discovery"].includes(source)) throw new Error("职位详情链接无效");
  if (source === "discovery") searchDetail(key); else await detail(key);
}).catch(error => { loadingJobs = false; listError = error.message; render(); feedback(`本地服务无法连接：${error.message}`, true); });
