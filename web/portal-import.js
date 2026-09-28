export function openPortalImport({ api, esc, showModal, onSaved }) {
  let rows = [], preview;
  showModal('粘贴学校职位列表', '批量查找已有申请；核对后保存关联，再到学校本人提交。', `<div id="school-import"><form id="school-paste-form"><label>从学校网页复制列表（包含表头）<textarea name="text" rows="8" maxlength="150000" required placeholder="App Status    Term    ID    Job Title    Organization…"></textarea></label><p>每批最多 100 条。支持网页表格复制文字或 Markdown 表格；缺少链接也可匹配。</p><button class="button primary">识别列表</button></form><div id="school-import-result" aria-live="polite"></div><div id="school-import-error" class="feedback error" role="alert" hidden></div></div>`);
  const host = document.querySelector('#school-import'), result = host.querySelector('#school-import-result'), error = host.querySelector('#school-import-error');
  document.querySelector('#modal').classList.add('school-import-dialog');
  const fields = [['id','学校 ID'],['company','公司'],['title','职位'],['term','入职批次'],['location','地点'],['requisitionId','雇主编号'],['deadline','学校截止时间'],['url','学校链接（可空）'],['externalUrl','雇主链接（可空）']];
  const label = { linked: '已有关联', exact: '编号 / 链接匹配', possible: '需核对候选', unmatched: '没有匹配', invalid: '字段需修正' };
  function edits() {
    result.innerHTML = `<form id="school-match-form"><div class="school-import-heading"><h3>已识别 ${rows.length} 条</h3><button class="button primary">匹配已有申请</button></div><p>可展开修正字段。未匹配的岗位仅留在本次预览，不自动加入 Queue。</p>${rows.map((row, index) => `<details class="school-import-row"><summary><span class="badge">${esc(row.id)}</span> ${esc(row.company)} · ${esc(row.title)}</summary><div class="form-grid">${fields.map(([key, name]) => `<label>${name}<input data-row="${index}" data-field="${key}" value="${esc(key === 'deadline' ? row.deadlineText || row.deadline : row[key])}" ${['id','company','title'].includes(key) ? 'required' : ''} maxlength="${/Url|url/.test(key) ? 2000 : 300}" ${/Url|url/.test(key) ? 'type="url"' : ''}></label>`).join('')}</div>${row.parseWarning ? `<p class="warning">${esc(row.parseWarning)}</p>` : ''}${row.sourceStatus ? `<p>原页面 App Status：${esc(row.sourceStatus)}（仅作核对，不更新提交状态）</p>` : ''}</details>`).join('')}</form>`;
  }
  function matches() {
    result.innerHTML = `<form id="school-save-form"><div class="school-import-heading"><h3>匹配结果 · ${preview.rows.length} 条</h3><button type="button" class="button secondary" id="school-edit">返回修正字段</button></div><p>只有勾选的关联会保存。同一申请一次只能关联一个学校 ID；标题相近仍需核实编号与地点。</p>${preview.rows.map(item => {
      if (!item.row) return `<div class="school-import-row"><strong>第 ${item.index + 1} 条</strong><p>${esc(item.error)}</p></div>`;
      const candidates = new Map(item.candidates.map(c => [c.key, c]));
      const options = [...preview.jobs].sort((a,b) => Number(candidates.has(b.key)) - Number(candidates.has(a.key)));
      return `<article class="school-import-row"><div class="school-import-heading"><strong>${esc(item.row.company)} · ${esc(item.row.title)}</strong><span class="badge">${label[item.category]}</span></div><p>学校 ID ${esc(item.row.id)} · ${esc(item.row.term)} · ${esc(item.row.location)}${item.row.requisitionId ? ` · 雇主编号 ${esc(item.row.requisitionId)}` : ''}</p><p>学校截止：${esc(item.row.deadlineText || item.row.deadline || '待核实')}${!item.row.url ? ' · 尚无学校链接，可按 ID 查找' : ''}</p>${item.relatedSchoolIds?.length ? `<p class="warning">同一雇主编号也出现在学校 ID ${esc(item.relatedSchoolIds.join("、"))}，请核对后只选正确关联。</p>` : ''}<label>对应本应用的申请<select data-target="${item.index}"><option value="">暂不关联</option>${options.map(j => `<option value="${j.key}" ${item.suggestedKey === j.key ? 'selected' : ''}>${candidates.has(j.key) ? '候选 · ' : ''}${esc(j.company)} · ${esc(j.title)} · ${esc(j.term)} · ${j.externalSubmitted ? '官网已投' : '官网未确认投递'}${j.linkedId ? ` · 已关联学校 ${esc(j.linkedId)}` : ''}</option>`).join('')}</select></label><p data-evidence="${item.index}"></p><label class="check"><input type="checkbox" data-choice="${item.index}">我已核对，保存此关联</label></article>`;
    }).join('')}<div class="school-import-heading"><span>保存关联不会标记任何渠道已提交。</span><button class="button primary">保存勾选的关联</button></div></form>`;
    result.querySelectorAll('[data-target]').forEach(select => {
      const explain = () => {
        const item = preview.rows[Number(select.dataset.target)], candidate = item.candidates.find(c => c.key === select.value);
        result.querySelector(`[data-evidence="${item.index}"]`).textContent = !select.value ? '' : candidate ? [...candidate.reasons, ...candidate.conflicts].join('；') : '手动选择的申请，没有匹配依据，请逐项核对。';
        result.querySelector(`[data-choice="${item.index}"]`).checked = false;
      };
      select.addEventListener('change', explain); explain();
    });
    result.querySelector('#school-edit').onclick = () => { preview = null; edits(); };
  }
  host.addEventListener('submit', async event => {
    event.preventDefault(); event.stopPropagation();
    const form = event.target, button = event.submitter;
    if (host.dataset.busy) return;
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
        if (!selections.length || selections.some(s => !s.key)) throw new Error('请为勾选的学校岗位选择对应申请');
        const saved = await api('/api/portal/link', { token: preview.token, selections, confirmed: true });
        preview = null;
        if (!saved.errors.length) delete document.querySelector("#modal").dataset.dirty;
        result.innerHTML = `<div class="hint">已保存 ${saved.saved.length} 条关联。${esc(saved.message)}${saved.errors.map(e => `\n${esc(e.error)}`).join('')}</div><button id="school-again" class="button secondary">保留本批列表，重新匹配</button>`;
        result.querySelector('#school-again').onclick = edits;
        await onSaved();
      }
    } catch (e) { error.textContent = e.message; error.hidden = false; }
    finally { delete host.dataset.busy; host.querySelector('textarea').readOnly = false; if (button) button.disabled = false; }
  });
  // Changes to the pasted input invalidate the previous matching preview.
  host.querySelector('textarea').addEventListener('input', () => { preview = null; result.replaceChildren(); });
}
