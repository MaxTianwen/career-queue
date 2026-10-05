const $ = selector => document.querySelector(selector);
const el = (tag, text) => { const node = document.createElement(tag); node.textContent = text; return node; };
const channels = { unknown: '待确认', employer: '官网', school: '学校', both: '官网 + 学校', 'school-only': '仅学校' };

export function applicationWorkspace({ api, action, jobDirty, chooseJob, downloadFile, filesChanged }) {
  let jobId = null, state = null, revision = 0, requestId = 0, schoolContext = null;
  const dirty = new Set();
  const material = $('#material-form'), submission = $('#submission-form');
  const correction = $('#submission-correction-form');
  let correctionDraft = null, submissionRequestId = crypto.randomUUID(), submissionPayload = null;
  const previewDialog = $('#pdf-dialog');
  let draft = null;
  const generationForm = $('#generation-form');
  let editDraft = null;
  const editForm = $('#word-edit-form');
  function clearEdit() { editDraft = null; editForm.reset(); editForm.hidden = true; $('#word-edit-fields').replaceChildren(); $('#word-edit-source').textContent = ''; $('#word-edit-status').textContent = ''; dirty.delete('word-edit-form'); }
  $('#cancel-word-edit').addEventListener('click', () => { clearEdit(); $('#prepare-word').focus(); });
  function clearDraft() { draft = null; generationForm.reset(); generationForm.hidden = true; $('#generation-groups').replaceChildren(); $('#generation-baseline').textContent = ''; dirty.delete('generation-form'); }
  function clearPreview() { previewDialog.close(); $('#pdf-pages').replaceChildren(); $('#pdf-title').textContent = 'PDF 预览'; }
  $('#close-pdf').addEventListener('click', clearPreview);
  previewDialog.addEventListener('cancel', event => { event.preventDefault(); clearPreview(); });
  previewDialog.addEventListener('click', event => {
    const r = previewDialog.getBoundingClientRect();
    if (event.target === previewDialog && (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom)) clearPreview();
  });
  for (const id of ['channel-form', 'material-form', 'submission-form', 'material-upload', 'generation-form', 'word-edit-form', 'submission-correction-form']) {
    $(`#${id}`).addEventListener('input', () => dirty.add(id));
  }
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
    revision++; jobId = id; state = null; schoolContext = null; $('#submission-school-context').textContent = ''; dirty.clear(); clearPreview();
    clearDraft(); clearEdit(); clearCorrection(); submissionRequestId = crypto.randomUUID(); submissionPayload = null;
    $('#generated-list').replaceChildren(); $('#generation-panel').open = false;
    $('#application-panel').hidden = !id; $('#application-fields').disabled = true;
    $('#material-history').replaceChildren(); $('#application-status').textContent = id ? '正在读取材料与记录…' : ''; $('#material-context').textContent = '';
    for (const id of ['channel-form', 'material-form', 'submission-form', 'material-upload']) $(`#${id}`).reset();
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
    const [next, files, generated, nextSchool] = await Promise.all([api(`/api/jobs/${target}/application`), api('/api/files'), api(`/api/jobs/${target}/generation`), api(`/api/jobs/${target}/school-context`)]);
    if (captured !== revision || request !== requestId) return;
    const schoolChanged = state && schoolContext?.revision !== nextSchool?.revision;
    if (schoolChanged) { submission.elements.confirmed.checked = false; submission.elements.attachmentsComplete.checked = false; }
    schoolContext = nextSchool;
    $('#submission-school-context').textContent = `${schoolChanged ? '学校关联已变化，请重新核对并确认。' : ''}${schoolContext ? `学校提交将对应 School ID ${schoolContext.schoolId}：${schoolContext.company} · ${schoolContext.title}` : '尚未关联 School ID；学校提交将保留为未关联记录，不自动推断学校编号。'}`;
    if (state?.context.hash !== next.context.hash) material.elements.confirmed.checked = false;
    if (draft && draft.contextHash !== next.context.hash) clearDraft();
    if (editDraft && editDraft.contextHash !== next.context.hash) $('#word-edit-status').textContent = '岗位或简历已变化，不能保存此修改；文字已保留供你复制，请取消后重新生成。';
    state = next;
    if (correctionDraft) correctionChannels(correction.elements.channel.value);
    if (correctionDraft && schoolChanged) $('#correction-status').textContent = '学校关联已变化；更正输入已保留，首次改为学校渠道前请取消并重新核对。';
    if (correctionDraft && state.submissions.find(row => row.id === correctionDraft.id)?.revision !== correctionDraft.revision) {
      $('#correction-status').textContent = '此记录已有更新；输入已保留，请取消更正，查看最新历史后重新填写。';
    }
    const pdfs = files.filter(file => file.format === 'pdf').map(file => ({ id: file.id, label: `${file.name} · ${file.sha256.slice(0, 8)}` }));
    options(material.elements.resumeFileId, pdfs, '请选择一页简历 PDF');
    options(material.elements.coverFileId, pdfs, '不附 Cover Letter');
    if (!material.elements.resumeFileId.value && !dirty.has('material-form')) {
      const latest = generated.find(row => !row.stale);
      if (latest) material.elements.resumeFileId.value = latest.pdfId;
    }
    if (!dirty.has('channel-form')) $('#channel-form').elements.channel.value = state.channel;
    options(submission.elements.materialId, state.versions.map((version, index) => ({ id: version.id, label: `版本 ${state.versions.length - index} · ${version.snapshot.resume.name}${version.stale ? ' · 依据已变化' : ''}` })), '请选择实际使用的版本');
    $('#material-context').textContent = state.context.ready ? `对应已保存的岗位与简历：${state.context.resume.name} · ${state.context.hash.slice(0, 8)}` : '先保存完整 JD，并在“我的文件”核对启用简历，再保存材料版本。';
    $('#application-status').textContent = `${state.status} · 渠道：${channels[state.channel]}`;
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
      select.addEventListener('click', () => {
        if (row.stale) { $('#application-status').textContent = '该生成稿依据已变化，请重新生成。'; return; }
        material.elements.resumeFileId.value = row.pdfId; material.elements.confirmed.checked = false; dirty.add('material-form');
        $('#application-status').textContent = '已选入材料，请预览后确认';
      });
      view.addEventListener('click', () => action('#application-status', () => preview(row.pdfId)));
      download.addEventListener('click', () => action('#application-status', () => downloadFile({ id: row.docxId, name: 'resume.docx' })));
      const edit = el('button', '修改文字并另存'); edit.type = 'button';
      edit.addEventListener('click', () => action('#application-status', async () => {
        if (row.stale || jobDirty()) throw new Error('请先保存岗位；依据已变化的稿件需要重新生成');
        if (editDraft) throw new Error('请先保存或取消当前文字编辑');
        const next = await api(`/api/jobs/${jobId}/generation/${row.id}/edit-draft`, { method: 'POST', value: {} });
        if (!next.fields.length) throw new Error('此稿没有可安全编辑的正文段落，请修改自己的 Word 原稿后重新上传');
        editDraft = next; editForm.hidden = false;
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
  async function preview(fileId) {
    if (!fileId) throw new Error('请先选择 PDF 文件');
    const result = await api(`/api/files/${fileId}/preview`, { method: 'POST', value: {} });
    $('#pdf-title').textContent = `${result.name} · ${result.pages} 页`;
    $('#pdf-pages').replaceChildren(...result.images.map((image, index) => {
      const figure = document.createElement('figure'), img = document.createElement('img');
      img.src = `data:image/png;base64,${image}`; img.alt = `${result.name}，第 ${index + 1} 页`;
      figure.append(img, el('figcaption', `第 ${index + 1} / ${result.pages} 页`)); return figure;
    }));
    previewDialog.showModal(); $('#close-pdf').disabled = false; $('#close-pdf').focus();
    $('#application-status').textContent = '预览完成；请关闭预览后核对并勾选确认。';
  }
  function drawHistory() {
    $('#material-history').replaceChildren();
    for (const [index, version] of state.versions.entries()) {
      const section = document.createElement('details');
      section.append(el('summary', `版本 ${state.versions.length - index} · ${new Date(version.created).toLocaleString()}${version.stale ? ' · 依据已变化' : ' · 当前依据'}`));
      section.append(el('p', `基准：${version.snapshot.context.resume.name} · ${version.snapshot.context.hash.slice(0, 8)}`));
      for (const file of [version.snapshot.resume, version.snapshot.cover].filter(Boolean)) {
        const row = document.createElement('div'); row.className = 'actions'; row.append(el('span', `${file.name} · ${file.pages} 页`));
        const view = el('button', '预览'), download = el('button', '下载'); view.type = download.type = 'button';
        view.addEventListener('click', () => action('#application-status', () => preview(file.id)));
        download.addEventListener('click', () => action('#application-status', async () => { await downloadFile(file); $('#application-status').textContent = '已交给浏览器下载原件'; }));
        row.append(view, download); section.append(row);
      }
      const jd = document.createElement('details'); jd.append(el('summary', '当时的岗位与 JD'), el('p', `${version.snapshot.context.job.company} · ${version.snapshot.context.job.title}`), el('pre', version.snapshot.context.job.jd)); section.append(jd);
      for (const record of state.submissions.filter(record => record.materialId === version.id)) {
        const row = document.createElement('section'); row.className = 'submission-record';
        row.append(el('p', `${channels[record.channel]}已记录提交 · ${record.date}${record.receipt ? ' · ' + record.receipt : ''}`));
        const correct = el('button', '更正这条提交记录'); correct.type = 'button'; correct.dataset.correctSubmission = record.id;
        correct.disabled = $('#application-reload').disabled;
        correct.addEventListener('click', () => {
          if (correctionDraft) { $('#correction-status').textContent = '请先保存或取消当前更正。'; correction.scrollIntoView({ block: 'start' }); return; }
          correctionDraft = { id: record.id, revision: record.revision ?? 0, requestId: crypto.randomUUID(), schoolRevision: schoolContext?.revision ?? null };
          correction.reset(); correction.hidden = false;
          correctionChannels(record.channel);
          correction.elements.date.value = record.date; correction.elements.receipt.value = record.receipt;
          $('#correction-source').textContent = `正在更正：${channels[record.channel]} · ${record.date}。材料固定为版本 ${state.versions.length - index}：${version.snapshot.resume.name}。`;
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
  async function records() {
    const rows = await api('/api/applications'); $('#applications-list').replaceChildren();
    for (const row of rows) {
      const card = el('article', ''); card.className = 'recommendation-card';
      card.append(el('small', row.company), el('h3', row.title), el('p', `${row.status} · ${channels[row.channel]}`));
      for (const record of row.submissions) card.append(el('p', `${channels[record.channel]} · ${record.date}${record.receipt ? ' · ' + record.receipt : ''}${record.revision ? ' · 已更正' : ''}`));
      const button = el('button', '查看材料与记录'); button.addEventListener('click', () => chooseJob(row.jobId)); card.append(button); $('#applications-list').append(card);
    }
    if (!rows.length) $('#applications-list').append(el('p', '尚无材料或提交记录。先从已保存职位开始准备。'));
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
    const value = { fingerprint: editDraft.fingerprint, contextHash: editDraft.contextHash, edits, confirmed: editForm.elements.confirmed.checked, openConfirmed: editForm.elements.openConfirmed.checked };
    $('#word-edit-status').textContent = '正在检查字体、版式和一页限制；失败会保留输入…';
    const saved = await api(`/api/jobs/${jobId}/generation/${editDraft.parentId}/edit`, { method: 'POST', value });
    clearEdit(); await afterSave('修改稿已另存并选入材料；旧稿与提交记录保留，请重新预览后审阅');
    material.elements.resumeFileId.value = saved.pdfId; material.elements.confirmed.checked = false; dirty.add('material-form');
    try { await filesChanged(); } catch { $('#application-status').textContent = '修改稿已保存，请刷新材料区查看，无需重复保存'; }
  }); });
  $('#prepare-word').addEventListener('click', () => action('#application-status', async () => {
    if (jobDirty()) throw new Error('请先保存职位信息，再准备修改对照');
    const next = await api(`/api/jobs/${jobId}/generation-draft`, { method: 'POST', value: {} });
    clearDraft(); draft = next; generationForm.hidden = false;
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
    const value = { contextHash: draft.contextHash, fingerprint: draft.fingerprint,
      decisions: draft.groups.map(group => ({ id: group.id, accepted: generationForm.elements[group.id].value === 'accept' })),
      confirmed: generationForm.elements.confirmed.checked, openConfirmed: generationForm.elements.openConfirmed.checked };
    $('#application-status').textContent = '正在生成并检查一页版式，请稍候…';
    const saved = await api(`/api/jobs/${jobId}/generation`, { method: 'POST', value });
    clearDraft(); await afterSave('生成稿已保存并选入材料；请预览后确认，不代表已投递');
    material.elements.resumeFileId.value = saved.pdfId; material.elements.confirmed.checked = false; dirty.add('material-form');
    try { await filesChanged(); } catch { $('#application-status').textContent = '生成稿已保存，请刷新材料区查看；无需重新生成'; }
  }); });
  $('#channel-form').addEventListener('submit', event => { event.preventDefault(); action('#application-status', async () => {
    await api(`/api/jobs/${jobId}/channel`, { method: 'PUT', value: { channel: event.target.elements.channel.value } }); dirty.delete('channel-form'); await afterSave('渠道已保存；原提交历史保留');
  }); });
  $('#material-upload').addEventListener('submit', event => { event.preventDefault(); action('#application-status', async () => {
    const file = event.target.elements.file.files[0];
    if (!file || !file.name.toLowerCase().endsWith('.pdf') || file.size > 5 * 1024 * 1024) throw new Error('请选择不超过 5MB 的 PDF');
    const saved = await api('/api/files', { method: 'POST', file }); event.target.reset(); dirty.delete('material-upload');
    await afterSave('PDF 原件已保存');
    material.elements.resumeFileId.value = saved.id; material.elements.confirmed.checked = false; dirty.add('material-form');
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
    clear: () => { reset(null); $('#applications-list').replaceChildren(); } };
}
