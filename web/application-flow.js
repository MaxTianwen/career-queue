// Read-only guidance. These steps never authorize a write or replace server guards.
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function applicationSteps(job, { discovery = false, saved = false } = {}) {
  const step = (code, label, target = '') => ({ code, label, target });
  if (discovery) return [saved ? step('saved', '已在 Queue 保存，查看已保存职位') : job.decision === 'REJECT' || job.identityConflict
    ? step('review', '先核对岗位条件与来源，当前不能保存') : job.fullJd === false ? step('discovery-jd', '先取得完整 JD，再保存到 Queue 准备申请') : step('save', '选定后保存到 Queue，再准备申请')];
  if (job.status === '已归档' || job.transferredTo) return [step('archived', '已归档，保留原备注和申请历史')];
  if (job.status === '已结束') return [step('ended', '申请已结束，保留提交记录与材料')];
  const p = job.portal, summary = job.portalSummary || {};
  const officialDone = summary.externalSubmitted || Boolean(job.applicationDate && ['已投递', '面试中', '已结束'].includes(job.status));
  const schoolDone = p?.status === 'submitted';
  if (schoolDone && (p.channel === 'school-only' || officialDone)) return [step('complete', '所需渠道已记录提交，可继续跟进结果', '.portal-panel')];
  if (p && !schoolDone && p.requirement !== 'not-required' && (!['both', 'school-only'].includes(p.channel) || p.requirement !== 'required')) return [step('channel', '先确认官网 / 学校申请渠道', '#portal-channel-form')];
  if (!officialDone && !schoolDone && job.eligibility?.summary?.hardConflict) return [step('qualification', '已确认必需资格冲突，请先核对资格依据', '.assessment-panel')];
  if (!schoolDone && job.jdSource === 'school' && !job.url && job.fullJd !== false && !summary.schoolExpired && !job.schoolAvailabilityView?.recent) return [step('school-verify', '先核实学校仍接受申请，再继续准备材料', '.school-availability')];
  const next = [];
  if (p?.channel !== 'school-only' && !officialDone) {
    if (job.expired || job.availabilityView?.status === 'closed') next.push(step('official-closed', '官网已关闭 / 截止；可保留历史或补记实际提交', '.portal-panel'));
    else if (job.status === '待提交') next.push(job.materialFreshness?.needsReview ? step('official-review', '官网材料输入已变化，重新审阅后再提交', '#submitted-form') : step('official-submit', '到官网提交，然后回来确认实际日期', '#submitted-form'));
    else next.push(step('official-materials', job.fullJd === false ? '先补齐完整 JD' : job.generatedMaterial?.version ? '预览最新 PDF，审阅并保存官网材料' : '准备简历修改对照，审阅后生成 PDF', job.fullJd === false ? '#school-details-form' : job.generatedMaterial?.version ? '#material-panel' : '.resume-controls'));
  }
  if (p && !schoolDone && p.requirement === 'required') {
    if (summary.schoolExpired) next.push(step('school-expired', '学校截止已过；仅补记已完成的真实提交', '#portal-submit-form'));
    else if (job.fullJd === false) next.push(step('school-jd', '补齐学校 JD 后准备材料', '#school-details-form'));
    else if (p.preparedMaterials) next.push(job.schoolMaterialFreshness?.needsReview ? step('school-review', '学校材料输入已变化，重新审阅后再提交', '#portal-submit-form') : job.generatedMaterial?.version && job.generatedMaterial.version !== p.preparedMaterials.version?.version ? step('school-new-version', '有新版 PDF，核对是否替换学校待提交材料', '#school-materials-form') : step('school-submit', '到学校提交 PDF 和必需附件，再确认日期', '#portal-submit-form'));
    else next.push(step('school-materials', job.generatedMaterial?.version ? '预览并保存学校 PDF，核对必需附件' : '准备简历修改对照，审阅后生成学校 PDF', job.generatedMaterial?.version ? '#school-materials-form' : '.resume-controls'));
  }
  if (officialDone && !p) next.push(step('school-link', '官网已投；若学校也要求提交，请关联学校岗位', '.portal-panel'));
  if (next.length === 2 && next.every(s => s.target === '.resume-controls')) return [step('shared-materials', '准备简历修改对照；生成后分别审阅官网与学校材料', '.resume-controls')];
  return next.length ? next : [step('follow-up', '已记录所需提交，可继续跟进结果', '.portal-panel')];
}
export function applicationFlow(job, options) {
  return `<section class="application-flow" aria-label="申请下一步"><strong>下一步</strong><ul>${applicationSteps(job, options).map(s => `<li><span>${esc(s.label)}</span>${s.target ? `<button type="button" class="text-button" data-action="flow-target" data-target="${esc(s.target)}">前往处理 →</button>` : ''}</li>`).join('')}</ul></section>`;
}
