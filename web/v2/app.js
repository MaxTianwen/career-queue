import { batchPreparation } from './batch-preparation.js';
import { filePreview } from './file-preview.js';
import { safeHref } from './safe-url.js';
import { renderFiles } from './files.js';
import { returnGuard, preserveList, viewLoader, viewNavigation, invalidatesViews } from './page-stability.js';
import { mountView } from './opportunity-view.js';
import { schoolRequirement } from './requirements.js';
import {
  scoreRing,
  orderDiscovery,
  discoveryBadge,
  countryCountSummary,
  freshnessSummary,
  publicationSummary,
  deadlineSummary,
  factBadges,
  factsLabel,
  preparationRoute,
  matchesOpportunity,
  mountFilters,
  platform
} from './opportunity.js';
import { applicationWorkspace } from './application.js';
import { schoolWorkspace } from './school.js';
import { refreshController } from './refresh-controller.js';
const $ = selector => document.querySelector(selector);
const fileViewer = filePreview({
  load: (file, signal) => api(`/api/files/${file.id}/view`, { method: 'POST', value: {}, signal }),
  download: downloadFile
});
const viewReads = viewLoader();
const readView = (key, load, options) => viewReads.run(key, load, options);
const reading = new WeakMap();
async function backgroundRead(selector, run) {
  const status = $(selector),
    ticket = { epoch };
  reading.set(status, ticket);
  try {
    await run();
    if (ticket.epoch === epoch && reading.get(status) === ticket) status.dataset.state = 'success';
  } catch (error) {
    if (ticket.epoch === epoch && reading.get(status) === ticket) {
      status.dataset.state = 'error';
      status.textContent = '读取未完成，已有内容保留；可重新切页或手动刷新重试。' + error.message;
    }
  }
}
let reviewedResume = null,
  recommendations = [],
  visibleRecommendations = 20,
  refreshBatch = null;
let emailEnabled = false,
  emailReady = false;
let account = null,
  csrf = '',
  epoch = 0,
  registering = false,
  jobs = [],
  busy = false,
  expiryTimer;
const channel = new BroadcastChannel('career-queue-v2-account');
function clearPrivate(message = '') {
  fileViewer.clear(false);
  batch.clear();
  viewReads.invalidate();
  navigation.reset();
  document.body.classList.remove('session-check');
  $('#workspace').inert = false;
  sessionReturn.stop();
  clearTimeout(expiryTimer);
  updates.stop();
  applications.clear();
  school.clear();
  $('#resume-routing').replaceChildren();
  reviewedResume = null;
  recommendations = [];
  refreshBatch = null;
  $('#resume-text').textContent = '';
  $('#resume-name').textContent = '';
  $('#resume-review').hidden = true;
  $('#job-match').replaceChildren();
  $('#recommendations-list').replaceChildren();
  $('#source-status').replaceChildren();
  $('#show-hidden-jobs').checked = false;
  epoch++;
  account = null;
  csrf = '';
  jobs = [];
  document.body.classList.remove('signed-in');
  $('#workspace').hidden = true;
  $('#account').hidden = true;
  $('#auth').hidden = false;
  $('#admin-panel').hidden = true;
  $('#admin-panel').open = false;
  $('#account-management').hidden = true;
  $('#invitation-list').replaceChildren();
  $('#account-list').replaceChildren();
  $('#invite-result').hidden = true;
  $('#invite-result input').value = '';
  delete $('#invite-form').dataset.requestId;
  fileTrashMode = false;
  $('#username').textContent = '';
  $('#jobs-list').replaceChildren();
  $('#files-list').replaceChildren();
  $('#discovery-history').replaceChildren();
  $('#discovery-status').textContent = '';
  for (const form of document.forms) form.reset();
  for (const e of document.querySelectorAll('.opportunity-filters input,.opportunity-filters select')) {
    if (e.type === 'checkbox') e.checked = false;
    else e.value = e.dataset.defaultValue || '';
  }
  for (const node of document.querySelectorAll('[role=status]')) node.textContent = '';
  $('#job-link').hidden = true;
  $('#job-link').removeAttribute('href');
  authMode(false);
  emailMode();
  $('#notice').textContent = message;
}
const ringContext = match => ({
  reason: match?.reason || '',
  needsResume: Boolean(match?.selection && !match.selection.ready)
});
async function api(path, { method = 'GET', value, file, kind, signal } = {}) {
  const captured = epoch;
  const headers = { 'X-CQ-CSRF': csrf };
  if (value) headers['Content-Type'] = 'application/json';
  if (file) {
    headers['Content-Type'] = 'application/octet-stream';
    headers['X-File-Name'] = encodeURIComponent(file.name);
    if (kind) headers['X-File-Kind'] = kind;
  }
  const response = await fetch(path, {
    method,
    headers,
    signal,
    credentials: 'same-origin',
    cache: 'no-store',
    body: file || (value ? JSON.stringify(value) : undefined)
  });
  // A literal JSON null is a valid answer (e.g. no active resume); only an unparseable body is an error.
  const data = await response.json().catch(() => undefined);
  if (captured !== epoch) throw new Error('账号已切换，请重试');
  if (!response.ok) {
    if (account && [401, 403].includes(response.status)) clearPrivate('会话已结束或账号已切换，请重新登录。');
    throw new Error(data?.error || '请求失败，请重试');
  }
  if (data === undefined) throw new Error('服务响应无法读取，请重试');
  if (invalidatesViews(path, method)) viewReads.invalidate();
  return data;
}
function setBusy(value) {
  busy = value;
  for (const element of document.querySelectorAll('button,input,select,textarea'))
    element.disabled = value || element.dataset.fileDeleteBlocked === 'true' || element.dataset.fileArchived === 'true';
}
async function action(status, run) {
  if (busy) return;
  const captured = epoch,
    statusNode = typeof status === 'string' ? $(status) : status;
  setBusy(true);
  statusNode.dataset.state = 'loading';
  statusNode.setAttribute('aria-busy', 'true');
  statusNode.textContent = '处理中…';
  try {
    await run();
  } catch (error) {
    if (captured === epoch) {
      statusNode.dataset.state = 'error';
      statusNode.textContent = error.message;
    }
  } finally {
    if (statusNode.dataset.state === 'loading') statusNode.dataset.state = 'success';
    statusNode.removeAttribute('aria-busy');
    setBusy(false);
    const focus = statusNode.dataset.focus;
    delete statusNode.dataset.focus;
    if (focus) $(focus)?.focus();
  }
}
function tab(name) {
  navigation.visit(name === 'school' ? 'school-jobs' : name);
}
function renderTab(name) {
  if (name === 'school') name = 'school-jobs';
  const labels = {
    recommendations: ['发现机会', '筛选适合你的机会，直接开始准备。'],
    'school-jobs': ['学校职位', '导入学校列表，与官网申请分开跟进。'],
    applications: ['申请记录', '只记录真实提交；误标可以撤回。'],
    files: ['我的文件', '原始简历与准备好的材料。'],
    jobs: ['准备申请', '围绕这份职位，完成需要的材料。'],
    security: ['账号设置', '管理本机账号。']
  };
  document.body.dataset.view = name;
  $('#view-title').textContent = labels[name]?.[0] || '工作区';
  $('#view-subtitle').textContent = labels[name]?.[1] || '';
  $('#job-detail').hidden = name !== 'jobs';
  if (name !== 'security') $('#password-form').reset();
  $('#resume-review').hidden = name !== 'files' || !reviewedResume;
  for (const item of ['jobs', 'files', 'recommendations', 'applications', 'school', 'school-jobs', 'security']) {
    if (item !== 'school') $(`#${item}-tab`).hidden = item !== name;
    const button = $(`[data-tab="${item}"]`);
    if (item === name) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
}
function selectJob(job, preserveApplication = false) {
  $('#job-detail').hidden = false;
  $('#job-edit-details').open = !job || !job.jd;
  $('#selected-job-summary').textContent = job
    ? job.company + ' · ' + job.title + ' · ' + factsLabel(job)
    : '从链接或 JD 开始准备';
  $('#preparation-route').textContent = preparationRoute(job);
  $('#browser-assistant').hidden = !job || !platform(job.url).questions;
  $('#read-application-form').hidden = !job || !platform(job.url).questions;
  if (preserveApplication)
    applications.refresh().catch(error => {
      $('#application-status').textContent = `职位已保存；材料区刷新失败：${error.message}`;
    });
  else applications.reset(job?.id ?? null);
  const form = $('#job-form');
  form.reset();
  for (const name of ['id', 'company', 'title', 'location', 'url', 'notes', 'jd'])
    form.elements[name].value = job?.[name] ?? '';
  $('#job-mode').textContent = job?.schoolId ? '学校职位 · School ID ' + job.schoolId : job ? '申请草稿' : '新职位';
  $('#back-school-jobs').hidden = !job?.schoolId;
  $('#job-title').textContent = job?.schoolId ? '学校职位与申请准备' : job ? '职位与备注' : '准备职位资料';
  $('#job-status').textContent = '';
  $('#job-match').replaceChildren(matchView(job?.match, job));
  $('#job-link').hidden = !job?.url;
  const jobHref = safeHref(job?.url);
  if (jobHref) $('#job-link').href = jobHref;
  else $('#job-link').removeAttribute('href');
  for (const node of document.querySelectorAll('.job-card'))
    node.setAttribute('aria-pressed', String(node.dataset.id === job?.id));
}
function jobDirty() {
  const form = $('#job-form'),
    original = jobs.find(job => job.id === form.elements.id.value);
  return ['company', 'title', 'location', 'url', 'notes', 'jd'].some(
    name => form.elements[name].value !== (original?.[name] ?? '')
  );
}
function allowJobSwitch() {
  return (!jobDirty() && !applications.dirty()) || window.confirm('这个职位或材料区有未保存的内容。放弃修改并切换？');
}
function drawJobs() {
  $('#job-count').textContent = String(
    jobs.filter(job => !job.hidden && !job.returned && !job.schoolId && !job.eligibilityExclusion).length
  );
  const visible = jobs.filter(
    job =>
      !job.schoolId &&
      !job.eligibilityExclusion &&
      Boolean(job.hidden) === $('#show-hidden-jobs').checked &&
      matchesOpportunity(job, savedFilters())
  );
  $('#saved-filter-count').textContent = `符合筛选 ${visible.length} 个职位`;
  $('#jobs-list').replaceChildren();
  if (!visible.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = $('#show-hidden-jobs').checked
      ? '没有已隐藏职位。'
      : '暂无准备草稿。从下方职位直接开始；这里也会保留原有资料。';
    $('#jobs-list').append(p);
  }
  for (const job of visible) {
    const button = document.createElement('button');
    button.className = 'job-card';
    button.dataset.id = job.id;
    for (const [tag, text] of [
      ['small', job.company],
      ['strong', job.title],
      ['small', job.location || '地点未填写'],
      ['small', factsLabel(job)]
    ]) {
      const node = document.createElement(tag);
      node.textContent = text;
      button.append(node);
    }
    button.addEventListener('click', () => {
      if (allowJobSwitch()) {
        openPreparation(job, 'recommendations');
      }
    });
    const hide = node('button', job.hidden ? '恢复到清单' : '不需要，隐藏');
    hide.className = 'quiet';
    hide.setAttribute('aria-label', (job.hidden ? '恢复 ' : '隐藏 ') + job.company + ' · ' + job.title);
    hide.addEventListener('click', () => {
      if ($('#job-form').elements.id.value === job.id && !allowJobSwitch()) return;
      action('#job-list-status', async () => {
        const saved = await api('/api/jobs/' + job.id + '/visibility', {
          method: 'PUT',
          value: { hidden: !job.hidden }
        });
        jobs = jobs.map(row => (row.id === saved.id ? saved : row));
        if ($('#job-form').elements.id.value === job.id) selectJob(null);
        drawJobs();
        drawRecommendations();
        $('#job-list-status').textContent = saved.hidden
          ? '已隐藏；可在“查看已隐藏”中恢复。材料和投递记录保留。'
          : '已恢复到机会清单。';
      });
    });
    const row = node('div');
    row.append(button);
    const actions = node('div', '', 'actions');
    actions.append(hide);
    row.append(actions);
    $('#jobs-list').append(row);
  }
}
$('#show-hidden-jobs').addEventListener('change', drawJobs);
$('#back-school-jobs').addEventListener('click', () => {
  tab('school-jobs');
  action('#school-jobs-status', school.refreshOpportunities);
});
let fileTrashMode = false;
async function refreshFiles() {
  drawFiles(await api(fileTrashMode ? '/api/files/trash' : '/api/files'));
}
function drawFiles(files) {
  if (fileTrashMode) files = files.filter(file => file.deletedAt);
  $('#toggle-file-trash').textContent = fileTrashMode ? '返回我的文件' : '查看回收站';
  $('#toggle-file-trash').setAttribute('aria-pressed', String(fileTrashMode));
  renderFiles($('#files-list'), files, {
    trash: fileTrashMode,
    view: (file, button) => fileViewer.open(file, button),
    classify: (file, kind) =>
      action('#file-status', async () => {
        await api(`/api/files/${file.id}/kind`, { method: 'PUT', value: { kind } });
        await refreshFiles();
        $('#file-status').textContent = '文件用途已保存';
      }),
    download: file =>
      action('#file-status', async () => {
        await downloadFile(file);
        $('#file-status').textContent = '已交给浏览器下载';
      }),
    parse: file =>
      action('#file-status', async () => {
        reviewedResume = await api(`/api/files/${file.id}/parse`, { method: 'POST', value: {} });
        $('#resume-name').textContent = file.name;
        $('#resume-text').textContent = reviewedResume.text;
        $('#activate-form').reset();
        $('#resume-status').textContent = '';
        $('#resume-review').hidden = false;
        $('#file-status').textContent = '解析完成，请核对下方文字再启用';
        $('#resume-review').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }),
    remove: file =>
      action('#file-status', async () => {
        await api(`/api/files/${file.id}/trash`, {
          method: 'POST',
          value: { confirmed: true, name: file.name, sha256: file.sha256 }
        });
        if (reviewedResume?.fileId === file.id) {
          reviewedResume = null;
          $('#resume-review').hidden = true;
          $('#resume-text').textContent = '';
        }
        $('#file-status').textContent = '已移入回收站，可还原；仍计入存储容量。';
        await refreshFiles();
      }),
    restore: file =>
      action('#file-status', async () => {
        await api(`/api/files/${file.id}/restore`, { method: 'POST', value: {} });
        $('#file-status').textContent = '文件已还原。';
        await refreshFiles();
      })
  });
}
$('#toggle-file-trash').addEventListener('click', () =>
  action('#file-status', async () => {
    const next = !fileTrashMode,
      files = await api(next ? '/api/files/trash' : '/api/files');
    fileTrashMode = next;
    drawFiles(files);
    $('#file-status').textContent = fileTrashMode ? '已显示回收站' : '已显示我的文件';
  })
);
async function downloadFile(file) {
  const captured = epoch;
  const response = await fetch(file.path || `/api/files/${file.id}${file.viewDownload ? '/view-download' : ''}`, {
    headers: { 'X-CQ-CSRF': csrf },
    cache: 'no-store'
  });
  if (!response.ok) {
    if ([401, 403].includes(response.status)) clearPrivate('会话已结束，请重新登录。');
    throw new Error('无法下载，请重新登录或重试');
  }
  const blob = await response.blob();
  if (captured !== epoch) return;
  const link = document.createElement('a'),
    url = URL.createObjectURL(blob);
  link.href = url;
  link.download = file.downloadName || file.name;
  try {
    const encoded = response.headers.get('Content-Disposition')?.split("filename*=UTF-8''")[1];
    if (encoded && !file.downloadName) link.download = decodeURIComponent(encoded);
  } catch {}
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function enter(session) {
  account = session.user;
  csrf = session.csrf;
  clearTimeout(expiryTimer);
  expiryTimer = setTimeout(() => clearPrivate('会话已过期，请重新登录。'), Math.max(0, session.expires - Date.now()));
  const captured = epoch;
  selectJob(null);
  $('#username').textContent = account.username + (account.role === 'admin' ? ' · 管理员' : '');
  $('#admin-panel').hidden = account.role !== 'admin';
  $('#auth-form').reset();
  $('#auth').hidden = true;
  $('#workspace').hidden = false;
  $('#account').hidden = false;
  $('#notice').textContent = '';
  document.body.classList.add('signed-in');
  tab('recommendations');
  void showResumeBindings();
  void backgroundRead('#notice', () =>
    readView('basics', async current => {
      const [rows, files, resume, registration] = await Promise.all([
        api('/api/jobs'),
        api('/api/files'),
        api('/api/resume'),
        account.role === 'admin' ? api('/api/registration') : null
      ]);
      if (captured !== epoch || !current()) return;
      jobs = rows;
      drawJobs();
      fileTrashMode = false;
      drawFiles(files);
      $('#clear-resume').hidden = !resume;
      if (registration) {
        $('#admin-form').elements.registrationOpen.value = String(registration.registrationOpen);
        $('#account-management').hidden = !registration.securityVersion;
      }
      try {
        const draft = jobs.find(job => job.id === sessionStorage.getItem('cq-draft-' + account.id));
        if (draft && document.body.dataset.view === 'recommendations' && !jobDirty()) openPreparation(draft);
      } catch {}
    })
  );
  void backgroundRead('#recommendation-status', () => loadRecommendations(false));
  void updates.refresh('open');
}
function registrationState(settings) {
  emailEnabled = !!settings?.emailVerification;
  emailReady = !!settings?.emailReady;
  $('#email-tools').hidden = !emailEnabled;
  $('#auth-toggle').hidden = !settings?.registrationOpen || (emailEnabled && !emailReady);
  $('#registration-status').textContent = !settings
    ? '注册状态读取失败，请刷新页面重试；已有账号仍可尝试登录。'
    : emailEnabled && !emailReady
      ? '暂不开放注册。邮件尚未接入，忘记密码请联系维护人员。'
      : settings.registrationOpen
        ? emailEnabled
          ? '注册后验证邮箱，再登录。'
          : '开放自行注册：最多30个普通账号。'
        : '当前尚未开放自行注册；已有账号仍可登录。';
}
function authMode(value, invite = false) {
  registering = value;
  $('#email-status').textContent = '';
  $('#auth-email-field').hidden = !(registering && emailEnabled);
  $('#auth-form').elements.email.required = registering && emailEnabled;
  $('#auth-password-field').hidden = registering && emailEnabled;
  $('#auth-form').elements.password.required = !(registering && emailEnabled);
  $('#auth-invite').textContent = value ? '返回登录' : '已有邀请码？使用邀请注册';
  $('#invitation-field').hidden = !invite;
  $('#auth-form').elements.invitation.required = invite;
  $('#auth-form').elements.invitation.value = '';
  $('#auth-title').textContent = registering ? '注册普通账号' : '登录工作区';
  $('#auth-submit').textContent = registering ? (emailEnabled ? '申请验证邮件' : '注册并登录') : '登录';
  $('#auth-toggle').textContent = registering ? '已有账号？返回登录' : '没有账号？自行注册';
  $('#auth-form').elements.password.autocomplete = registering ? 'new-password' : 'current-password';
  $('#auth-status').textContent = '';
}
$('#auth-toggle').addEventListener('click', () => authMode(!registering));
$('#auth-invite').addEventListener('click', () => {
  authMode(!registering, !registering);
  $('#auth-form').elements.username.focus();
});
$('#password-form').addEventListener('submit', event => {
  event.preventDefault();
  action('#password-status', async () => {
    const form = event.target;
    try {
      if (!form.elements.saved.checked) throw new Error('请先保存其他页面的修改，再确认退出登录');
      await api('/api/account/password', {
        method: 'POST',
        value: Object.fromEntries(
          ['currentPassword', 'newPassword', 'confirmPassword'].map(name => [name, form.elements[name].value])
        )
      });
      clearPrivate('密码已修改，请用新密码重新登录。');
      channel.postMessage('changed');
      $('#auth-form').elements.username.focus();
    } finally {
      for (const name of ['currentPassword', 'newPassword', 'confirmPassword']) form.elements[name].value = '';
    }
  });
});
$('#admin-form').addEventListener('submit', event => {
  event.preventDefault();
  action('#admin-status', async () => {
    const registrationOpen = event.target.elements.registrationOpen.value === 'true';
    await api('/api/admin/registration', { method: 'PUT', value: { registrationOpen } });
    registrationState(await api('/api/registration'));
    if (!registrationOpen) authMode(false);
    $('#admin-status').textContent = registrationOpen ? '已开放注册' : '已关闭注册；已有账号仍可登录';
  });
});
$('#auth-form').addEventListener('submit', event => {
  event.preventDefault();
  action('#auth-status', async () => {
    const form = event.target;
    const result = await api(registering ? '/api/register' : '/api/login', {
      method: 'POST',
      value: {
        username: form.elements.username.value,
        password: form.elements.password.value,
        ...(registering && emailEnabled ? { email: form.elements.email.value } : {}),
        ...(!$('#invitation-field').hidden ? { invitation: form.elements.invitation.value.trim() } : {})
      }
    });
    form.elements.password.value = '';
    if (registering && emailEnabled) {
      $('#email-tools').open = true;
      $('#email-form').elements.username.value = form.elements.username.value;
      $('#email-form').elements.email.value = form.elements.email.value;
      $('#email-form').elements.action.value = 'verify';
      emailMode();
      $('#auth-status').textContent = result.message;
      $('#auth-status').dataset.focus = '#email-code-field input';
      return;
    }
    channel.postMessage('changed');
    try {
      await enter(result);
    } catch (error) {
      clearPrivate(`账号已登录，但工作区读取失败。请重新登录重试：${error.message}`);
    }
  });
});
function emailMode() {
  const form = $('#email-form'),
    kind = form.elements.action.value,
    finish = ['verify', 'reset'].includes(kind);
  for (const [id, name, show] of [
    ['email-name-field', 'username', kind === 'resend'],
    ['email-address-field', 'email', !finish],
    ['email-code-field', 'code', finish],
    ['email-password-field', 'password', finish],
    ['email-confirm-field', 'confirmPassword', finish]
  ]) {
    $('#' + id).hidden = !show;
    form.elements[name].required = show;
  }
  $('#email-submit').textContent = {
    verify: '验证邮箱并创建账号',
    resend: '重发验证邮件',
    request: '申请找回邮件',
    reset: '重置密码并退出旧会话'
  }[kind];
  $('#email-status').textContent = '';
}
$('#email-form').elements.action.addEventListener('change', () => {
  for (const name of ['code', 'password', 'confirmPassword']) $('#email-form').elements[name].value = '';
  emailMode();
});
$('#email-form').addEventListener('submit', event => {
  event.preventDefault();
  action('#email-status', async () => {
    const form = event.target,
      kind = form.elements.action.value,
      finish = ['verify', 'reset'].includes(kind);
    const path = {
      verify: '/api/email/verify',
      resend: '/api/email/resend',
      request: '/api/password/request',
      reset: '/api/password/reset'
    }[kind];
    const value = Object.fromEntries(
      (finish ? ['code', 'password', 'confirmPassword'] : kind === 'resend' ? ['username', 'email'] : ['email']).map(
        name => [name, form.elements[name].value]
      )
    );
    const result = await api(path, { method: 'POST', value });
    if (finish) {
      for (const name of ['code', 'password', 'confirmPassword']) form.elements[name].value = '';
      authMode(false);
      channel.postMessage('changed');
      $('#email-status').dataset.focus = '#auth-form input[name=username]';
    }
    $('#email-status').textContent = result.message;
  });
});
// Management metadata only; no private workspace browsing or password reset endpoint.
async function securityLists() {
  const [invitations, users] = await Promise.all([api('/api/admin/invitations'), api('/api/admin/accounts')]);
  const list = $('#invitation-list');
  list.replaceChildren(node('h4', '邀请'));
  if (!invitations.length) list.append(node('p', '尚无邀请', 'muted'));
  for (const invite of invitations) {
    const row = node('p'),
      active = !invite.usedBy && !invite.revoked && invite.expires > Date.now();
    row.append(
      node(
        'span',
        invite.username +
          ' · ' +
          (invite.usedBy ? '已使用' : invite.revoked ? '已撤销' : active ? '待使用' : '已过期') +
          ' · ' +
          new Date(invite.expires).toLocaleString()
      )
    );
    if (active) {
      const button = node('button', '撤销邀请');
      button.type = 'button';
      button.addEventListener('click', () => {
        if (!window.confirm('撤销 ' + invite.username + ' 的邀请？')) return;
        action('#security-status', async () => {
          await api('/api/admin/invitations/' + invite.id + '/revoke', { method: 'POST', value: { confirmed: true } });
          $('#invite-result').hidden = true;
          $('#invite-result input').value = '';
          delete $('#invite-form').dataset.requestId;
          await securityLists();
          $('#security-status').textContent = '邀请已撤销';
        });
      });
      row.append(button);
    }
    list.append(row);
  }
  const accounts = $('#account-list');
  accounts.replaceChildren(node('h4', '账号'));
  for (const user of users) {
    const row = node('p');
    row.append(
      node(
        'span',
        user.username + ' · ' + (user.role === 'admin' ? '管理员' : user.disabledAt !== null ? '已停用' : '普通账号')
      )
    );
    if (user.role === 'member') {
      const disabled = user.disabledAt === null,
        button = node('button', disabled ? '停用账号' : '恢复账号');
      button.type = 'button';
      button.addEventListener('click', () => {
        if (!window.confirm((disabled ? '停用 ' : '恢复 ') + user.username + '？原数据保留，旧会话将失效。')) return;
        action('#security-status', async () => {
          await api('/api/admin/accounts/' + user.id + '/status', {
            method: 'PUT',
            value: { disabled, revision: user.revision, confirmed: true }
          });
          await securityLists();
          $('#security-status').textContent = disabled ? '账号已停用，原数据保留' : '账号已恢复，请本人重新登录';
        });
      });
      row.append(button);
    }
    accounts.append(row);
  }
}
$('#security-reload').addEventListener('click', () =>
  action('#security-status', async () => {
    await securityLists();
    $('#security-status').textContent = '邀请与账号已刷新';
  })
);
$('#invite-form').elements.username.addEventListener('input', () => {
  delete $('#invite-form').dataset.requestId;
});
$('#invite-form').addEventListener('submit', event => {
  event.preventDefault();
  action('#security-status', async () => {
    const form = event.target;
    if (!form.elements.confirmed.checked) throw Error('请确认创建邀请');
    $('#invite-result').hidden = true;
    $('#invite-result input').value = '';
    const requestId = form.dataset.requestId || (form.dataset.requestId = crypto.randomUUID());
    const result = await api('/api/admin/invitations', {
      method: 'POST',
      value: { username: form.elements.username.value.trim(), confirmed: true, requestId }
    });
    delete form.dataset.requestId;
    $('#invite-result input').value = result.code;
    $('#invite-result').hidden = false;
    form.reset();
    $('#security-status').textContent = '邀请已创建；仅显示一次，有效期24小时。';
    try {
      await securityLists();
    } catch {
      $('#security-status').textContent = '邀请已创建，但列表刷新失败；请保存上方邀请码，不要重复创建。';
    }
  });
});
$('#logout').addEventListener('click', () =>
  action('#notice', async () => {
    await api('/api/logout', { method: 'POST', value: {} });
    clearPrivate('已退出登录。');
    channel.postMessage('changed');
    $('#auth-form').elements.username.focus();
  })
);
$('#job-form').addEventListener('submit', event => {
  event.preventDefault();
  action('#job-status', async () => {
    const form = event.target,
      id = form.elements.id.value;
    const value = Object.fromEntries(
      ['company', 'title', 'location', 'url', 'notes', 'jd'].map(name => [name, form.elements[name].value])
    );
    const saved = await api(id ? `/api/jobs/${id}` : '/api/jobs', { method: id ? 'PUT' : 'POST', value });
    jobs = [saved, ...jobs.filter(job => job.id !== saved.id)];
    drawJobs();
    selectJob(saved, Boolean(id));
    $('#job-status').textContent = '准备草稿已更新，尚未提交';
    try {
      sessionStorage.setItem('cq-draft-' + account.id, saved.id);
    } catch {}
  });
});
for (const formId of ['file-form', 'cover-file-form'])
  $('#' + formId).addEventListener('submit', event => {
    event.preventDefault();
    action('#file-status', async () => {
      const file = event.target.elements.file.files[0];
      if (!file || file.size > 5 * 1024 * 1024) throw new Error('请选择不超过 5MB 的 PDF 或 DOCX');
      await api('/api/files', {
        method: 'POST',
        file,
        kind: event.target.id === 'cover-file-form' ? 'cover' : 'resume'
      });
      event.target.reset();
      $('#file-status').textContent = '原件已保存';
      try {
        fileTrashMode = false;
        drawFiles(await api('/api/files'));
      } catch {
        $('#file-status').textContent = '原件已保存，但列表刷新失败。请重新登录查看，不必重复上传。';
      }
    });
  });
$('#job-form').elements.jd.addEventListener('input', () => {
  $('#job-match').replaceChildren(node('p', 'JD 已修改；保存后重新计算匹配度', 'muted'));
});
$('#new-job').addEventListener('click', () => {
  if (allowJobSwitch()) {
    tab('jobs');
    selectJob(null);
    $('#job-form').elements.company.focus();
  }
});
function readTab(name) {
  if (name === 'recommendations') void backgroundRead('#recommendation-status', () => loadRecommendations(false));
  if (name === 'school-jobs') void backgroundRead('#school-jobs-status', () => school.refreshOpportunities(false));
  if (name === 'applications') void backgroundRead('#applications-status', () => applications.records(false));
}
const navigation = viewNavigation({
  render: renderTab,
  read: readTab,
  restore: name => $(name === 'jobs' ? '#selected-job-summary' : '#view-title').focus({ preventScroll: true }),
  views: ['recommendations', 'school-jobs', 'applications', 'files', 'jobs', 'security']
});
for (const button of document.querySelectorAll('[data-tab]'))
  button.addEventListener('click', () => {
    tab(button.dataset.tab);
    readTab(button.dataset.tab);
  });
channel.addEventListener('message', () => clearPrivate('其他页面的账号已变化，请重新登录。'));
const sessionReturn = returnGuard({
  validate: async () => {
    const captured = epoch,
      expected = account?.id,
      current = await api('/api/session');
    return captured === epoch && current.user.id === expected && current.csrf === csrf;
  },
  mask: value => {
    document.body.classList.toggle('session-check', value);
    $('#workspace').inert = value;
  },
  clearPreview: () => applications.clearPreview(),
  invalid: () => clearPrivate('会话已变化，请重新登录。')
});
window.addEventListener('pagehide', () => sessionReturn.hide());
window.addEventListener('pageshow', event => {
  if (event.persisted && account) void sessionReturn.show();
});
document.addEventListener('visibilitychange', () => {
  if (!account) return;
  if (document.hidden) sessionReturn.leave();
  else void sessionReturn.resume();
});
async function boot() {
  setBusy(true);
  try {
    const [settings, session] = await Promise.allSettled([api('/api/registration'), api('/api/session')]);
    registrationState(settings.status === 'fulfilled' ? settings.value : null);
    $('#auth-invite').hidden =
      settings.status !== 'fulfilled' || !settings.value.securityVersion || (emailEnabled && !emailReady);
    if (session.status === 'rejected') throw session.reason;
    await enter(session.value);
  } catch (error) {
    clearPrivate(error.message === '请重新登录' ? '' : `工作区读取失败：${error.message}`);
  } finally {
    setBusy(false);
  }
}

function node(tag, text, className) {
  const el = document.createElement(tag);
  el.textContent = text;
  if (className) el.className = className;
  return el;
}
function matchView(match, job, { showScore = true } = {}) {
  const box = node('div', '', 'match-view');
  if (showScore) box.append(scoreRing(match?.score, ringContext(match)));
  if (!match) return box;
  if (match.selection) {
    const s = match.selection;
    box.append(
      node(
        'p',
        s.classification.label +
          ' · ' +
          (s.mode === 'manual' ? '单岗覆盖' : s.mode === 'legacy' ? '旧版单简历' : '按JD职责选择'),
        'resume-routing-summary'
      ),
      node('p', s.reason || s.classification.basis, 'muted')
    );
    for (const line of Object.values(s.classification.evidence).flat()) box.append(node('small', 'JD依据：' + line));
  }
  if (job) {
    const choose = node('button', '选择／覆盖本岗简历');
    choose.type = 'button';
    choose.addEventListener('click', () => openResumeChoice(job, box));
    box.append(choose);
  }

  if (match.reason) box.append(node('p', match.reason, 'muted'));
  if (match.source)
    box.append(
      node(
        'small',
        `基于 ${match.source.name} · 简历 ${match.source.textHash.slice(0, 8)} · JD ${match.source.jdHash.slice(0, 8)}`
      )
    );
  if (typeof match.score === 'number' && Number.isFinite(match.score)) {
    const detail = document.createElement('details');
    detail.append(node('summary', '匹配依据与未体现要求'));
    detail.append(
      node('p', '这是本地规则的文字覆盖参考，不是雇主 ATS 分数或录取概率；简历未体现不等于不会。', 'muted')
    );
    for (const item of [...(match.matched || []), ...(match.gaps || [])]) {
      detail.append(
        node('strong', `${item.name} · ${item.level > 0 ? (item.level < 1 ? '基础接触' : '有证据') : '未体现'}`)
      );
      detail.append(node('p', item.evidence || '当前简历没有对应文字', 'quote'));
      for (const requirement of item.jdEvidence || []) detail.append(node('p', `JD：${requirement.quote}`, 'quote'));
    }
    box.append(detail);
  }
  return box;
}
$('#prepare-baseline').addEventListener('click', () => {
  if (allowJobSwitch()) tab('files');
});
let returnTab = 'recommendations',
  returnPosition = 0,
  returnFocus = null;
function openPreparation(job, from = 'recommendations') {
  returnPosition = window.scrollY;
  returnFocus = document.activeElement;
  returnTab = from;
  try {
    sessionStorage.setItem('cq-draft-' + account.id, job.id);
  } catch {}
  tab('jobs');
  selectJob(job);
  $('#job-detail').scrollIntoView({ block: 'start' });
  $('#selected-job-summary').focus();
}
$('#back-opportunities').addEventListener('click', () => {
  if (allowJobSwitch()) {
    try {
      sessionStorage.removeItem('cq-draft-' + account.id);
    } catch {}
    tab(returnTab);
    window.scrollTo(0, returnPosition);
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  }
});
const batch = batchPreparation({
  host: $('#recommendations-list'),
  api,
  inspectJob: (job, choose = false, detail) => {
    detail.hidden = false;
    detail.replaceChildren(matchView(job.match, job, { showScore: false }), node('pre', job.jd || '暂无完整JD'));
    detail.tabIndex = -1;
    detail.focus({ preventScroll: true });
    if (choose) openResumeChoice(job, detail.querySelector('.match-view'));
  },
  preview: file => fileViewer.open(file),
  download: downloadFile,
  openJob: async id => {
    if (!allowJobSwitch()) return;
    const job = await api('/api/jobs/' + id);
    jobs = [job, ...jobs.filter(j => j.id !== id)];
    drawJobs();
    openPreparation(job);
  },
  changed: () => drawRecommendations()
});
const discoveryFilters = mountFilters($('#discovery-filters'), () => {
  visibleRecommendations = 20;
  drawRecommendations();
});
const discoveryView = mountView($('#recommendations-list'), 'discovery', drawRecommendations);
const savedFilters = mountFilters($('#saved-filters'), drawJobs, { publication: false });
let discoveryRevision = 0,
  discoveryRunning = false;
function showRefresh(data) {
  const el = $('#refresh-status'),
    last = data.runs?.at(-1);
  if (typeof data.running === 'boolean') discoveryRunning = data.running;
  el.dataset.state =
    data.error || ['failed', 'interrupted'].includes(last?.status) ? 'error' : data.running ? 'loading' : 'success';
  el.textContent = data.error
    ? '更新暂未完成 · ' + data.error + ' · 保留已有岗位，可点击重试。'
    : data.running
      ? '正在更新公开岗位 · 可以继续浏览'
      : last && ['failed', 'interrupted'].includes(last.status)
        ? '上次更新未完成 · 已保留已有岗位，点击刷新重试'
        : last?.finishedAt
          ? '最近更新 ' +
            new Date(last.finishedAt).toLocaleString() +
            (last.status === 'partial' ? ' · 部分来源待重试' : '')
          : '打开时刷新 · 尚无更新记录';
  $('#refresh-sources').textContent = data.running ? '查看更新进度' : '刷新岗位';
}
async function loadDiscoveryStatus() {
  const revision = ++discoveryRevision;
  const data = await api('/api/discovery/status');
  if (revision !== discoveryRevision) return data;
  showRefresh(data);
  $('#discovery-status').textContent = '打开应用时更新，也可手动刷新；无后台每日计划。';
  $('#discovery-history').replaceChildren(
    ...data.runs
      .slice(-10)
      .reverse()
      .map(run =>
        node(
          'p',
          new Date(run.startedAt).toLocaleString() +
            ' · ' +
            ({ open: '打开应用', manual: '手动', scheduled: '历史定时' }[run.trigger] || run.trigger) +
            ' · ' +
            { running: '正在更新', done: '完成', partial: '部分完成', failed: '失败', interrupted: '中断' }[
              run.status
            ] +
            (run.count != null ? ' · ' + run.count + ' 条 / 新增 ' + run.added : '')
        )
      )
  );
  return data;
}
const updates = refreshController({
  request: trigger => api('/api/recommendations/update', { method: 'POST', value: { trigger } }),
  status: loadDiscoveryStatus,
  updated: () => {
    viewReads.invalidate('discovery');
    return loadRecommendations();
  },
  changed: showRefresh
});
let recommendationRevision = 0;
function loadRecommendations(force = true) {
  return readView('discovery', readRecommendations, { force });
}
async function readRecommendations(current) {
  const revision = ++recommendationRevision,
    captured = epoch;
  const [data, exclusions] = await Promise.all([api('/api/recommendations'), api('/api/eligibility/exclusions')]);
  if (!current() || revision !== recommendationRevision || captured !== epoch) return;
  recommendations = data.jobs;
  refreshBatch = data.refreshBatch || null;
  $('#recommendation-status').textContent = data.unsupportedType
    ? '已保存的职位类型超出本期范围，请在求职偏好中重新选择。'
    : data.finishedAt
      ? `去重库 ${data.total ?? data.jobs.length} 条 · 截止与偏好筛选后 ${data.jobs.length} 条 · 最近刷新 ${new Date(data.finishedAt).toLocaleString()}`
      : '尚未读取公开列表，点击“刷新公开来源”开始。';
  $('#source-status').replaceChildren(
    ...data.sources.map(source =>
      node(
        'p',
        `${source.name} · ${{ complete: '完整读取', partial: '部分读取', failed: '读取失败' }[source.status] || '待核实'} · 读取 ${source.raw ?? source.count} 条，范围内 ${source.count} 条 · ${source.detailed ?? 0} 条正文${source.error ? ' · ' + source.error : ''}`
      )
    )
  );

  $('#eligibility-exclusions').replaceChildren(
    ...exclusions.map(row =>
      node(
        'p',
        `${row.company} · ${row.title} · ${row.reason.reason || '明确仅限加拿大公民'} · ${row.reason.quote || (row.reason.evidence || []).join(' ')}`
      )
    )
  );
  $('#eligibility-filter-note').hidden = !exclusions.length;
  preserveList($('#recommendations-list'), drawRecommendations);
}
function drawRecommendations() {
  const rulesOpen = $('#discovery-rules')?.open || false;
  $('#recommendations-list').replaceChildren();
  const candidates = recommendations.filter(
    job => !jobs.some(saved => (job.draftIds || []).includes(saved.id) && saved.hidden)
  );
  const now = Date.now(),
    filters = { ...discoveryFilters(), now };
  const available = orderDiscovery(
    candidates.filter(job => matchesOpportunity(job, filters)),
    now
  );
  const rules = node('details', '', 'discovery-rules');
  rules.id = 'discovery-rules';
  rules.open = rulesOpen;
  rules.append(node('summary', '筛选统计与新增规则'), countryCountSummary(candidates, filters));
  $('#recommendations-list').append(rules);
  $('#recommendations-list').append(
    node('p', `${available.length} 个机会 · 显示 ${Math.min(available.length, visibleRecommendations)} 个`, 'list-meta')
  );
  if (refreshBatch) {
    $('#recommendations-list').append(
      node(
        'p',
        refreshBatch.historyComplete === false
          ? '新增历史已达到容量边界，暂不标记新增；发布时间仍独立判断。'
          : `最近${refreshBatch.partial ? '部分成功' : '成功'}刷新 · 本次新增 ${refreshBatch.newIds.length} 条`,
        'discovery-current-status muted'
      )
    );
  }
  if (refreshBatch && refreshBatch.historyComplete !== false)
    rules.append(
      node(
        'p',
        `标记来自最近一次${refreshBatch.partial ? '部分成功' : '成功'}刷新（${new Date(refreshBatch.finishedAt).toLocaleString()}）；本次新增 ${refreshBatch.newIds.length} 条。新增提示按首次发现时间保留24小时，重复刷新不重置；近24小时发布独立依据官方时间。默认按发布时间从新到旧，未知置后；仅日期按日期排序，同日精确时间优先。历史记录始于 ${new Date(refreshBatch.startedAt).toLocaleDateString()}，不代表更早历史已完整核验。`,
        'discovery-batch-note muted'
      )
    );
  if (!available.length)
    $('#recommendations-list').append(
      node(
        'p',
        recommendations.length
          ? '没有符合当前条件的职位。试试清空筛选，或允许保留未知条件。'
          : '还没有可浏览的职位。点击刷新公开来源，或从学校列表开始。',
        'empty'
      )
    );
  for (const job of available.slice(0, visibleRecommendations)) {
    const card = node('article', '', 'recommendation-card' + (job.hasSchool ? ' school-opportunity' : ''));
    card.dataset.jobId = job.id;
    const header = node('div', '', 'card-header');
    header.append(node('span', job.company, 'company-name'));
    const priority = discoveryBadge(job, now);
    if (priority) header.append(priority);
    header.append(batch.checkbox(job));
    card.append(
      header,
      node('h3', job.title),
      node('p', job.location || '地点未知', 'card-location'),
      factBadges(job),
      publicationSummary(job),
      deadlineSummary(job)
    );
    const score = node('div', '', 'card-resume-selection');
    score.append(scoreRing(job.match?.score, ringContext(job.match)));
    card.append(score);
    if (job.hasSchool) {
      const confirmed = (job.schoolSources || []).map(s => s.requirement).filter(r => r?.source === 'user');
      const requirement = confirmed.length
        ? new Set(confirmed.map(r => r.kind)).size === 1
          ? confirmed[0]
          : { kind: 'unknown' }
        : schoolRequirement(
            (job.schoolSources || []).map(s => s.row),
            job
          );
      card.append(
        node(
          'p',
          { both: '学校 Portal + 官网均需提交', portal_only: '仅学校 Portal 提交', unknown: '申请途径待确认' }[
            requirement.kind
          ],
          'route-summary'
        )
      );
    }
    const detail = document.createElement('details');
    detail.className = 'card-detail';
    detail.append(
      node('summary', '职位详情与匹配依据'),
      publicationSummary(job, { detailed: true }),
      freshnessSummary(job)
    );
    detail.append(node('p', `${job.workMode || '办公方式未知'} · ${job.salary || '薪资未披露'}`, 'muted'));
    detail.append(
      node(
        'small',
        `来源：${(job.sources || [job.source]).map(s => s.name).join(' / ')}${job.stale ? ' · 待核实更新' : ''}`
      ),
      matchView(job.match, job, { showScore: false }),
      node('pre', job.jd || job.detailError || '暂无完整 JD')
    );
    if (job.hasPublic)
      detail.append(
        node(
          'p',
          '网络来源更新：' + (job.publicUpdated || '未知') + ' · ' + (job.stale ? '状态待核实' : '以官网当前状态为准')
        )
      );
    for (const source of job.schoolSources || []) {
      detail.append(
        node(
          'p',
          `学校 ID ${source.schoolId} · 更新 ${new Date(source.updated).toLocaleString()} · 状态 ${source.row.sourceStatus || '未知'} · 截止 ${source.row.deadlineText || '未知'}`
        )
      );
      detail.append(
        node(
          'p',
          `${source.row.company} · ${source.row.title} · ${source.row.location || '地点未知'} · ${source.row.term || '学期未知'} · 官网编号 ${source.row.requisitionId || '未知'}`
        )
      );
      if (source.conflicts.length)
        detail.append(node('p', '已明确关联，但来源字段不同：' + source.conflicts.join(' / ')));
      for (const [label, url] of [
        ['学校原文', source.row.url],
        ['学校提供的官网链接', source.row.externalUrl]
      ])
        if (safeHref(url)) {
          const a = node('a', label);
          a.href = safeHref(url);
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          detail.append(a);
        }
    }
    if (/remote/i.test(job.location)) detail.append(node('p', '远程地点来自招聘信息；加拿大工作资格需核实。', 'muted'));
    const link = node('a', '官网申请 ↗'),
      linkHref = safeHref(job.url);
    if (linkHref) link.href = linkHref;
    link.target = '_blank';
    link.rel = 'noreferrer noopener';
    link.className = 'button-link';
    link.addEventListener('click', event => event.stopPropagation());
    let savedJob = job.draftIds?.length === 1 ? jobs.find(row => job.draftIds.includes(row.id)) : null;
    const prepare = node('button', savedJob ? '继续准备申请' : '准备申请');
    prepare.type = 'button';
    prepare.className = 'primary';
    const submitted = node('button', '已提交？');
    submitted.type = 'button';
    submitted.className = 'quiet';
    const status = node('p', '');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    async function prepareHere(confirmResult = false) {
      if (busy || !allowJobSwitch()) return;
      await action(status, async () => {
        if (!savedJob) savedJob = await api(`/api/recommendations/${job.id}/prepare`, { method: 'POST', value: {} });
        else savedJob = await api('/api/jobs/' + savedJob.id);
        jobs = [savedJob, ...jobs.filter(row => row.id !== savedJob.id)];
        drawJobs();
        prepare.textContent = '继续准备申请';
        status.textContent = '已打开准备，尚未提交。';
        openPreparation(savedJob);
        if (confirmResult) {
          $('#submission-details').open = true;
          $('#confirmation-form').scrollIntoView({ block: 'start' });
        }
      });
    }
    prepare.addEventListener('click', () => prepareHere());
    submitted.addEventListener('click', () => prepareHere(true));
    const actions = node('div', '', 'card-actions');
    actions.append(prepare);
    if (job.url) actions.append(link);
    detail.append(submitted);
    card.append(detail, actions, status);
    $('#recommendations-list').append(card);
  }
  discoveryView();
  $('#more-recommendations').hidden = available.length <= visibleRecommendations;
}
async function showResumeBindings() {
  const ticket = epoch;
  try {
    const data = await api('/api/resume-routing');
    if (ticket !== epoch) return;
    const panel = $('#resume-routing');
    panel.replaceChildren();
    for (const track of ['cs', 'data']) {
      if (data.bindings[track]) {
        const clear = node('button', '解除' + track.toUpperCase() + '绑定');
        clear.type = 'button';
        clear.title = data.bindings[track].name;
        clear.setAttribute('aria-label', clear.textContent + ' ' + data.bindings[track].name);
        clear.addEventListener('click', () =>
          action('#file-status', async () => {
            await api('/api/resume-routing/' + track, { method: 'PUT', value: { fileId: null } });
            await refreshAssessment();
          })
        );
        panel.append(clear);
      }
    }
  } catch (e) {
    if (ticket === epoch) $('#resume-routing').textContent = e.message;
  }
}
async function openResumeChoice(job, box) {
  const ticket = epoch;
  if (box.querySelector('.resume-choice')) return;
  const panel = node('div', '', 'resume-choice'),
    status = node('p');
  box.append(panel);
  try {
    const files = await api('/api/files');
    if (ticket !== epoch) return;
    const select = node('select');
    select.setAttribute('aria-label', '本岗简历原件');
    select.add(new Option('恢复按JD自动选择', ''));
    for (const f of files.filter(f => f.kind !== 'cover' && f.origin.kind === 'uploaded'))
      select.add(new Option(f.name, f.id));
    const preview = node('pre'),
      confirmed = node('input');
    confirmed.type = 'checkbox';
    const label = node('label', '我已核对文字并确认本岗使用该原件（评分与导出同步）');
    label.append(confirmed);
    let parsed = null;
    select.addEventListener('change', async () => {
      parsed = null;
      confirmed.checked = false;
      preview.textContent = '';
      if (!select.value) return;
      try {
        const id = select.value,
          value = await api('/api/files/' + id + '/parse', { method: 'POST', value: {} });
        if (ticket === epoch && select.value === id) {
          parsed = value;
          preview.textContent = value.text;
        }
      } catch (e) {
        status.textContent = e.message;
      }
    });
    const save = node('button', '保存本岗选择');
    save.type = 'button';
    save.addEventListener('click', () =>
      action(status, async () => {
        if (select.value && (!parsed || !confirmed.checked)) throw Error('请核对提取文字并勾选确认');
        const saved =
          job.id.length === 36
            ? job
            : await api('/api/recommendations/' + job.id + '/prepare', { method: 'POST', value: {} });
        await api('/api/jobs/' + saved.id + '/resume-selection', {
          method: 'PUT',
          value: select.value
            ? { fileId: parsed.fileId, fileSha: parsed.fileSha, textHash: parsed.textHash, confirmed: true }
            : { fileId: null }
        });
        await refreshAssessment();
      })
    );
    panel.append(select, preview, label, save, status);
  } catch (e) {
    status.textContent = e.message;
    panel.append(status);
  }
}
async function refreshAssessment() {
  await showResumeBindings();
  const resume = await api('/api/resume');
  $('#clear-resume').hidden = !resume;
  await refreshFiles();

  jobs = await api('/api/jobs');
  drawJobs();
  // Keep every unsaved form value; only refresh its saved assessment.
  const current = jobs.find(job => job.id === $('#job-form').elements.id.value);
  $('#job-match').replaceChildren(
    $('#job-form').elements.jd.value !== (current?.jd ?? '')
      ? node('p', 'JD 已修改；保存后重新计算匹配度', 'muted')
      : matchView(current?.match, current)
  );
  await loadRecommendations();
  await applications.refresh();
  await applications.records();
}
$('#activate-form').addEventListener('submit', event => {
  event.preventDefault();
  action('#resume-status', async () => {
    if (!reviewedResume) throw new Error('请先解析并核对文件');
    const track = event.target.elements.track.value;
    await api(track === 'legacy' ? '/api/resume/activate' : '/api/resume-routing/' + track, {
      method: track === 'legacy' ? 'POST' : 'PUT',
      value: {
        fileId: reviewedResume.fileId,
        fileSha: reviewedResume.fileSha,
        textHash: reviewedResume.textHash,
        confirmed: event.target.elements.confirmed.checked
      }
    });
    $('#resume-status').textContent = '已启用';
    try {
      await refreshAssessment();
    } catch {
      $('#resume-status').textContent = '简历已启用，但评分刷新失败。请重新登录查看，不必重新启用。';
    }
  });
});
$('#clear-resume').addEventListener('click', () =>
  action('#file-status', async () => {
    await api('/api/resume/clear', { method: 'POST', value: {} });
    $('#file-status').textContent = '已停用评分基准，原件仍保留';
    try {
      await refreshAssessment();
    } catch {
      $('#file-status').textContent = '已停用，页面刷新失败，请重新登录查看';
    }
  })
);
function showUpdateProgress() {
  const panel = $('#update-details');
  panel.open = true;
  $('#update-history').open = true;
  panel.querySelector('summary').focus();
  panel.scrollIntoView({ block: 'nearest' });
  void updates.inspect();
}
$('#refresh-sources').addEventListener('click', () => {
  if (discoveryRunning) showUpdateProgress();
  else void updates.refresh('manual');
});
$('#view-update-progress').addEventListener('click', showUpdateProgress);
$('#more-recommendations').addEventListener('click', () => {
  visibleRecommendations += 20;
  drawRecommendations();
});
const applications = applicationWorkspace({
  api,
  action,
  readView,
  jobDirty,
  downloadFile,
  chooseJob: id => {
    const job = jobs.find(job => job.id === id);
    if (job && allowJobSwitch()) {
      openPreparation(job, 'applications');
    }
  },
  filesChanged: refreshFiles
});
const school = schoolWorkspace({
  api,
  action,
  readView,
  jobsChanged: async () => {
    jobs = await api('/api/jobs');
    drawJobs();
    await loadRecommendations();
  },
  chooseJob: async id => {
    if (!allowJobSwitch()) return;
    const job = await api(`/api/jobs/${id}`);
    jobs = [job, ...jobs.filter(row => row.id !== id)];
    drawJobs();
    openPreparation(job, 'school-jobs');
  }
});
boot();
