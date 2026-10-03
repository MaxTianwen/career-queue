import { freshnessReview } from './assessment-view.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const inApplications = job => ['待提交', '已投递', '面试中', '已结束'].includes(job.status) || job.portalSummary?.schoolOnlyCompleted === true;
export const inQueue = job => job.status === 'Queue' && !job.portalSummary?.schoolOnlyCompleted;
export const channelLabel = portal => ({ both: '官网＋学校双投', 'school-only': '仅学校', unknown: '待确认' }[portal?.channel] || '待确认');

export function schoolMaterialsForm(job) {
  const portal = job.portal;
  if (!portal || portal.status === 'submitted' || job.status === '已归档') return '';
  const generated = job.generatedMaterial?.version ? job.generatedMaterial : null;
  const saved = portal.preparedMaterials;
  const header = `<h3>学校申请材料</h3>${saved ? `<p class="hint">学校 PDF 已保存 · ${esc(saved.version.version)}<br>审阅时间：${esc(saved.version.reviewedAt)}${generated && saved.version.version !== generated.version ? '<br>本机已有新版本；核对后可替换学校待提交材料。' : ''}</p>` : ''}`;
  if (!['both', 'school-only'].includes(portal.channel)) return header + '<p>请先在“学校与官网提交记录”确认申请渠道。缺少官网链接不代表仅学校提交。</p>';
  if (job.fullJd === false || !generated) return header + `<p>${esc(job.generatedMaterial?.error || '完整 JD 的定制简历生成后，最新 PDF 会自动关联到这里。')}</p>`;
  if (job.portalSummary?.schoolExpired) return header + '<p>学校截止已过，不能准备新材料；仍可记录真实已完成的学校提交。</p>';
  return header + `<form id="school-materials-form"><p>已关联最新 PDF · ${esc(generated.version)}</p><button type="button" class="button secondary" data-action="preview-file" data-url="${esc(generated.url)}" data-name="resume.pdf" data-version="${esc(generated.version)}">预览学校 PDF</button>${freshnessReview(generated.freshness, { id: 'school-material-stale' })}<label class="check"><input name="checked" type="checkbox" required>我已预览并核对这份学校简历的事实与排版。</label><p>确认后将 PDF 保存到 Notion。成绩单、Cover Letter 等学校要求的附件仍由你在学校上传；保存材料不代表已投递。</p><button class="button primary">保存学校 PDF</button></form>`;
}
