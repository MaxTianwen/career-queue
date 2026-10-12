import {capturePanel} from './school-capture-ui.js';
import { preserveList } from './page-stability.js';
import { mountView } from './opportunity-view.js';
import { schoolRequirement } from './requirements.js';
import { mountFilters, matchesOpportunity, factsLabel, factBadges } from './opportunity.js';
const $ = selector => document.querySelector(selector);
const node = (tag, text) => { const el = document.createElement(tag); el.textContent = text; return el; };
const channelName = channel => channel === 'employer' ? '官网' : '学校';

export function schoolWorkspace({ api, action, chooseJob, jobsChanged, readView=(_key,load)=>load(()=>true) }) {
  let preview = null, originalText = '', requestId = crypto.randomUUID(), limit = 20, records = [];
  const choices = new Map(), form = $('#school-paste-form'), confirmation = $('#school-confirmed');
  let maintenance = null;
  const capture=capturePanel({form,api,action,refresh:async()=>{await refreshOpportunities();await refresh();await jobsChanged();}});
  const labels = { company: '学校公司名称', title: '学校职位名称', location: '学校工作地点', term: '学校入职批次', requisitionId: '雇主招聘编号', url: '学校岗位链接', externalUrl: '来源中的官网链接', deadlineText: '学校截止原文', sourceStatus: '学校列表状态原文' };
  const actionNames = { link: '建立关联', update: '更新学校资料', unlink: '解除关联', relink: '改绑职位' };
  function snapshot(value) {
    const box = node('div', '');
    if (!value) { box.append(node('p', '无关联')); return box; }
    box.append(node('p', `学校 ID ${value.schoolId} → ${value.job?.company || ''} · ${value.job?.title || value.jobId}`));
    for (const [key, label] of Object.entries(labels)) box.append(node('p', `${label}：${value.row[key] || '未提供'}`));
    return box;
  }
  function closeMaintenance() { maintenance = null; $('#school-maintenance').replaceChildren(); $('#school-maintenance').hidden = true; }
  function maintenanceButton(record, proposed) {
    const button = node('button', proposed ? '核对并更新学校资料' : `维护学校关联 ${record.schoolId}`); button.type = 'button';
    button.addEventListener('click', () => action('#school-status', async () => {
      if (maintenance) { $('#school-status').textContent = '请先保存或取消当前学校维护草稿。'; $('#school-maintenance').scrollIntoView({ block: 'start' }); return; }
      const jobs = await api('/api/jobs');
      const panel = $('#school-maintenance'), editor = document.createElement('form'), fields = node('div', ''), comparison = node('div', '');
      panel.replaceChildren(node('h3', `维护学校 ID ${record.schoolId}`), node('p', '学校提交锁定只针对此 School ID；官网提交、材料及其他申请历史始终保留原位。'), editor);
      const operationLabel = node('label', '维护操作'), operation = document.createElement('select'); operation.name = 'action';
      for (const [value, label] of Object.entries(actionNames).filter(([key]) => key !== 'link')) operation.append(new Option(label, value));
      operationLabel.append(operation); editor.append(operationLabel, fields);
      if (record.locked) editor.append(node('p', '此 School ID 已有学校实际提交记录，解除和改绑将被阻止；来源资料仍可更新。'));
      for (const [key, label] of Object.entries(labels)) {
        const wrapper = node('label', label), input = document.createElement('input'); input.name = key;
        input.maxLength = ['url', 'externalUrl'].includes(key) ? 2000 : key === 'deadlineText' ? 100 : 200;
        input.value = proposed?.[key] || record.row[key] || ''; wrapper.append(input); fields.append(wrapper);
      }
      const targetLabel = node('label', '改绑到已保存职位'), target = document.createElement('select'); target.name = 'targetJobId';
      target.append(new Option('请选择已核对的职位', ''));
      for (const job of jobs.filter(job => job.id !== record.jobId)) target.append(new Option(`${job.company} · ${job.title}`, job.id));
      targetLabel.append(target); targetLabel.hidden = true;
      const reasonLabel = node('label', '维护原因'), reason = document.createElement('textarea'); reason.name = 'reason'; reason.required = true; reason.maxLength = 500; reasonLabel.append(reason);
      const previewButton = node('button', '预览维护差异'); previewButton.type = 'button';
      const confirmLabel = node('label', ''), confirmed = document.createElement('input'); confirmed.type = 'checkbox'; confirmed.required = true; confirmed.name = 'confirmed';
      confirmLabel.className = 'check'; confirmLabel.append(confirmed, node('span', '我已核对前后差异，确认仅维护学校关联'));
      const save = node('button', '确认保存学校维护'), cancel = node('button', '取消学校维护'); cancel.type = 'button';
      save.hidden = true; confirmLabel.hidden = true;
      editor.append(targetLabel, reasonLabel, previewButton, comparison, confirmLabel, save, cancel);
      const draft = { record, requestId: crypto.randomUUID(), plan: null }; maintenance = draft;
      const input = () => ({ action: operation.value, revision: record.revision, targetJobId: target.value, row: Object.fromEntries(Object.keys(labels).map(key => [key, editor.elements[key].value])) });
      editor.addEventListener('input', event => { if (event.target === confirmed) return; draft.plan = null; draft.requestId = crypto.randomUUID(); comparison.replaceChildren(); confirmed.checked = false; save.hidden = true; confirmLabel.hidden = true; });
      operation.addEventListener('change', () => { fields.hidden = operation.value !== 'update'; targetLabel.hidden = operation.value !== 'relink'; });
      previewButton.addEventListener('click', () => action('#school-status', async () => {
        draft.plan = await api(`/api/school/${record.schoolId}/change-preview`, { method: 'POST', value: input() });
        const { before, after } = draft.plan;
        comparison.replaceChildren(node('h4', '本次变更'));
        if (!after) comparison.append(node('p', `解除学校 ID ${record.schoolId} 与 ${before.job.company} · ${before.job.title} 的关联。职位与所有申请记录保留。`));
        else if (before.jobId !== after.jobId) comparison.append(node('p', `原职位：${before.job.company} · ${before.job.title}`), node('p', `改绑到：${after.job.company} · ${after.job.title}。不迁移材料或申请记录。`));
        else for (const [key, label] of Object.entries(labels)) if (before.row[key] !== after.row[key]) comparison.append(node('p', `${label}：${before.row[key] || '未提供'} → ${after.row[key] || '清空'}`));
        const full = node('details', ''); full.append(node('summary', '完整前后资料'), node('h4', '修改前'), snapshot(before), node('h4', '修改后'), snapshot(after)); comparison.append(full);
        confirmed.checked = false; save.hidden = false; confirmLabel.hidden = false; $('#school-status').textContent = '差异已预览，尚未保存。';
      }));
      cancel.addEventListener('click', () => { closeMaintenance(); (button.isConnected ? button : $('#school-reload')).focus(); $('#school-status').textContent = '已取消维护。'; });
      editor.addEventListener('submit', event => { event.preventDefault(); action('#school-status', async () => {
        if (!draft.plan || maintenance !== draft) throw new Error('请先预览当前差异');
        await api(`/api/school/${record.schoolId}/changes`, { method: 'POST', value: { ...input(), fingerprint: draft.plan.fingerprint, reason: reason.value, confirmed: confirmed.checked, requestId: draft.requestId } });
        closeMaintenance(); invalidate();
        try { await refresh(); await refreshOpportunities(); await jobsChanged(); $('#school-reload').focus(); $('#school-status').textContent = '学校维护已保存并记录历史；官网、材料及提交记录未移动或修改。'; }
        catch { $('#school-status').textContent = '维护已保存，但列表读取失败；请刷新关联，无需重复保存。'; }
      }); });
      panel.hidden = false; panel.scrollIntoView({ block: 'start' }); operation.focus(); $('#school-status').textContent = '维护草稿已打开。';
    })); return button;
  }
  function drawHistory(history) {
    const container = $('#school-history'); container.replaceChildren();
    for (const event of history.events.slice().reverse()) {
      const detail = node('details', ''); detail.append(node('summary', `${event.schoolId} · ${actionNames[event.action]} · ${new Date(event.created).toLocaleString()}`), node('p', `原因：${event.reason} · 操作者：${event.actor}`), node('h4', '操作前'), snapshot(event.before), node('h4', '操作后'), snapshot(event.after)); container.append(detail);
    }
    for (const source of history.sources) {
      const detail = node('details', '');
      const basis = { submission: '记录学校实际提交时', 'confirmed-association': '本人后来确认关联时', 'existing-association': '升级时已有的关联', 'channel-correction': '本人更正为学校渠道时' }[source.basis];
      detail.append(node('summary', `${source.schoolId} · 已保留的提交关联资料`), node('p', `${basis}记录；${new Date(source.captured).toLocaleString()}。${source.basis === 'submission' ? '' : '不代表提交当时已保存此来源资料。'} 当前渠道：${channelName(source.channel)} · 日期：${source.date}`), snapshot({ schoolId: source.schoolId, jobId: source.jobId, row: source.row })); container.append(detail);
    }
    if (!history.events.length && !history.sources.length) container.append(node('p', '尚无维护历史。已有旧关联会在首次维护时保留原值。'));
  }
  function invalidate() {
    preview = null; choices.clear(); confirmation.checked = false; $('#school-preview').hidden = true;
    $('#school-results').replaceChildren(); $('#school-warnings').replaceChildren();
    requestId = crypto.randomUUID();
  }
  form.elements.text.addEventListener('input', () => {
    if (preview) { invalidate(); $('#school-status').textContent = '原文已修改，请重新预览后选择。'; }
  });
  function openButton(id) {
    const button = node('button', '打开已保存职位'); button.type = 'button';
    button.addEventListener('click', () => action('#school-status', () => chooseJob(id))); return button;
  }
  function facts(row) {
    const box = node('p', `${row.company} · ${row.location || '地点未提供'} · ${row.term || '入职批次未提供'}`);
    box.append(node('br', ''), node('span', `学校 ID ${row.id} · 学校截止：${row.deadlineText || row.deadline || '未提供'}`));
    if (row.requisitionId) box.append(node('br', ''), node('span', `雇主招聘编号：${row.requisitionId}`));
    return box;
  }
  function count() { $('#school-selection-count').textContent = `已选择 ${choices.size} 条（包含筛选后隐藏的选择）`; }
  function drawPreview() {
    if (!preview) return;
    const filter = $('#school-preview-filter').value;
    const rows = preview.rows.filter(row => filter === 'all' || row.category === filter);
    $('#school-results').replaceChildren(); count();
    for (const item of rows.slice(0, limit)) {
      const card = node('article', ''); card.className = 'recommendation-card';
      if (!item.row) { card.append(node('p', item.error)); $('#school-results').append(card); continue; }
      const row = item.row;
      if(item.eligibilityExclusion){card.append(node('h3',row.title),facts(row),node('p','已按公民限制排除 · '+(item.eligibilityExclusion.evidence||[]).join(' ')));$('#school-results').append(card);continue;}
      card.append(node('small', { linked: '本账号已保存关联', candidates: '找到候选 · 需要本人核对', unmatched: '当前结果未找到对应候选' }[item.category]), node('h3', row.title), facts(row));
      if (item.expired) card.append(node('p', '学校截止已过；保留对照与历史，不代表仍可申请。'));
      if (item.warning) card.append(node('p', item.warning));
      if (item.relatedSchoolIds.length) card.append(node('p', `同一雇主编号还出现在学校 ID ${item.relatedSchoolIds.join('、')}，不自动合并。`));
      if (item.linked) {
        card.append(openButton(item.linked.jobId));
        if (item.sourceChanged) {
          card.append(node('p', '本次来源与已保存资料不同；已保留旧资料，不自动覆盖。'));
          const detail = node('details', ''); detail.append(node('summary', '查看已保存的学校资料'), facts(item.linked.row)); card.append(detail);
          card.append(maintenanceButton(item.linked, row));
        }
      } else {
        const label = node('label', `学校 ${row.id} 的处理方式`), select = document.createElement('select');
        select.append(new Option('暂不处理', ''), new Option('保存为独立学校候选（无官网 JD）', 'new'));
        for (const candidate of item.candidates) select.append(new Option(`${candidate.kind === 'saved' ? '关联已保存' : '保存公开候选并关联'}：${candidate.company} · ${candidate.title}${candidate.linkedId ? ' · 已有关联' : ''}`, candidate.target));
        const other = document.createElement('optgroup'); other.label = '其他本人已保存职位（请仔细核对）';
        for (const job of preview.savedJobs.filter(job => !item.candidates.some(candidate => candidate.target === `saved:${job.id}`))) other.append(new Option(`${job.company} · ${job.title}`, `saved:${job.id}`));
        if (other.children.length) select.append(other);
        select.value = choices.get(item.index) || '';
        select.addEventListener('change', () => {
          if (select.value) choices.set(item.index, select.value); else choices.delete(item.index);
          confirmation.checked = false; requestId = crypto.randomUUID(); count();
        });
        label.append(select); card.append(label);
      }
      if (item.candidates.length) {
        const detail = node('details', ''); detail.append(node('summary', `对照依据 · ${item.candidates.length} 个候选`));
        for (const candidate of item.candidates) {
          detail.append(node('strong', candidate.title), node('p', `${candidate.location || '地点待核对'} · ${candidate.requisitionId || '招聘编号未提供'} · ${candidate.termLabel || '批次待核对'}`), node('p', [...candidate.reasons, ...candidate.conflicts].join('；')), node('small', candidate.sourceNote));
          if (candidate.kind === 'saved') detail.append(node('p', `${candidate.employerSubmitted ? '官网已有本人提交记录' : '官网尚无本人提交记录'}；${candidate.schoolSubmitted ? '学校已有本人提交记录' : '学校尚无本人提交记录'}`));
        }
        card.append(detail);
      }
      if (!item.candidates.length) card.append(node('p', preview.searchedAt ? '本次已接入来源未找到；不能据此判断岗位关闭。' : '尚无公开发现结果，可先保存学校候选，之后补充 JD。'));
      $('#school-results').append(card);
    }
    $('#school-more').hidden = rows.length <= limit;
    if (!rows.length) $('#school-results').append(node('p', '当前筛选下没有记录。'));
  }
  function drawRecords() {
    const pending = $('#school-record-filter').value === 'pending';
    const visible = records.filter(record => !pending || record.required.includes('school') && record.submissions.some(s => s.channel === 'employer') && !record.submissions.some(s => s.channel === 'school'));
    $('#school-records').replaceChildren();
    for (const record of visible) {
      const card = node('article', ''); card.className = 'recommendation-card';
      if(record.eligibilityExclusion)card.append(node('p','已按公民限制排除，保留历史 · '+(record.eligibilityExclusion.evidence||[]).join(' ')));
      card.append(node('small', record.status), node('h3', record.row.title), facts(record.row));
      card.append(node('p', `关联：${record.job.company} · ${record.job.title}`));
      for (const submission of record.submissions) card.append(node('p', `${channelName(submission.channel)}本人已记录提交 · ${submission.date}`));
      card.append(openButton(record.jobId));
      card.append(maintenanceButton(record));
      if (record.row.url) { const link = node('a', '打开学校岗位 ↗'); link.href = record.row.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; card.append(link); }
      $('#school-records').append(card);
    }
    if (!visible.length) $('#school-records').append(node('p', pending ? '目前没有“官网已交、学校待补交”的记录。需先为岗位确认包含学校的申请渠道。' : '尚未保存学校关联。请粘贴学校列表后预览。'));
  }
  async function refresh() { records = await api('/api/school'); const history = await api('/api/school/history'); drawRecords(); drawHistory(history); $('#school-status').textContent = `已读取 ${records.length} 条学校关联。${maintenance ? '维护草稿已保留；不会自动接受新的记录版本。' : ''}`; }
  let opportunities=[];
  const schoolFilters=mountFilters($('#school-filters'),drawOpportunities,{schoolOnly:true});
  const schoolView=mountView($('#school-jobs-list'),'school',drawOpportunities);
  let refreshRevision=0;
  function refreshOpportunities(force=true){return readView('school',readOpportunities,{force});}
  async function readOpportunities(current) {const revision=++refreshRevision;const [rows,excluded]=await Promise.all([api('/api/school/opportunities'),api('/api/eligibility/exclusions')]);if(!current()||revision!==refreshRevision)return;opportunities=rows;const schoolExcluded=excluded.filter(r=>r.schoolIds.length);$('#school-eligibility-note').hidden=!schoolExcluded.length;$('#school-eligibility-exclusions').replaceChildren(...schoolExcluded.map(r=>node('p',`已排除 · 学校 ${r.schoolIds.join(' / ')} · ${r.title} · ${(r.reason.evidence||[]).join(' ')}`)));preserveList($('#school-jobs-list'),drawOpportunities); }
  function drawOpportunities() {
    const items=opportunities.filter(item=>matchesOpportunity({...item.facts,...item.row,hasSchool:true},schoolFilters()));const list=$('#school-jobs-list');list.replaceChildren();
    for(const item of items) {
      const card=node('article',''); card.className='recommendation-card school-opportunity';card.dataset.jobId=item.schoolId;
      const header=node('div','');header.className='card-header';const company=node('span',item.row.company || '学校机会');company.className='company-name';header.append(company);
      const location=node('p',item.row.location || '地点未知');location.className='card-location';
      const requirement=item.requirement || schoolRequirement([item.row]),route=node('p',({both:'学校 Portal + 官网均需提交',portal_only:'仅学校 Portal 提交',unknown:'申请途径待确认'})[requirement.kind]);route.className='route-summary';
      card.append(header,node('h3',item.row.title),location,factBadges({...item.facts,...item.row,hasSchool:true}),route);
      const details=document.createElement('details');details.className='card-detail';details.append(node('summary','学校资料与申请入口'),facts(item.row),node('small',`学校 ID ${item.schoolId} · 更新 ${new Date(item.updated).toLocaleString()}`));for(const [label,url] of [['打开学校 Portal',item.row.url],['打开官网',item.row.externalUrl]])if(url){const a=node('a',label+' ↗');a.href=url;a.target='_blank';a.rel='noopener noreferrer';details.append(a);}
      details.append(node('p','请核对原文申请要求；进入准备后可确认“学校 + 官网”或“仅学校”，两个提交状态分别记录。'));for(const quote of requirement.evidence)details.append(node('p',quote));card.append(details);
      const localStatus=node('p','');localStatus.setAttribute('role','status');card.append(localStatus);
      const start=node('button',item.jobId?'继续准备申请':'准备申请');start.type='button';
      start.addEventListener('click',()=>action(localStatus,async()=>{
        const job=await api('/api/school/opportunities/start',{method:'POST',value:{schoolId:item.schoolId,fingerprint:item.fingerprint}});
        await jobsChanged(); await chooseJob(job.id);
        localStatus.textContent='已打开申请准备';
      })); start.className='primary';const actions=node('div','');actions.className='card-actions';actions.append(start);card.append(actions);list.append(card);
    }
    if(!items.length){const empty=node('p',opportunities.length?'没有符合筛选的学校职位。':'展开上方导入入口，粘贴学校职位表格即可开始。');empty.className='empty';list.append(empty);}
    const count=node('p',`${items.length} / ${opportunities.length} 条学校职位`);count.className='list-meta';list.prepend(count);schoolView();
    $('#school-jobs-status').textContent='';
  }
  $('#school-jobs-reload').addEventListener('click',()=>action('#school-jobs-status',refreshOpportunities));
  form.addEventListener('submit', event => { event.preventDefault(); action('#school-status', async () => {
    const text = form.elements.text.value;
    const updated = await api('/api/school/opportunities',{method:'POST',value:{text}});
    const result = updated.preview;
    invalidate(); preview = result; originalText = text; limit = 20;
    $('#school-preview').hidden = false;
    $('#school-warnings').replaceChildren(...[...result.warnings, ...result.errors].map(message => node('p', message)));
    drawPreview();
    try { await refreshOpportunities(); await refresh(); await jobsChanged(); $('#school-status').textContent = `已导入 / 更新 ${result.parsedCount} 条。直接点击下方“准备申请”即可；旧记录保留。`; $('#school-jobs-list').scrollIntoView({block:'start'}); }
    catch { $('#school-status').textContent = '学校资料已更新，对照可继续使用；下方关联列表暂未刷新，请稍后重试。'; }
  }); });
  $('#school-save-form').addEventListener('submit', event => { event.preventDefault(); action('#school-status', async () => {
    if (!preview || form.elements.text.value !== originalText) throw new Error('请先预览当前原文');
    if (!choices.size) throw new Error('请为至少一条学校职位选择处理方式');
    const saved = await api('/api/school/import', { method: 'POST', value: { text: originalText, fingerprint: preview.fingerprint, selections: [...choices].map(([index, target]) => ({ index, target })), confirmed: confirmation.checked, requestId } });
    invalidate();
    try { await refresh(); await jobsChanged(); $('#school-status').textContent = `已保存 ${saved.saved.length} 条学校关联；尚未改变任何提交状态。`; }
    catch { $('#school-status').textContent = `已保存 ${saved.saved.length} 条，列表刷新失败；点击刷新已保存关联，无需重复保存。`; }
  }); });
  $('#school-preview-filter').addEventListener('change', () => { limit = 20; drawPreview(); });
  $('#school-more').addEventListener('click', () => { limit += 20; drawPreview(); });
  $('#school-clear-choices').addEventListener('click', () => { choices.clear(); confirmation.checked = false; requestId = crypto.randomUUID(); drawPreview(); });
  $('#school-record-filter').addEventListener('change', drawRecords);
  $('#school-reload').addEventListener('click', () => action('#school-status', refresh));
  return { refresh, refreshOpportunities, clear: () => {capture.clear();refreshRevision++;opportunities=[]; $('#school-jobs-list').replaceChildren(); $('#school-jobs-status').textContent=''; closeMaintenance(); invalidate(); records = []; originalText = ''; form.reset(); $('#school-preview-filter').value = 'all'; $('#school-record-filter').value = 'all'; $('#school-records').replaceChildren(); $('#school-history').replaceChildren(); } };
}
