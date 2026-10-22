export function capturePanel({ form, api, action, refresh }) {
  const el = (tag, text) => {
      const n = document.createElement(tag);
      n.textContent = text;
      return n;
    },
    box = el('details', ''),
    title = el('summary', '导入学校岗位详情'),
    file = el('input', ''),
    preview = el('button', '预览文件'),
    save = el('button', '确认导入岗位详情'),
    status = el('p', ''),
    body = el('div', '');
  file.type = 'file';
  file.accept = '.json,application/json';
  preview.type = save.type = 'button';
  save.disabled = true;
  status.setAttribute('role', 'status');
  let packet = null,
    plan = null;
  box.append(
    title,
    el(
      'p',
      '选择助手下载的岗位 JSON。当前页文件会按 School ID、标题、公司和学期再次核对，预览后确认；不更新申请提交状态。'
    ),
    file,
    preview,
    body,
    save,
    status
  );
  form.before(box);
  file.addEventListener('change', () => {
    packet = plan = null;
    save.disabled = true;
    body.replaceChildren();
  });
  preview.addEventListener('click', () =>
    action(status, async () => {
      save.disabled = true;
      packet = plan = null;
      const f = file.files[0];
      if (!f || f.size > 800000) throw Error('请选择不超过800KB的岗位JSON');
      let parsed;
      try {
        parsed = JSON.parse(await f.text());
      } catch {
        throw Error('文件不是有效的岗位JSON');
      }
      const value = await api('/api/school/capture-preview', { method: 'POST', value: { packet: parsed } });
      packet = parsed;
      plan = value;
      body.replaceChildren();
      for (const row of plan.rows) {
        const d = el('details', '');
        d.append(
          el('summary', row.schoolId + ' · ' + row.after.title + (row.unchanged ? '（已导入）' : '')),
          el('p', '新来源：' + row.after.sourceEvidence.url),
          el(
            'pre',
            '原JD：\n' +
              (row.before.jd || '') +
              '\n\n新JD：\n' +
              row.after.jd +
              '\n\n时长：' +
              (row.after.duration || '未明确') +
              '\n申请要求：' +
              (row.after.applicationInstructions || '未明确')
          )
        );
        body.append(d);
      }
      status.textContent = '已核对 ' + plan.rows.length + ' 条，待更新 ' + plan.count + ' 条。请展开核对后确认。';
      save.disabled = false;
    })
  );
  save.addEventListener('click', () =>
    action(status, async () => {
      if (!packet || !plan) throw Error('请先预览');
      save.disabled = true;
      const result = await api('/api/school/capture-import', {
        method: 'POST',
        value: { packet, fingerprint: plan.fingerprint, confirmed: true }
      });
      packet = plan = null;
      status.textContent = '已导入 ' + result.updated + ' 条，跳过已导入 ' + result.unchanged + ' 条；未改变提交状态。';
      try {
        await refresh();
      } catch {
        status.textContent += ' 列表刷新失败，请手动刷新。';
      }
    })
  );
  return {
    clear() {
      packet = plan = null;
      file.value = '';
      save.disabled = true;
      body.replaceChildren();
      status.textContent = '';
    }
  };
}
