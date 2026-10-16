import {applicationCells,renderApplicationTable} from './application-table.js';
import {readView as readDisplay,saveView} from './opportunity-view.js';
import { questionDiff } from './question-diff.js';
const $ = selector => document.querySelector(selector);
const el = (tag, text) => { const node = document.createElement(tag); node.textContent = text; return node; };
const channels = { unknown: '待确认', employer: '官网', school: '学校', both: '官网 + 学校', 'school-only': '仅学校' };

export function submissionSummary(records = []) {
  if (!records.length) return '尚未记录实际提交';
  return records.map(row => {
    const source = row.source === 'school-portal' ? '学校 Portal 状态' : row.source === 'manual-confirmation' ? '本人确认已提交' : '已记录提交（来源待核实）';
    return `${channels[row.channel] || '渠道待确认'}：${row.date || '提交日期未知'}，${source}`;
  }).join('；');
}

export function localDate(date=new Date()) {
  return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
}
export function applicationWorkspace({ api, action, jobDirty, chooseJob, downloadFile, filesChanged, readView=(_key,load)=>load(()=>true) }) {
  let jobId = null, state = null, revision = 0, requestId = 0, schoolContext = null;
  let displayStorage;try{displayStorage=globalThis.localStorage;}catch{}let displayMode=readDisplay(displayStorage,'applications');
  const displayControls=el('div','');displayControls.className='view-switch';displayControls.setAttribute('role','group');displayControls.setAttribute('aria-label','申请记录显示方式');
  const tableHost=el('div',''),historyHost=el('div','');tableHost.id='applications-table';historyHost.id='applications-history';$('#applications-tab').append(tableHost,historyHost);
  const displayButtons=[];const display=()=>{$('#applications-list').hidden=displayMode==='table';tableHost.hidden=displayMode!=='table';for(const [b,value] of displayButtons)b.setAttribute('aria-pressed',String(displayMode===value));};
  for(const [value,label] of [['cards','卡片'],['table','列表']]){const b=el('button',label);b.type='button';b.addEventListener('click',()=>{displayMode=value;saveView(displayStorage,'applications',value);display();});displayButtons.push([b,value]);displayControls.append(b);}$('#applications-tab').insertBefore(displayControls,$('#applications-list'));display();
  const dirty = new Set();
  const preparation = $('#preparation-form');
  let preparationState = null, questionState = null, rehearsalDialog = null;
  $('#pairing-entry').addEventListener('click', () => {
    const status=$('#pairing-entry-status');
    if (!jobId) { status.textContent='请先在机会清单选择一个已保存的职位。'; return; }
    let supported=false;
    try { const u=new URL($('#job-form').elements.url.value); supported=u.protocol==='https:' && !u.port && !u.username && !u.password && ['boards.greenhouse.io','job-boards.greenhouse.io'].includes(u.hostname) && /^\/[\w-]+\/jobs\/\d+\/?$/.test(u.pathname); } catch {}
    if (!supported) { status.textContent='当前职位不是支持的 Greenhouse 官网链接，暂时不能配对。学校 Portal 仍使用学校对照功能。'; return; }
    $('#preparation-panel').open=true;
    const connect=$('#browser-pairing');
    if (connect) { connect.open=true; connect.scrollIntoView({block:'center'}); connect.querySelector('input').focus(); status.textContent='请保存并核对逐题草稿，然后勾选允许读取并生成临时配对码。'; }
    else { status.textContent='第一步：点击“读取 Greenhouse 申请问题”，填写并保存逐题草稿后，再生成临时配对码。'; $('#read-application-form').scrollIntoView({block:'center'}); $('#read-application-form').focus(); }
  });

  const material = $('#material-form'), submission = $('#submission-form');
  const correction = $('#submission-correction-form');
  let correctionDraft = null, submissionRequestId = crypto.randomUUID(), submissionPayload = null;
  const previewDialog = $('#pdf-dialog');
  let draft = null;
  const generationForm = $('#generation-form');
  let editDraft = null;
  const editForm = $('#word-edit-form');
  function showAvailability(kind, data) {
    const form = kind === 'generation' ? generationForm : editForm;
    form.elements.openConfirmed.checked = false;
    document.querySelector('#' + kind + '-availability').textContent = data ?
      ({ open: '官方仍提供岗位正文', closed: '已关闭', unknown: '需本人核实' }[data.status] + ' · ' + new Date(data.checkedAt).toLocaleString() + ' · ' + data.evidence + '（15 分钟内有效）') : '';
  }
  for (const kind of ['generation', 'edit']) document.querySelector('#' + kind + '-recheck').addEventListener('click', () => action(kind === 'generation' ? '#application-status' : '#word-edit-status', async () => {
    const current = kind === 'generation' ? draft : editDraft, captured = revision, target = jobId;
    if (!current || jobDirty()) throw new Error('请先保存岗位并准备对照');
    const next = await api('/api/jobs/' + target + '/availability', { method: 'POST', value: {} });
    if (captured !== revision || current !== (kind === 'generation' ? draft : editDraft)) return;
    current.availability = next; showAvailability(kind, next);
    document.querySelector(kind === 'generation' ? '#application-status' : '#word-edit-status').textContent = '核查完成，修改内容已保留，请重新核对开放结果。';
  }));
  function clearEdit() { editDraft = null; showAvailability('edit', null); editForm.reset(); editForm.hidden = true; $('#word-edit-fields').replaceChildren(); $('#word-edit-source').textContent = ''; $('#word-edit-status').textContent = ''; dirty.delete('word-edit-form'); }
  $('#cancel-word-edit').addEventListener('click', () => { clearEdit(); $('#prepare-word').focus(); });
  function clearDraft() { draft = null; showAvailability('generation', null); generationForm.reset(); generationForm.hidden = true; $('#generation-groups').replaceChildren(); $('#generation-baseline').textContent = ''; dirty.delete('generation-form'); }
  function clearPreview() { previewDialog.close(); $('#pdf-pages').replaceChildren(); $('#pdf-title').textContent = 'PDF 预览'; }
  $('#close-pdf').addEventListener('click', clearPreview);
  previewDialog.addEventListener('cancel', event => { event.preventDefault(); clearPreview(); });
  previewDialog.addEventListener('click', event => {
    const r = previewDialog.getBoundingClientRect();
    if (event.target === previewDialog && (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom)) clearPreview();
  });
  for (const id of ['confirmation-form', 'channel-form', 'material-form', 'submission-form', 'material-upload', 'generation-form', 'word-edit-form', 'submission-correction-form', 'preparation-form']) {
    $(`#${id}`).addEventListener('input', () => dirty.add(id));
  }
  preparation.elements.notes.addEventListener('input', () => { preparation.elements.reviewed.checked = false; });
  submission.addEventListener('input', () => { submissionRequestId = crypto.randomUUID(); submissionPayload = null; });
  correction.addEventListener('input', () => { if (correctionDraft) correctionDraft.requestId = crypto.randomUUID(); });
  function clearCorrection() {
    correctionDraft = null; correction.reset(); correction.hidden = true; dirty.delete('submission-correction-form');
    $('#correction-source').textContent = ''; $('#correction-status').textContent = '';
    correction.elements.channel.replaceChildren();
  }
  function correctionChannels(selected) {
    const choices = state.required.map(channel => new Option(channels[channel], channel));
    if (!state.required.includes(selected)) {
      const original = new Option(`${channels[selected]}（不在当前申请渠道中，请重新选择）`, selected); original.disabled = true; choices.unshift(original);
    }
    correction.elements.channel.replaceChildren(...choices); correction.elements.channel.value = selected;
  }
  function focusCorrection(id) {
    const button = $(`[data-correct-submission="${id}"]`);
    if (!button) { $('#application-reload').focus(); return; }
    for (let node = button.parentElement; node; node = node.parentElement) if (node.tagName === 'DETAILS') node.open = true;
    button.focus();
  }
  $('#cancel-submission-correction').addEventListener('click', () => {
    const id = correctionDraft?.id; clearCorrection(); if (id) focusCorrection(id);
  });
  for (const name of ['resumeFileId', 'coverFileId']) material.elements[name].addEventListener('change', () => { material.elements.confirmed.checked = false; });
  for (const name of ['materialId', 'channel']) submission.elements[name].addEventListener('change', () => {
    submission.elements.confirmed.checked = false; submission.elements.attachmentsComplete.checked = false; submission.elements.staleAcknowledged.checked = false;
  });
  function reset(id) {
    clearRehearsal();
    $('#confirmation-status').textContent=''; $('#pairing-entry-status').textContent=''; preparationState = null; questionState = null; $('#application-form-preview').replaceChildren(); preparation.reset(); $('#preparation-status').textContent = ''; $('#preparation-summary').replaceChildren(); $('#preparation-panel').open = false;
    revision++; jobId = id; state = null; schoolContext = null; $('#submission-school-context').textContent = ''; dirty.clear(); clearPreview();
    clearDraft(); clearEdit(); clearCorrection(); submissionRequestId = crypto.randomUUID(); submissionPayload = null;
    $('#generated-list').replaceChildren(); $('#generation-panel').open = false;
    for(const section of ['browser-assistant','submission-details','history-details','review-materials','upload-existing','channel-details']) $('#'+section).open=false;
    $('#prepare-baseline').hidden=true; $('#application-panel').hidden = !id; $('#application-fields').disabled = true;
    $('#material-history').replaceChildren(); $('#application-status').textContent = id ? '正在读取材料与记录…' : ''; $('#material-context').textContent = '';
    for (const id of ['confirmation-form', 'channel-form', 'material-form', 'submission-form', 'material-upload']) $(`#${id}`).reset();
    $('#confirmation-form').elements.date.value=localDate();
    material.elements.resumeFileId.replaceChildren(); material.elements.coverFileId.replaceChildren(); submission.elements.materialId.replaceChildren();
    const captured = revision;
    if (id) refresh().catch(error => { if (revision === captured) $('#application-status').textContent = `材料区读取失败：${error.message}。可点击刷新重试。`; });
  }
  function options(select, rows, empty) {
    const selected = select.value;
    select.replaceChildren(new Option(empty, ''), ...rows.map(row => new Option(row.label, row.id)));
    if (rows.some(row => row.id === selected)) select.value = selected;
  }
  async function refresh() {
    const captured = revision, request = ++requestId, target = jobId;
    if (!target) return;
    const [next, files, generated, nextSchool, nextPreparation, nextQuestions] = await Promise.all([api(`/api/jobs/${target}/application`), api('/api/files'), api(`/api/jobs/${target}/generation`), api(`/api/jobs/${target}/school-context`), api(`/api/jobs/${target}/preparation`), api(`/api/jobs/${target}/question-draft`)]);
    if (captured !== revision || request !== requestId) return;
    const schoolChanged = state && schoolContext?.revision !== nextSchool?.revision;
    if (schoolChanged) { submission.elements.confirmed.checked = false; submission.elements.attachmentsComplete.checked = false; }
    schoolContext = nextSchool;
    $('#submission-school-context').hidden=!schoolContext && !schoolChanged;
    $('#submission-school-context').textContent = `${schoolChanged ? '学校关联已变化，请重新核对并确认。' : ''}${schoolContext ? `学校提交将对应 School ID ${schoolContext.schoolId}：${schoolContext.company} · ${schoolContext.title}` : '尚未关联 School ID；学校提交将保留为未关联记录，不自动推断学校编号。'}`;
    if (state?.context.hash !== next.context.hash) material.elements.confirmed.checked = false;
    if (draft && draft.contextHash !== next.context.hash) clearDraft();
    if (editDraft && editDraft.contextHash !== next.context.hash) $('#word-edit-status').textContent = '岗位或简历已变化，不能保存此修改；文字已保留供你复制，请取消后重新生成。';
    state = next;
    if (!dirty.has('preparation-form')) {
      preparation.elements.notes.value = nextPreparation.notes;
      preparation.elements.reviewed.checked = nextPreparation.reviewed;
      preparationState = nextPreparation;
    } else if (preparationState?.basis !== nextPreparation.basis || preparationState?.revision !== nextPreparation.revision) {
      preparation.elements.reviewed.checked = false;
    }
    $('#preparation-status').textContent = nextPreparation.stale ? '依据已变化，旧草稿保留，请重新核对。' : nextPreparation.reviewed ? '草稿已核对；尚不代表已投递。' : '准备草稿待核对。';
    if (!dirty.has('application-questions')) {
      questionState = nextQuestions;
      if (nextQuestions.draft) drawQuestions(nextQuestions.draft.form, nextQuestions.draft.answers);
    }
    const summary = $('#preparation-summary'); summary.replaceChildren();
    summary.append(el('p', '待完成渠道：' + (state.required.filter(c => !state.submissions.some(s => s.channel === c)).map(c => channels[c]).join('、') || (state.complete ? '均已记录提交' : '请先选择申请渠道'))));
    const latest = state.versions.find(v => !v.stale);
    summary.append(el('p', latest ? '当前已审阅材料：' + latest.snapshot.resume.name : '尚无对应当前依据的已审阅材料'));
    if (latest) { const view = el('button', '预览当前已审阅简历'); view.type = 'button'; view.addEventListener('click', () => action('#preparation-status', () => preview(latest.snapshot.resume.id))); summary.append(view); }
    if (state.context.job.url) { const link = el('a', '打开官网申请入口'); link.href = state.context.job.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; summary.append(link); }
    if (nextSchool) summary.append(el('p', '学校入口请在本人 portal 打开 School ID ' + nextSchool.schoolId));
    if (correctionDraft) correctionChannels(correction.elements.channel.value);
    if (correctionDraft && schoolChanged) $('#correction-status').textContent = '学校关联已变化；更正输入已保留，首次改为学校渠道前请取消并重新核对。';
    if (correctionDraft && state.submissions.find(row => row.id === correctionDraft.id)?.revision !== correctionDraft.revision) {
      $('#correction-status').textContent = '此记录已有更新；输入已保留，请取消更正，查看最新历史后重新填写。';
    }
    const pdfs = files.filter(file => file.format === 'pdf').map(file => ({ id: file.id, label: `${file.name} · ${file.sha256.slice(0, 8)}` }));
    options(material.elements.resumeFileId, pdfs.filter(f=>files.find(x=>x.id===f.id).kind!=='cover'), '请选择一页简历 PDF');
    options(material.elements.coverFileId, pdfs.filter(f=>files.find(x=>x.id===f.id).kind!=='resume'), '不附 Cover Letter（选填）');
    if (!material.elements.resumeFileId.value && !dirty.has('material-form')) {
      const latest = generated.find(row => !row.stale && files.some(file=>file.id===row.pdfId));
      if (latest) material.elements.resumeFileId.value = latest.pdfId;
    }
    if (!dirty.has('channel-form')) $('#channel-form').elements.channel.value = state.channel;
    options(submission.elements.materialId, state.versions.map((version, index) => ({ id: version.id, label: `版本 ${state.versions.length - index} · ${version.snapshot.resume.name}${version.stale ? ' · 依据已变化' : ''}` })), '请选择实际使用的版本');
    $('#material-context').textContent = state.context.ready ? `对应已保存的岗位与简历：${state.context.resume.name} · ${state.context.hash.slice(0, 8)}` : '先保存完整 JD，并在“我的文件”核对启用简历，再保存材料版本。';
    $('#confirmation-status').textContent=submissionSummary(state.submissions);
    $('#application-status').textContent = state.context.ready ? '岗位与简历已就绪，可准备材料。' : '下一步：'+(!state.context.job.jd?'补充职位 JD。':'在“我的文件”启用你的简历。');
    $('#generation-panel').open=Boolean(state.context.ready);
    $('#prepare-baseline').hidden=Boolean(state.context.ready || !state.context.job.jd);
    $('#channel-details').open=Boolean(schoolContext && state.channel==='unknown');
    $('#application-fields').disabled = false;
    drawHistory();
    $('#generated-list').replaceChildren();
    for (const row of generated) {
      const section = document.createElement('details');
      section.append(el('summary', `生成稿 · ${new Date(row.created).toLocaleString()}${row.stale ? ' · 依据已变化' : ' · 一页校验通过'}`));
      section.append(el('p', `基准：${row.snapshot.context.resume.name}；${row.snapshot.parentId ? '本人手动修改，旧稿保留' : '仅原文重排'}，尚需审阅 PDF。`));
      for (const change of row.snapshot.review.edits ?? []) section.append(el('p', `修改前：${change.original}`), el('p', `修改后：${change.text}`));
      for (const group of row.snapshot.review.groups) {
        const review = document.createElement('details'); review.append(el('summary', `${group.label} · ${group.accepted ? '已应用' : '保留原顺序'}`));
        for (const item of group.rows) review.append(el('p', `原文：${item.original}`), el('p', `建议：${item.proposed}`));
        section.append(review);
      }
      const select = el('button', '选用此 PDF'), view = el('button', '预览生成稿'), download = el('button', '下载 Word');
      select.type = view.type = download.type = 'button';
      select.dataset.fileArchived=String(!files.some(file=>file.id===row.pdfId));select.disabled=select.dataset.fileArchived==='true';if(select.disabled)section.append(el('p','此生成稿已归档，仅供历史查看；还原后可重新选用。'));
      select.addEventListener('click', () => {
        if (row.stale) { $('#application-status').textContent = '该生成稿依据已变化，请重新生成。'; return; }
        if(!files.some(file=>file.id===row.pdfId)){$('#application-status').textContent='此文件已归档，请先在回收站还原';return;}
        material.elements.resumeFileId.value = row.pdfId; material.elements.confirmed.checked = false; dirty.add('material-form'); $('#review-materials').open=true;
        $('#application-status').textContent = '已选入材料，请预览后确认';
      });
      view.addEventListener('click', () => action('#application-status', () => preview(row.pdfId,!files.some(file=>file.id===row.pdfId))));
      download.addEventListener('click', () => action('#application-status', () => downloadFile({ id: row.docxId, name: 'resume.docx' })));
      const edit = el('button', '修改文字并另存'); edit.type = 'button';edit.dataset.fileArchived=String(!files.some(file=>file.id===row.docxId));edit.disabled=edit.dataset.fileArchived==='true';
      edit.addEventListener('click', () => action('#application-status', async () => {
        if (row.stale || jobDirty()) throw new Error('请先保存岗位；依据已变化的稿件需要重新生成');
        if (editDraft) throw new Error('请先保存或取消当前文字编辑');
        const next = await api(`/api/jobs/${jobId}/generation/${row.id}/edit-draft`, { method: 'POST', value: {} });
        if (!next.fields.length) throw new Error('此稿没有可安全编辑的正文段落，请修改自己的 Word 原稿后重新上传');
        editDraft = next; editForm.hidden = false; showAvailability('edit', next.availability);
        $('#word-edit-source').textContent = `来源生成稿：${new Date(row.created).toLocaleString()} · ${row.id.slice(0, 8)}`;
        for (const field of next.fields) {
          const label = el('label', field.label), input = document.createElement('textarea');
          input.name = `paragraph-${field.paragraph}`; input.value = field.original; input.rows = 4; input.maxLength = 2000; input.required = true;
          input.addEventListener('input', () => { editForm.elements.confirmed.checked = false; });
          label.append(input); $('#word-edit-fields').append(label);
        }
        editForm.scrollIntoView({ block: 'start' }); editForm.querySelector('textarea').focus();
        $('#application-status').textContent = '已打开文字编辑，保存前会重新检查一页版式';
      }));
      section.append(select, view, edit, download); $('#generated-list').append(section);
    }
  }
  $('#read-application-form').addEventListener('click', () => action('#preparation-status', async () => {
    if (!preparationState || jobDirty() || dirty.has('channel-form')) throw new Error('请先保存岗位和渠道并刷新准备依据');
    if (dirty.has('application-questions')) throw new Error('问题仍有未保存的编辑，请先保存或放弃本次问题编辑');
    const captured = revision, target = jobId;
    const result = await api('/api/jobs/' + target + '/application-form', {method:'POST',value:{basis:preparationState.basis}});
    if (captured !== revision) return;
    if (questionState?.draft && (questionState.draft.form.source !== result.source || JSON.stringify(questionState.draft.form.questions) !== JSON.stringify(result.questions))) {
      drawQuestionChanges(result); return;
    }
    drawQuestions(result, questionState?.draft?.answers);
    dirty.add('application-questions');
    $('#preparation-status').textContent = '问题读取完成，可直接保存逐题草稿。';
  }));
  function clearRehearsal() {
    if (rehearsalDialog) { rehearsalDialog.close(); rehearsalDialog.remove(); rehearsalDialog=null; }
  }
  async function rehearse() {
    if (!questionState?.draft || dirty.has('application-questions') || jobDirty() || dirty.has('channel-form')) throw new Error('请先保存岗位、渠道和逐题草稿');
    const captured=revision, target=jobId;
    const value={revision:questionState.revision,basis:questionState.basis};
    const plan=await api('/api/jobs/'+target+'/fill-rehearsal',{method:'POST',value});
    if (captured!==revision) return;
    clearRehearsal();
    const dialog=document.createElement('dialog'); rehearsalDialog=dialog;
    dialog.setAttribute('aria-label','本机填写预演');
    dialog.append(el('h3','本机填写预演'),el('p','只操作下方模拟表单，不打开招聘网站，也不会上传或提交。请逐项核对拟填写内容。关闭后预演内容丢弃，已保存草稿不变。'));
    const targets=plan.fields.map(field=>{
      const row=document.createElement('section'), label=el('label','模拟字段：'+field.label), input=document.createElement('input');
      input.type='text'; input.autocomplete='off'; input.dataset.question=String(field.index); label.append(input);
      row.append(el('p',field.label+' · 拟填写：'+field.answer),label); dialog.append(row); return input;
    });
    const pending=document.createElement('details'); pending.append(el('summary','需本人处理 · '+plan.manual.length));
    for (const item of plan.manual) pending.append(el('p',(item.required?'必填：':'选填：')+item.label+' · '+item.reason)); dialog.append(pending);
    const consent=document.createElement('input'); consent.type='checkbox';
    const label=el('label','我已核对以上内容，确认填入本机模拟表单'); label.className='check'; label.prepend(consent);
    const fill=el('button','确认本次模拟填写'); fill.type='button';
    const status=el('p',''); status.id='rehearsal-status'; status.setAttribute('role','status');
    let completed=false;
    fill.addEventListener('click',()=>action('#rehearsal-status',async()=>{
      if (completed) throw new Error('本次预演已完成，请关闭后重新开始');
      if (!consent.checked) throw new Error('请先核对并勾选本次填写确认');
      if (dirty.has('application-questions') || jobDirty() || dirty.has('channel-form')) throw new Error('工作区输入有变化，请保存后重新预演');
      if (!targets.length) throw new Error('没有可填写的普通文本答案，请先在草稿选择并填写');
      const next=await api('/api/jobs/'+target+'/fill-rehearsal',{method:'POST',value:{...value,fingerprint:plan.fingerprint,confirmed:true}});
      if (captured!==revision || rehearsalDialog!==dialog || !dialog.open) return;
      if (next.fingerprint!==plan.fingerprint || targets.some((input,i)=>!dialog.contains(input) || input.type!=='text' || input.dataset.question!==String(plan.fields[i].index) || input.value!=='')) throw new Error('模拟字段已有内容或结构变化，已暂停；不会覆盖，请关闭后重新预演');
      targets.forEach((input,i)=>{input.value=next.fields[i].answer; input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true}));});
      completed=true; status.textContent='本机预演完成 · '+targets.length+' 个字段；尚未填写招聘网站或投递。';
    }));
    const close=el('button','关闭预演'); close.type='button'; close.addEventListener('click',clearRehearsal);
    dialog.addEventListener('cancel',event=>{event.preventDefault();clearRehearsal();});
    dialog.append(label,fill,close,status); document.body.append(dialog); dialog.showModal(); close.focus(); $('#preparation-status').textContent='本机预演已打开，尚未填写任何字段。';
  }
  function drawQuestionChanges(result) {
    const previous = questionState, target = jobId, captured = revision;
    drawQuestions(previous.draft.form, previous.draft.answers);
    const box = document.createElement('section');
    const diff = questionDiff(previous.draft.form.questions,result.questions);
    box.append(el('h4','官网问题版本对照'),el('p','请同时核对当前岗位与简历依据。旧题和答案仍在下方。启用后所有新题答案为空，旧答案可从历史查看。问题改名或重名按删除与新增列出，不猜测对应关系。'));
    box.append(el('p','原来源：'+previous.draft.form.source),el('p','新来源：'+result.source),el('p','新读取时间：'+new Date(result.checkedAt).toLocaleString()));
    for (const [label,rows] of [['新增',diff.added],['删除',diff.removed]]) {
      box.append(el('h5',label + ' · ' + rows.length));
      for (const q of rows) box.append(el('pre',describeQuestion(q)));
    }
    box.append(el('h5','变更 · ' + diff.changed.length));
    for (const q of diff.changed) box.append(el('pre','原：' + describeQuestion(q.before) + '\n新：' + describeQuestion(q.after)));
    if (!diff.added.length && !diff.removed.length && !diff.changed.length) box.append(el('p','问题顺序或来源变化，请对照官网核实。'));
    const confirmInput = document.createElement('input'); confirmInput.type = 'checkbox';
    const label = el('label','我已核对差异，启用新问题并保留旧答案历史'); label.className='check'; label.prepend(confirmInput);
    const apply = el('button','确认启用新问题版本'); apply.type='button';
    apply.addEventListener('click',()=>action('#preparation-status',async()=>{
      if (!confirmInput.checked) throw new Error('请先核对并勾选版本确认');
      if (questionState !== previous || dirty.has('application-questions') || jobDirty() || dirty.has('channel-form')) throw new Error('旧稿或依据有编辑，请先保存并重新读取对照');
      const next = await api('/api/jobs/'+target+'/question-draft',{method:'PUT',value:{revision:previous.revision,basis:result.basis,replaceConfirmed:true,reconfirmed:true,draft:{form:result,answers:result.questions.map(()=>({selected:false,answer:''}))}}});
      if (captured !== revision) return;
      questionState=next; drawQuestions(next.draft.form,next.draft.answers);
      $('#preparation-status').textContent='新问题版本已启用，答案为空；旧题与答案已归档。';
    }));
    const cancel = el('button','暂不启用，保留旧版本'); cancel.type='button'; cancel.addEventListener('click',()=>box.remove());
    box.append(label,apply,cancel); $('#application-form-preview').prepend(box);
    $('#preparation-status').textContent='发现官网问题变化，请核对差异；尚未替换。';
  }
  function describeQuestion(q) {
    return '['+q.section+'] '+(q.required?'必填：':'选填：')+q.label+'\n'+q.fields.map(f=>({input_text:'文本',textarea:'长文本',input_file:'上传附件',multi_value_single_select:'单选',multi_value_multi_select:'多选'}[f.type] || '需到官网核对')+(f.options.length?' · '+f.options.join(' / '):'')).join('\n');
  }
  function drawQuestions(result, saved = []) {
    const area = $('#application-form-preview'); area.replaceChildren();
    area.append(el('h4', result.title), el('p', result.notice), el('p', '读取时间：' + new Date(result.checkedAt).toLocaleString()));
    for (const warning of result.warnings || []) area.append(el('p', warning));
    const source = el('a', '查看官方接口来源'); source.href = result.source; source.target = '_blank'; source.rel = 'noopener noreferrer'; area.append(source);
    const lines = result.questions.map(q => '[' + (q.section || '申请问题') + '] ' + (q.required ? '必填：' : '选填：') + q.label + '\n' + q.fields.map(f => '填写方式：' + ({input_file:'上传附件',textarea:'长文本',input_text:'文本',input_hidden:'官网自动处理',multi_value_single_select:'单选',multi_value_multi_select:'多选'}[f.type] || '需到官网核对') + (f.options.length ? '；选项：' + f.options.join(' / ') : '')).join('\n'));
    area.append(el('p', '仅勾选的问题会加入草稿。这里的答案是本机草稿，不会填写到官网。附件问题可记录待办，不会上传文件。'));
    const connect=document.createElement('details'); connect.id='browser-pairing'; connect.append(el('summary','连接 Brave / Chrome / Edge 填写助手'));
    connect.append(el('p','先从项目 browser-extension 目录安装本机扩展。在对应 Greenhouse 页打开扩展，粘贴配对码后预览并确认。配对码3分钟有效、确认使用一次；重新生成会使旧码失效，退出登录或草稿变化也会失效。'));
    const allowed=document.createElement('input'); allowed.type='checkbox'; const consent=el('label','允许本次扩展读取本职位的普通文本答案');consent.className='check';consent.prepend(allowed);
    const pair=el('button','生成临时配对码');pair.type='button';const output=document.createElement('input');output.type='password';output.readOnly=true;output.setAttribute('aria-label','临时配对码');output.hidden=true;
    const copy=el('button','复制配对码');copy.type='button';copy.hidden=true;
    pair.addEventListener('click',()=>action('#preparation-status',async()=>{
      if(!allowed.checked || !questionState || dirty.has('application-questions') || jobDirty() || dirty.has('channel-form')) throw new Error('请先保存草稿，并勾选本次扩展读取确认');
      const captured=revision;const next=await api('/api/jobs/'+jobId+'/browser-fill-code',{method:'POST',value:{revision:questionState.revision,basis:questionState.basis,confirmed:true}});
      if(captured!==revision)return;output.value=next.code;output.hidden=copy.hidden=false;
      $('#preparation-status').textContent='配对码已生成，3分钟有效。请仅粘贴到本机 Career Queue 扩展，不发送给他人。';
    }));
    copy.addEventListener('click',()=>action('#preparation-status',async()=>{await navigator.clipboard.writeText(output.value);$('#preparation-status').textContent='配对码已复制，请在对应岗位页打开扩展。';}));
    connect.append(consent,pair,output,copy);area.append(connect);
    const simulate=el('button','预演普通文本填写'); simulate.type='button'; simulate.addEventListener('click',()=>action('#preparation-status',rehearse)); area.append(simulate);
    const history = document.createElement('details'); history.append(el('summary','旧问题与答案历史 · '+(questionState?.history?.length || 0)));
    for (const item of questionState?.history || []) {
      const view=el('button','查看旧稿 '+item.revision+' · '+new Date(item.archived).toLocaleString()); view.type='button';
      const content=document.createElement('div');
      view.addEventListener('click',()=>action('#preparation-status',async()=>{
        const captured=revision, record=await api('/api/jobs/'+jobId+'/question-history/'+item.revision);
        if (captured!==revision) return;
        content.replaceChildren(el('p',record.draft.form.source));
        record.draft.form.questions.forEach((q,i)=>content.append(el('pre',describeQuestion(q)+'\n'+(record.draft.answers[i].selected?'已选择':'未选择')+' · 旧答案：'+record.draft.answers[i].answer)));
      })); history.append(view,content);
    } area.append(history);
    const editors = lines.map((line, index) => {
      const row = document.createElement('fieldset'), legend = el('legend', result.questions[index].label);
      const label = el('label', '加入草稿：' + result.questions[index].label), selected = document.createElement('input');
      selected.type = 'checkbox'; selected.checked = saved[index]?.selected ?? false; label.className = 'check'; label.prepend(selected);
      const answerLabel = el('label', '答案草稿：' + result.questions[index].label), answer = document.createElement('textarea');
      answer.value = saved[index]?.answer ?? ''; answer.rows = 3; answer.maxLength = 4000; answerLabel.append(answer);
      row.append(legend, el('pre', line), label, answerLabel); area.append(row);
      row.addEventListener('input', () => { dirty.add('application-questions'); reconfirm.checked = false; });
      return { selected, answer, line };
    });
    const discard = el('button', '放弃本次问题编辑'); discard.type = 'button';
    discard.addEventListener('click', () => {
      if (dirty.has('application-questions') && !confirm('放弃尚未保存的问题选择和答案？已保存的草稿保持不变。')) return;
      area.replaceChildren(); dirty.delete('application-questions'); if (questionState?.draft) drawQuestions(questionState.draft.form, questionState.draft.answers); $('#preparation-status').textContent = '本次问题编辑已放弃，原草稿保留。';
    }); area.append(discard);
    const reconfirm = document.createElement('input'); reconfirm.type = 'checkbox';
    const confirmation = el('label', '我已重新核对当前岗位与简历依据'); confirmation.className = 'check'; confirmation.prepend(reconfirm);
    area.append(el('p', questionState?.stale ? '依据已变化，旧答案保留；保存前请重新核对。' : '逐题草稿仅属于当前账号、当前职位。'), confirmation);
    const save = el('button', '保存逐题草稿'); save.type = 'button';
    save.addEventListener('click', () => action('#preparation-status', async () => {
      if (!questionState || jobDirty() || dirty.has('channel-form')) throw new Error('请先保存岗位和渠道，再刷新材料区核对依据');
      const captured = revision;
      const next = await api('/api/jobs/' + jobId + '/question-draft', {method:'PUT',value:{revision:questionState.revision,basis:questionState.basis,reconfirmed:reconfirm.checked,draft:{form:{...result,warnings:result.warnings || []},answers:editors.map(row=>({selected:row.selected.checked,answer:row.answer.value}))}}});
      if (captured !== revision) return;
      questionState = next; dirty.delete('application-questions'); drawQuestions(next.draft.form,next.draft.answers);
      $('#preparation-status').textContent = '逐题草稿已保存，刷新后可继续编辑；尚未投递。';
    })); area.append(save);
    let adopted = false;
    const adopt = el('button', '追加所选问题与答案'); adopt.type = 'button';
    adopt.addEventListener('click', () => {
      if (adopted) { $('#preparation-status').textContent = '这次读取的问题已经追加，请勿重复添加。'; return; }
      if (jobDirty() || dirty.has('channel-form') || questionState?.stale) { $('#preparation-status').textContent = '依据已变化，请重新读取'; return; }
      const selected = editors.filter(row => row.selected.checked);
      if (!selected.length) { $('#preparation-status').textContent = '请先勾选需要加入草稿的问题。'; return; }
      if (editors.some(row => !row.selected.checked && row.answer.value.trim())) { $('#preparation-status').textContent = '有未勾选的问题填写了答案，请勾选或清空该答案后再追加，避免丢失。'; return; }
      const text = [preparation.elements.notes.value, 'Greenhouse：' + result.title + '\n' + result.source + '\n' + result.checkedAt, ...selected.map(row => row.line + '\n答案：' + row.answer.value.trim())].filter(Boolean).join('\n\n');
      if (text.length > 12000) { $('#preparation-status').textContent = '合并后超过12000字，请手动选取需要的问题；原草稿未改'; return; }
      preparation.elements.notes.value = text; preparation.elements.reviewed.checked = false; dirty.add('preparation-form'); adopted = true; adopt.disabled = true;
      $('#preparation-status').textContent = '所选问题和答案已追加，请在下方草稿继续修改并保存。';
    }); area.append(adopt);
  }
  $('#preparation-reload').addEventListener('click', () => action('#preparation-status', async () => {
    const captured = revision, target = jobId;
    const next = await api('/api/jobs/' + target + '/preparation');
    if (captured !== revision) return;
    preparationState = next; preparation.elements.reviewed.checked = false;
    dirty.add('preparation-form');
    await refresh(); $('#preparation-status').textContent = '已刷新依据并保留文字，请核对后保存。';
  }));
  preparation.addEventListener('submit', event => { event.preventDefault(); action('#preparation-status', async () => {
    if (dirty.has('application-questions')) throw new Error('请先保存逐题草稿；逐题编辑仍保留');
    if (!preparationState || jobDirty() || dirty.has('channel-form')) throw new Error('请先保存岗位和渠道，再刷新准备依据；文字已保留');
    const captured = revision;
    const next = await api('/api/jobs/' + jobId + '/preparation', { method: 'PUT', value: { revision: preparationState.revision, basis: preparationState.basis, notes: preparation.elements.notes.value, reviewed: preparation.elements.reviewed.checked } });
    if (captured !== revision) return;
    preparationState = next; dirty.delete('preparation-form');
    $('#preparation-status').textContent = next.reviewed ? '准备草稿已保存并核对，尚未投递。' : '准备草稿已保存，待核对。';
  }); });
  async function preview(fileId,historical=false) {
    if (!fileId) throw new Error('请先选择 PDF 文件');
    const result = await api(`/api/files/${fileId}/${historical?'history-preview':'preview'}`, { method: 'POST', value: {} });
    $('#pdf-title').textContent = `${result.name} · ${result.pages} 页`;
    $('#pdf-pages').replaceChildren(...result.images.map((image, index) => {
      const figure = document.createElement('figure'), img = document.createElement('img');
      img.src = `data:image/png;base64,${image}`; img.alt = `${result.name}，第 ${index + 1} 页`;
      figure.append(img, el('figcaption', `第 ${index + 1} / ${result.pages} 页`)); return figure;
    }));
    previewDialog.showModal(); $('#close-pdf').disabled = false; $('#close-pdf').focus();
    $('#application-status').textContent = historical?'历史预览完成；不作为新材料的审阅确认。':'预览完成；请关闭预览后核对并勾选确认。';
  }
  function drawHistory() {
    $('#material-history').replaceChildren();
    for(const record of state.submissions.filter(row=>!row.materialId)) $('#material-history').append(el('p',`${channels[record.channel]} · ${record.date || '提交日期未知'} · 来源：${record.source==='school-portal'?'学校 Portal 状态':'本人提交确认'}${record.receipt?' · '+record.receipt:''}（未关联本机材料）`));
    for (const [index, version] of state.versions.entries()) {
      const section = document.createElement('details');
      section.append(el('summary', `版本 ${state.versions.length - index} · ${new Date(version.created).toLocaleString()}${version.stale ? ' · 依据已变化' : ' · 当前依据'}`));
      section.append(el('p', `基准：${version.snapshot.context.resume.name} · ${version.snapshot.context.hash.slice(0, 8)}`));
      for (const file of [version.snapshot.resume, version.snapshot.cover].filter(Boolean)) {
        const row = document.createElement('div'); row.className = 'actions'; row.append(el('span', `${file.name} · ${file.pages} 页`));
        const view = el('button', '预览'), download = el('button', '下载'); view.type = download.type = 'button';
        view.addEventListener('click', () => action('#application-status', () => preview(file.id,true)));
        download.addEventListener('click', () => action('#application-status', async () => { await downloadFile(file); $('#application-status').textContent = '已交给浏览器下载原件'; }));
        row.append(view, download); section.append(row);
      }
      const jd = document.createElement('details'); jd.append(el('summary', '当时的岗位与 JD'), el('p', `${version.snapshot.context.job.company} · ${version.snapshot.context.job.title}`), el('pre', version.snapshot.context.job.jd)); section.append(jd);
      for (const record of state.submissions.filter(record => record.materialId === version.id)) {
        const row = document.createElement('section'); row.className = 'submission-record';
        row.append(el('p', `${channels[record.channel]}已记录提交 · ${record.date || '提交日期未知'}${record.receipt ? ' · ' + record.receipt : ''}`));
        const correct = el('button', '更正这条提交记录'); correct.type = 'button'; correct.dataset.correctSubmission = record.id;
        correct.disabled = $('#application-reload').disabled;
        correct.addEventListener('click', () => {
          if (correctionDraft) { $('#correction-status').textContent = '请先保存或取消当前更正。'; correction.scrollIntoView({ block: 'start' }); return; }
          correctionDraft = { id: record.id, revision: record.revision ?? 0, requestId: crypto.randomUUID(), schoolRevision: schoolContext?.revision ?? null };
          correction.reset(); correction.hidden = false;
          correctionChannels(record.channel);
          correction.elements.date.value = record.date; correction.elements.receipt.value = record.receipt;
          $('#correction-source').textContent = `正在更正：${channels[record.channel]} · ${record.date || '提交日期未知'}。材料固定为版本 ${state.versions.length - index}：${version.snapshot.resume.name}。`;
          $('#correction-status').textContent = ''; correction.scrollIntoView({ block: 'start' }); correction.elements.date.focus();
        });
        row.append(correct);
        if (record.corrections?.length) {
          const audit = document.createElement('details'); audit.append(el('summary', `更正历史 · ${record.corrections.length} 次`));
          for (const change of record.corrections) {
            const entry = document.createElement('div'); entry.className = 'correction-entry';
            const description = value => `${channels[value.channel]} · ${value.date} · 回执：${value.receipt || '未填写'}`;
            entry.append(el('p', `更正前：${description(change.before)}`), el('p', `更正后：${description(change.after)}`), el('p', `原因：${change.reason}`), el('small', `${change.actor} · ${new Date(change.created).toLocaleString()}`)); audit.append(entry);
          }
          row.append(audit);
        }
        section.append(row);
      }
      $('#material-history').append(section);
    }
    if (!state.versions.length) $('#material-history').append(el('p', '尚未保存已审阅材料。'));
  }
  function confirmationControls(container,target,record,school) {
    if(record.materialId)return;
    const editor=document.createElement('details');editor.append(el('summary',record.withdrawn?'重新确认已提交':'更正日期 / 撤回误标'));
    const date=document.createElement('input');date.type='date';date.value=record.date || '';if(record.source==='school-portal')editor.append(el('p','日期可留空表示未知；观察时间和截止日期都不是提交日期。'));
    const receipt=document.createElement('input');receipt.value=record.receipt || '';receipt.maxLength=500;
    const reason=document.createElement('input');reason.maxLength=500;reason.placeholder='选填';
    for(const [text,input] of [['实际提交日期（按本人所在地）',date],['回执 / 备注',receipt],['更改原因',reason]]){const label=el('label',text);label.append(input);editor.append(label);}
    const checked=document.createElement('input');checked.type='checkbox';
    const label=el('label',record.withdrawn?'我已核对并确认实际提交成功':'我已核对本次更正；撤回仅取消本机误标，不撤销网站申请');label.className='check';label.prepend(checked);editor.append(label);
    if(school)editor.append(el('p','当前学校 ID：'+school.schoolId));
    const status=el('p','');status.setAttribute('role','status');let requestId=crypto.randomUUID();
    editor.addEventListener('input',()=>{requestId=crypto.randomUUID();});
    for(const [kind,text] of record.withdrawn?[['restore','确认实际提交，恢复记录']]:[['correct','更正日期 / 回执'],['withdraw','撤回误标已提交']]){
      const button=el('button',text);button.type='button';button.addEventListener('click',()=>action(status,async()=>{
        if(!checked.checked)throw new Error('请先核对并勾选本次操作确认');
        const value={action:kind,revision:record.revision,confirmed:true,requestId,date:date.value,receipt:receipt.value,reason:reason.value,timezoneOffset:new Date().getTimezoneOffset(),schoolRevision:school?.revision ?? null};
        await api(`/api/jobs/${target}/submission-confirmations/${record.id}/changes`,{method:'POST',value});
        await records();if(jobId===target)await refresh();
        $('#applications-status').textContent=kind==='withdraw'?'已撤回误标；草稿、材料和历史保留，可在已撤回历史中重新确认。':kind==='restore'?'已重新确认实际提交并恢复记录，未新增副本。':'更正已记录，原日期及原因保留在变更历史中。';
      }));editor.append(button);
    }
    editor.append(status);container.append(editor);
    if(record.corrections?.length){const history=document.createElement('details');history.append(el('summary','变更历史 · '+record.corrections.length));for(const change of record.corrections)history.append(el('p',`${{correct:'更正',withdraw:'撤回',restore:'重新确认'}[change.action]} · ${change.before.date} → ${change.after.date} · ${change.reason} · ${new Date(change.created).toLocaleString()}`));container.append(history);}
  }
  function records(force=true){return readView('applications',readRecords,{force});}
  async function readRecords(current) {
    const [rows,withdrawn]=await Promise.all([api('/api/applications'),api('/api/withdrawn-applications')]);if(!current())return;$('#applications-list').replaceChildren();historyHost.replaceChildren();renderApplicationTable(tableHost,rows,chooseJob);display();
    for(const channel of ['all']) {
      const group=document.createElement('section');
      const entries=rows;group.className='application-group';
      if(!entries.length)group.append(el('p','暂无记录'));
      for(const row of entries){
        const card=el('article','');card.className='recommendation-card application-record-card';card.dataset.jobId=row.jobId;card.dataset.channel=channel;
        const data=applicationCells(row),company=el('p',data.company),heading=el('h3',data.title),source=el('span',data.source);company.className='application-card-company';heading.title=data.title;source.className='application-source-badge';source.dataset.source=data.source==='学校'?'school':'external';card.append(company,heading,source);
        const summary=el('div','');summary.className='application-card-status';for(const value of data.status){const line=el('div',''),badge=el('span',value.slice(0,2)+' · '+value.slice(2)),matched=data.dates.find(d=>d.label===value.slice(0,2)),stamp=el('span',matched?.date||'—');badge.className='application-status-badge';badge.dataset.state=value.endsWith('已提交')?'submitted':'pending';stamp.className=matched?.date&&matched.date!=='—'?'application-date-value':'application-date-unknown';if(stamp.textContent==='—')stamp.setAttribute('aria-label','申请日期未知或尚未提交');line.append(badge,stamp);summary.append(line);}card.append(summary);
        const recordDetails=document.createElement('details');recordDetails.className='application-record-details';recordDetails.append(el('summary','记录详情与更正'));
        if(data.source==='学校') {
          const progress=row.channelProgress;const overview=el('div','');overview.className='channel-progress';
          overview.append(el('strong',progress.requirement),el('p',`学校 Portal：${progress.portal} · 官网：${progress.employer}`));
          if(progress.missing.includes('employer'))overview.append(el('p','尚需官网步骤：前往官网完成申请后，单独记录官网提交。'));
          if(progress.employer==='待确认')overview.append(el('p','学校提交不代表官网已提交。请核对该岗位是否还需要官网申请。'));
          for(const quote of row.requirement.evidence)overview.append(el('p','原文依据：'+quote));
          const label=el('label','核对申请途径'),choice=document.createElement('select');
          for(const [value,text] of [['unknown','待确认'],['both','学校 Portal + 官网'],['school-only','仅学校 Portal']])choice.append(new Option(text,value));choice.value=['both','school-only'].includes(row.channel)?row.channel:'unknown';label.append(choice);overview.append(label);
          const save=el('button','保存核对结果'),status=el('p','');save.type='button';status.setAttribute('role','status');save.addEventListener('click',()=>action(status,async()=>{await api(`/api/jobs/${row.jobId}/channel`,{method:'PUT',value:{channel:choice.value}});await records();if(jobId===row.jobId)await refresh();}));overview.append(save,status);recordDetails.append(overview);
        }
        for(const record of row.submissions){
          recordDetails.append(el('p',`${record.date || '提交日期未知'}${record.receipt?' · '+record.receipt:''} · ${record.source==='school-portal'?'学校 Portal 状态':'本人确认'}`));
          for(const evidence of record.portalEvidence || [])recordDetails.append(el('p',`学校 ID ${evidence.schoolId} · 首次观察 ${new Date(evidence.firstObserved).toLocaleString()}（非提交日期）`));
          confirmationControls(recordDetails,row.jobId,record,row.schoolContext);
        }
        const button=el('button','详情');button.type='button';button.className='application-detail-button';button.setAttribute('aria-label','查看 '+data.company+' · '+data.title+' 的申请详情');button.addEventListener('click',()=>chooseJob(row.jobId));card.append(recordDetails,button);group.append(card);
      }
      $('#applications-list').append(group);
    }
    if(!rows.length)$('#applications-list').append(el('p','尚无已提交记录。准备材料不会出现在这里；在网站实际提交后确认即可加入。'));
    if(withdrawn.length){
      const history=document.createElement('details');history.append(el('summary','已撤回历史（不计为已申请）'));
      for(const row of withdrawn)for(const record of row.withdrawn){const card=el('article','');card.className='recommendation-card';card.append(el('h3',row.company+' · '+row.title),el('p',`${channels[record.channel]} · 原记录日期 ${record.date || '提交日期未知'} · 已撤回`));confirmationControls(card,row.jobId,record,row.schoolContext);history.append(card);}
      historyHost.append(history);
    }
  }
  async function afterSave(message) {
    try { await refresh(); await records(); $('#application-status').textContent = message; }
    catch { $('#application-status').textContent = `${message}；列表刷新失败，请点击“刷新材料区”，无需重复保存。`; }
  }
  $('#application-reload').addEventListener('click', () => action('#application-status', async () => { await refresh(); await records(); }));
  editForm.addEventListener('submit', event => { event.preventDefault(); action('#word-edit-status', async () => {
    if (!editDraft || jobDirty()) throw new Error('请先保存职位信息，再核对编辑依据');
    const edits = editDraft.fields.map(field => ({ paragraph: field.paragraph, text: editForm.elements[`paragraph-${field.paragraph}`].value })).filter((change, index) => change.text.trim() !== editDraft.fields[index].original);
    if (!edits.length) throw new Error('没有文字变化，无需保存新版本');
    const value = { availability: editDraft.availability, fingerprint: editDraft.fingerprint, contextHash: editDraft.contextHash, edits, confirmed: editForm.elements.confirmed.checked, openConfirmed: editForm.elements.openConfirmed.checked };
    $('#word-edit-status').textContent = '正在检查字体、版式和一页限制；失败会保留输入…';
    const saved = await api(`/api/jobs/${jobId}/generation/${editDraft.parentId}/edit`, { method: 'POST', value });
    clearEdit(); await afterSave('修改稿已另存并选入材料；旧稿与提交记录保留，请重新预览后审阅');
    material.elements.resumeFileId.value = saved.pdfId; material.elements.confirmed.checked = false; dirty.add('material-form'); $('#review-materials').open=true;
    try { await filesChanged(); } catch { $('#application-status').textContent = '修改稿已保存，请刷新材料区查看，无需重复保存'; }
  }); });
  $('#prepare-word').addEventListener('click', () => action('#application-status', async () => {
    if (jobDirty()) throw new Error('请先保存职位信息，再准备修改对照');
    const next = await api(`/api/jobs/${jobId}/generation-draft`, { method: 'POST', value: {} });
    clearDraft(); draft = next; generationForm.hidden = false; showAvailability('generation', next.availability);
    $('#generation-baseline').textContent = `当前原稿：${draft.baseline.name} · ${draft.engine}`;
    for (const group of draft.groups) {
      const section = document.createElement('fieldset'); section.append(el('legend', group.label));
      for (const row of group.rows) {
        section.append(el('p', `原文：${row.original}`), el('p', `调整后：${row.proposed}`));
        section.append(el('small', `来源：当前原稿第 ${row.evidence.paragraph + 1} 段；${row.requirements.map(r => `JD 第 ${r.line} 行：${r.quote}`).join('；') || '无明确关键词对应'}`));
      }
      const label = el('label', '本组处理'), select = document.createElement('select'); select.name = group.id;
      select.append(new Option('保留原顺序', 'keep'), new Option('应用建议顺序', 'accept')); label.append(select); section.append(label); $('#generation-groups').append(section);
    }
    if (!draft.groups.length) $('#generation-groups').append(el('p', '没有可安全重排的要点；可按原文导出一页 PDF，不做额外改写。'));
    $('#application-status').textContent = '请核对原文与建议，再生成';
  }));
  generationForm.addEventListener('submit', event => { event.preventDefault(); action('#application-status', async () => {
    if (jobDirty() || !draft) throw new Error('请保存职位并重新准备对照');
    const value = { availability: draft.availability, contextHash: draft.contextHash, fingerprint: draft.fingerprint,
      decisions: draft.groups.map(group => ({ id: group.id, accepted: generationForm.elements[group.id].value === 'accept' })),
      confirmed: generationForm.elements.confirmed.checked, openConfirmed: generationForm.elements.openConfirmed.checked };
    $('#application-status').textContent = '正在生成并检查一页版式，请稍候…';
    const saved = await api(`/api/jobs/${jobId}/generation`, { method: 'POST', value });
    clearDraft(); await afterSave('生成稿已保存并选入材料；请预览后确认，不代表已投递');
    material.elements.resumeFileId.value = saved.pdfId; material.elements.confirmed.checked = false; dirty.add('material-form'); $('#review-materials').open=true;
    try { await filesChanged(); } catch { $('#application-status').textContent = '生成稿已保存，请刷新材料区查看；无需重新生成'; }
  }); });
  $('#channel-form').addEventListener('submit', event => { event.preventDefault(); action('#application-status', async () => {
    await api(`/api/jobs/${jobId}/channel`, { method: 'PUT', value: { channel: event.target.elements.channel.value } }); dirty.delete('channel-form'); await afterSave('渠道已保存；原提交历史保留');
  }); });
  $('#material-upload').addEventListener('submit', event => { event.preventDefault(); action('#application-status', async () => {
    const file = event.target.elements.file.files[0];
    if (!file || !file.name.toLowerCase().endsWith('.pdf') || file.size > 5 * 1024 * 1024) throw new Error('请选择不超过 5MB 的 PDF');
    const kind=event.target.elements.kind.value;const saved = await api('/api/files', { method: 'POST', file,kind }); event.target.reset(); dirty.delete('material-upload');
    await afterSave('PDF 原件已保存');
    material.elements[kind==='cover'?'coverFileId':'resumeFileId'].value = saved.id; material.elements.confirmed.checked = false; dirty.add('material-form'); $('#review-materials').open=true;
    try { await filesChanged(); } catch { $('#application-status').textContent = 'PDF 已保存；我的文件列表暂未刷新，可重新登录查看'; }
  }); });
  $('#preview-resume').addEventListener('click', () => action('#application-status', () => preview(material.elements.resumeFileId.value)));
  $('#preview-cover').addEventListener('click', () => action('#application-status', () => preview(material.elements.coverFileId.value)));
  material.addEventListener('submit', event => { event.preventDefault(); action('#application-status', async () => {
    if (jobDirty()) throw new Error('职位信息有未保存改动，请先保存职位再审阅材料');
    if (!state) throw new Error('请先刷新材料区');
    await api(`/api/jobs/${jobId}/materials`, { method: 'POST', value: { contextHash: state.context.hash, resumeFileId: material.elements.resumeFileId.value, coverFileId: material.elements.coverFileId.value, confirmed: material.elements.confirmed.checked } });
    dirty.delete('material-form'); material.elements.confirmed.checked = false; await afterSave('材料版本已保存，尚未记录实际提交');
  }); });
  let confirmationRequestId=crypto.randomUUID();
  $('#confirmation-form').addEventListener('input',()=>{confirmationRequestId=crypto.randomUUID();});
  $('#confirmation-form').addEventListener('submit',event=>{event.preventDefault();action('#confirmation-status',async()=>{
    const form=event.target;
    const value={channel:form.elements.channel.value,date:form.elements.date.value,receipt:form.elements.receipt.value,confirmed:form.elements.confirmed.checked,source:'manual-confirmation',timezoneOffset:new Date().getTimezoneOffset(),requestId:confirmationRequestId};
    if(value.channel==='school')value.schoolRevision=schoolContext?.revision ?? null;
    await api(`/api/jobs/${jobId}/submission-confirmation`,{method:'POST',value});
    dirty.delete('confirmation-form');form.reset();form.elements.date.value=localDate();confirmationRequestId=crypto.randomUUID();
    await afterSave('本人提交确认已记录，已加入申请记录。');
    $('#confirmation-status').textContent='已加入申请记录；来源：本人确认。';
  });});
  submission.addEventListener('submit', event => { event.preventDefault(); action('#application-status', async () => {
    if (jobDirty()) throw new Error('请先保存职位信息，或放弃未保存改动后再记录提交');
    const value = Object.fromEntries(['channel', 'materialId', 'date', 'receipt'].map(name => [name, submission.elements[name].value]));
    for (const name of ['confirmed', 'attachmentsComplete', 'staleAcknowledged']) value[name] = submission.elements[name].checked;
    if (value.channel === 'school') value.schoolRevision = schoolContext?.revision ?? null;
    const payload = JSON.stringify(value);
    if (submissionPayload && submissionPayload !== payload) submissionRequestId = crypto.randomUUID();
    submissionPayload = payload; value.requestId = submissionRequestId;
    await api(`/api/jobs/${jobId}/submission`, { method: 'POST', value }); dirty.delete('submission-form'); submission.reset();
    submissionRequestId = crypto.randomUUID(); submissionPayload = null;
    await afterSave('已记录本人实际提交；另一渠道的日期和材料保持独立');
  }); });
  correction.addEventListener('submit', event => {
    event.preventDefault(); let savedId = null;
    action('#correction-status', async () => {
      if (!correctionDraft) throw new Error('请先选择需要更正的提交记录');
      if (jobDirty() || dirty.has('channel-form')) throw new Error('请先保存职位和申请渠道，再更正提交记录；你的输入已保留');
      const value = Object.fromEntries(['channel', 'date', 'receipt', 'reason'].map(name => [name, correction.elements[name].value]));
      value.revision = correctionDraft.revision; value.requestId = correctionDraft.requestId; value.schoolRevision = correctionDraft.schoolRevision;
      await api(`/api/jobs/${jobId}/submissions/${correctionDraft.id}/corrections`, { method: 'POST', value });
      savedId = correctionDraft.id; clearCorrection(); await afterSave('提交记录已更正；原始记录、使用的材料和更正原因均已保留');
    }).then(() => { if (savedId) focusCorrection(savedId); });
  });
  return { reset, refresh, records, clearPreview, dirty: () => dirty.size > 0,
    clear: () => { reset(null); $('#applications-status').textContent=''; $('#applications-list').replaceChildren();tableHost.replaceChildren();historyHost.replaceChildren(); } };
}
