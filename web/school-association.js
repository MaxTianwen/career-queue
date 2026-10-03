const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function schoolAssociationView(preview) {
  const card = (job, label) => `<section><h4>${label}</h4><strong>${esc(job.company)} · ${esc(job.title)}</strong><p>${esc(job.term)} · ${esc(job.location)} · ${esc(job.status)}</p><p>学校 ID：${esc(job.schoolId || '未关联')} · ${job.hasMaterials ? '已有材料，将保留' : '暂无材料'}</p>${job.notes ? `<p>已保存备注：${esc(job.notes)}</p>` : ''}</section>`;
  return `<div class="school-association"><h3 tabindex="-1">发现已有职位，请核对关联</h3>${card(preview.source, '原学校候选')}${card(preview.target, '已有职位')}
    <p>只迁移学校关联。已有职位的材料、投递状态和备注保持原样；原候选保留备注与历史并退出待处理列表。</p>
    ${preview.conflicts.length ? `<p role="alert">暂不能迁移：${esc(preview.conflicts.join('；'))}</p>` : `<label class="check"><input type="checkbox" name="transferConfirmed">我已核对这是同一岗位，确认迁移学校关联</label><button class="button primary" name="transfer" value="yes">${preview.resumed ? '继续完成迁移' : '确认迁移学校关联'}</button>`}</div>`;
}
