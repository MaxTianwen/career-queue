export function openPortalImport({ api, esc, showModal, onSaved }) {
  let rows = [], preview, filter = 'all';
  showModal('粘贴学校职位列表', '匹配已有申请，或保存未匹配的学校候选，再到学校本人提交。', `<div id="school-import"><form id="school-paste-form"><label>从学校网页复制列表（包含表头）<textarea name="text" rows="8" maxlength="150000" required placeholder="App Status    Term    ID    Job Title    Organization…"></textarea></label><p>每批最多 100 条。支持网页表格复制文字或 Markdown 表格；缺少链接也可匹配。</p><button class="button primary">识别列表</button></form><div id="school-import-result" aria-live="polite"></div><div id="school-import-error" class="feedback error" role="alert" hidden></div></div>`);
  const host = document.querySelector('#school-import'), result = host.querySelector('#school-import-result'), error = host.querySelector('#school-import-error');
  document.querySelector('#modal').classList.add('school-import-dialog');
  const fields = [['id','学校 ID'],['company','公司'],['title','职位'],['term','入职批次'],['location','地点'],['requisitionId','雇主编号'],['deadline','学校截止时间'],['url','学校链接（可空）'],['externalUrl','雇主链接（可空）']];
  const label = { linked: '已有关联', exact: '编号 / 链接匹配', possible: '需核对候选', unmatched: '没有匹配', invalid: '字段需修正' };
  function edits() {
    result.innerHTML = `<form id="school-match-form"><div class="school-import-heading"><h3>已识别 ${rows.length} 条</h3><button class="button primary">匹配已有申请</button></div><p>可展开修正字段。未匹配的岗位可在下一步选择“新增到 Queue”，补齐 JD 后再评分。</p>${rows.map((row, index) => `<details class="school-import-row"><summary><span class="badge">${esc(row.id)}</span> ${esc(row.company)} · ${esc(row.title)}</summary><div class="form-grid">${fields.map(([key, name]) => `<label>${name}<input data-row="${index}" data-field="${key}" value="${esc(key === 'deadline' ? row.deadlineText || row.deadline : row[key])}" ${['id','company','title'].includes(key) ? 'required' : ''} maxlength="${/Url|url/.test(key) ? 2000 : 300}" ${/Url|url/.test(key) ? 'type="url"' : ''}></label>`).join('')}</div>${row.parseWarning ? `<p class="warning">${esc(row.parseWarning)}</p>` : ''}${row.sourceStatus ? `<p>原页面 App Status：${esc(row.sourceStatus)}（仅作核对，不更新提交状态）</p>` : ''}</details>`).join('')}</form>`;
  }
  function matches() {
    const groups = preview.rows.map(portalFilterGroup);
    const filters = [['all', '全部'], ['not-found', '未发现'], ['review', '待核对']];
    const toolbar = '<div class="school-filter-bar" role="group" aria-label="学校对照筛选">' + filters.map(([key, label]) => '<button type="button" class="button secondary" data-school-filter="' + key + '" aria-pressed="false">' + label + ' · ' + (key === 'all' ? groups.length : groups.filter(g => g.key === key).length) + '</button>').join('') + '<button type="button" class="button secondary" id="school-clear-filter">清空筛选</button></div><p id="school-filter-count" role="status"></p><p id="school-filter-empty" hidden>当前筛选没有职位，可清空筛选查看全部。</p>';

    result.innerHTML = `<form id="school-save-form"><div class="school-import-heading"><h3>匹配结果 · ${preview.rows.length} 条</h3><button type="button" class="button secondary" id="school-edit">返回修正字段</button></div><p>只有勾选的关联或新候选会保存。同一申请一次只能关联一个学校 ID；标题相近仍需核实编号与地点。重新匹配后需重新勾选。</p>${toolbar}${preview.rows.map(item => {
      if (!item.row) return `<div class="school-import-row" data-school-index="${item.index}"><strong>第 ${item.index + 1} 条</strong><p>${esc(item.error)}</p></div>`;
      const candidates = new Map(item.candidates.map(c => [c.key, c]));
      const options = [...preview.jobs].sort((a,b) => Number(candidates.has(b.key)) - Number(candidates.has(a.key)));
      return `<article class="school-import-row" data-school-index="${item.index}"><div class="school-import-heading"><strong>${esc(item.row.company)} · ${esc(item.row.title)}</strong><span class="badge">${label[item.category]}</span></div><p>学校 ID ${esc(item.row.id)} · ${esc(item.row.term)} · ${esc(item.row.location)}${item.row.requisitionId ? ` · 雇主编号 ${esc(item.row.requisitionId)}` : ''}</p><p>学校截止：${esc(item.row.deadlineText || item.row.deadline || '待核实')}${!item.row.url ? ' · 尚无学校链接，可按 ID 查找' : ''}</p>${item.relatedSchoolIds?.length ? `<p class="warning">同一雇主编号也出现在学校 ID ${esc(item.relatedSchoolIds.join("、"))}，请核对后只选正确关联。</p>` : ''}<p class="school-filter-reason">${esc(portalFilterGroup(item).reason)}</p>${discoveryView(item, esc)}<label>对应本应用的申请<select data-target="${item.index}"><option value="">暂不保存</option>${item.category === 'unmatched' ? '<option value="__new__">新增到 Queue（待补 JD）</option>' : ''}${options.map(j => `<option value="${j.key}" ${item.suggestedKey === j.key ? 'selected' : ''}>${candidates.has(j.key) ? '候选 · ' : ''}${esc(j.company)} · ${esc(j.title)} · ${esc(j.term)} · ${j.externalSubmitted ? '官网已投' : '官网未确认投递'}${j.linkedId ? ` · 已关联学校 ${esc(j.linkedId)}` : ''}</option>`).join('')}</select></label><p data-evidence="${item.index}"></p><label class="check"><input type="checkbox" data-choice="${item.index}">我已核对，保存此选择</label></article>`;
    }).join('')}<div class="school-import-heading"><div><p id="school-selection-count" role="status"></p><span>保存全部勾选项（含筛选隐藏的选择），不会标记已提交。</span></div><button class="button primary">保存勾选项</button></div></form>`;
    const refreshFilter = () => applyPortalFilter(result, preview.rows, filter);
    result.querySelectorAll('[data-school-filter]').forEach(button => {
      button.onclick = () => { if (!host.dataset.busy) { filter = button.dataset.schoolFilter; refreshFilter(); } };
    });
    result.querySelector('#school-clear-filter').onclick = () => { if (!host.dataset.busy) { filter = 'all'; refreshFilter(); } };
    result.querySelectorAll('[data-choice]').forEach(input => input.addEventListener('change', refreshFilter));
    result.querySelectorAll('[data-target]').forEach(select => {
      const explain = () => {
        const item = preview.rows.find(item => item.index === Number(select.dataset.target)), candidate = item.candidates.find(c => c.key === select.value);
        result.querySelector(`[data-evidence="${item.index}"]`).textContent = !select.value ? '' : select.value === '__new__' ? '保存到待处理职位；没有完整 JD 时不评分、不准备材料。' : candidate ? [...candidate.reasons, ...candidate.conflicts].join('；') : '手动选择的申请，没有匹配依据，请逐项核对。';
        result.querySelector(`[data-choice="${item.index}"]`).checked = false; refreshFilter();
      };
      select.addEventListener('change', explain); explain();
    });
    refreshFilter();
    result.querySelectorAll('[data-discovery-choice]').forEach(button => {
      button.onclick = () => {
        if (host.dataset.busy) return;
        const index = Number(button.dataset.discoveryChoice), candidate = preview.rows[index].discovery.candidates[Number(button.dataset.candidate)];
        rows[index].externalUrl = candidate.url; preview = null; edits();
        const input = result.querySelector('[data-row="' + index + '"][data-field="externalUrl"]');
        input.closest('details').open = true; input.focus();
      };
    });
    result.querySelector('#school-edit').onclick = () => { if (host.dataset.busy) return; preview = null; edits(); };
  }
  host.addEventListener('submit', async event => {
    event.preventDefault(); event.stopPropagation();
    const form = event.target, button = event.submitter;
    if (host.dataset.busy) return;
    const controls = [...host.querySelectorAll('input, select, textarea, button')].map(control => [control, control.disabled]);
    controls.forEach(([control]) => { control.disabled = true; });
    host.dataset.busy = '1'; host.querySelector('textarea').readOnly = true; if (button) button.disabled = true; error.hidden = true;
    try {
      if (form.id === 'school-paste-form') {
        preview = null;
        const parsed = await api('/api/portal/parse', { text: form.elements.text.value });
        rows = parsed.rows; edits();
        const warnings = document.createElement('div'); warnings.className = 'hint';
        warnings.textContent = [...parsed.warnings, ...parsed.errors].join('\n');
        if (warnings.textContent) result.prepend(warnings);
      } else if (form.id === 'school-match-form') {
        form.querySelectorAll('[data-field]').forEach(input => {
          const row = rows[Number(input.dataset.row)]; row[input.dataset.field] = input.value;
          if (input.dataset.field === 'deadline') row.deadlineText = input.value;
        });
        preview = await api('/api/portal/preview', { rows }); matches();
      } else if (form.id === 'school-save-form') {
        const selections = [...form.querySelectorAll('[data-choice]:checked')].map(input => ({ index: Number(input.dataset.choice), key: form.querySelector(`[data-target="${input.dataset.choice}"]`).value }));
        if (!selections.length || selections.some(s => !s.key)) throw new Error('请为勾选的学校岗位选择已有申请或新增候选');
        const saved = await api('/api/portal/link', { token: preview.token, selections, confirmed: true });
        preview = null;
        if (!saved.errors.length) delete document.querySelector("#modal").dataset.dirty;
        result.innerHTML = `<div class="hint">已保存 ${saved.saved.length} 条记录。${esc(saved.message)}${saved.errors.map(e => `\n${esc(e.error)}`).join('')}</div><button id="school-again" class="button secondary">保留本批列表，重新匹配</button>`;
        result.querySelector('#school-again').onclick = edits;
        await onSaved();
      }
    } catch (e) { error.textContent = e.message; error.hidden = false; }
    finally { controls.forEach(([control, disabled]) => { control.disabled = disabled; }); delete host.dataset.busy; host.querySelector('textarea').readOnly = false; if (button) button.disabled = false; }
  });
  // Changes to the pasted input invalidate the previous matching preview.
  host.querySelector('textarea').addEventListener('input', () => { preview = null; result.replaceChildren(); });
}

export function discoveryView(item, esc) {
  const discovery = item.discovery;
  if (!discovery) return '';
  return '<details class="school-discovery"><summary>官网发现对照' + (discovery.total ? ' · ' + discovery.total + ' 条候选' : '') + '</summary><p>' + esc(discovery.message) + '</p>' +
    (discovery.searchedAt ? '<p>搜索记录：' + esc(discovery.searchedAt) + '</p>' : '') +
    discovery.candidates.map((c, i) => '<div class="school-discovery-candidate"><strong>' + esc(c.title) + '</strong><p>' + esc([c.requisitionId, c.term, c.location].filter(Boolean).join(' · ')) + '</p><p>' + esc(c.state) + (c.detail ? '：' + esc(c.detail) : '') + '</p><p>' + esc([...c.reasons, ...c.conflicts].join('；')) + '</p><a href="' + esc(c.url) + '" target="_blank" rel="noopener noreferrer">核对官网 ↗</a> <button type="button" class="button secondary" data-discovery-choice="' + item.index + '" data-candidate="' + i + '">采用链接并重新匹配</button></div>').join('') +
    (discovery.total > discovery.candidates.length ? '<p>仅展示前 5 条，请细化标题或招聘编号后重新匹配。</p>' : '') + '</details>';
}


// Discovery coverage and existing application linkage are independent.
export function portalFilterGroup(item) {
  if (!item.row || item.category === 'invalid') return { key: 'review', reason: '待核对：字段需修正' };
  if (item.category === 'possible' || item.relatedSchoolIds?.length || item.candidates?.some(c => c.conflicts?.length)) return { key: 'review', reason: '待核对：申请候选或学校编号存在歧义' };
  const discovery = item.discovery;
  if (discovery?.status === 'not-found') return { key: 'not-found', reason: '未发现：最近完整雇主列表搜索没有对应候选，不代表岗位关闭' };
  if (discovery?.status === 'candidates' && discovery.total === 1 && discovery.candidates[0]?.strong && discovery.candidates[0].stateCode === 'found') return { key: 'found', reason: '已发现官网候选；申请关联情况以上方标签为准' };
  return { key: 'review', reason: '待核对：' + ({ 'not-searched': '尚未完成搜索', 'source-incomplete': '雇主来源读取不完整', 'source-uncovered': '尚未接入雇主列表，索引覆盖有限', candidates: '候选编号、批次、地点或读取状态需核实' }[discovery?.status] || '搜索证据不足，请重新匹配') };
}

export function applyPortalFilter(root, items, filter) {
  let visible = 0, selected = 0, hiddenSelected = 0;
  for (const item of items) {
    const row = root.querySelector('[data-school-index="' + item.index + '"]');
    row.hidden = filter !== 'all' && portalFilterGroup(item).key !== filter;
    if (!row.hidden) visible++;
    if (row.querySelector('[data-choice]')?.checked) { selected++; if (row.hidden) hiddenSelected++; }
  }
  root.querySelector('#school-filter-count').textContent = '显示 ' + visible + ' / ' + items.length + ' 条';
  root.querySelector('#school-filter-empty').hidden = visible !== 0;
  root.querySelector('#school-selection-count').textContent = '已勾选 ' + selected + ' 条 · 其中 ' + hiddenSelected + ' 条被当前筛选隐藏';
  root.querySelectorAll('[data-school-filter]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.schoolFilter === filter)));
  root.querySelector('#school-clear-filter').disabled = filter === 'all';
  return { visible, selected, hiddenSelected };
}
