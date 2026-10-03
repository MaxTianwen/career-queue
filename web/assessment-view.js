const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const time = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN', { timeZone: 'America/Toronto' }) : '尚未核查';
const labels = { met: '有依据', partial: '部分体现', 'not-demonstrated': '简历未体现', unknown: '待确认', conflict: '本人确认不满足' };

export function eligibilityBadge(job) {
  const summary = job.eligibility?.summary;
  if (!summary) return '';
  return `<span class="eligibility-badge ${summary.hardConflict ? 'conflict' : summary.status === 'evidence-covered' ? 'covered' : ''}">${summary.hardConflict ? '必需资格冲突' : summary.status === 'evidence-covered' ? '已识别条件有依据' : '资格待核实'}</span>`;
}

function requirementsPanel(eligibility) {
  const requirements = eligibility.requirements || [];
  return `<p class="assessment-note">${esc(eligibility.note)}</p>${requirements.length ? requirements.map(r => `<article class="requirement-row">
    <div class="requirement-heading"><span class="requirement-kind">${esc({ required: '必需', preferred: '加分', unspecified: '要求类别待核实' }[r.kind] || r.kind)}${r.mode === 'any' ? ' · 任选其一' : ''}</span><span class="requirement-status ${r.status === 'conflict' ? 'conflict' : r.status === 'met' ? 'covered' : ''}">${esc(r.confirmation?.outcome === 'met' ? '本人确认满足' : labels[r.status] || r.status)}</span></div>
    <blockquote>${esc(r.quote)}</blockquote><p>${esc(r.reason)}</p>
    ${r.evidence?.length ? `<ul class="requirement-evidence">${r.evidence.map(e => `<li><b>${esc(e.name)}</b> · ${esc(e.quote)}</li>`).join('')}</ul>` : '<p class="assessment-note">当前简历没有可直接支持这项要求的原句。</p>'}
    ${r.confirmation ? `<p class="assessment-note">本人核实：${esc(r.confirmation.note)} · ${esc(time(r.confirmation.confirmedAt))}</p>` : ''}
    <details class="requirement-confirm"><summary>补充或修正本人核实结果</summary><form class="eligibility-form" data-requirement-id="${esc(r.id)}"><label>对这项完整要求的判断<select name="outcome"><option value="unknown">仍待确认</option><option value="met">本人确认满足</option><option value="conflict">本人确认不满足</option></select></label><label>核实依据<textarea name="note" rows="2" maxlength="1000" required placeholder="填写与此要求有关的真实情况；只影响资格判断，不改变 Match Score。"></textarea></label><label class="check"><input name="confirmed" type="checkbox" required>这是我核实过的实际情况。</label><button class="button secondary compact">保存此项核实</button></form></details>
  </article>`).join('') : '<p>尚未识别出可对照的要求，请以完整 JD 为准。</p>'}`;
}

export function assessmentPanel(job) {
  if (!job.assessment) return '';
  const availability = job.availabilityView || { status: 'unknown' };
  const school = job.jdSource === 'school' && !job.url;
  const stateLabel = availability.status === 'closed' ? '已关闭 / 截止' : availability.status === 'open' ? '官方岗位仍开放' : availability.manual ? '本人已核实开放' : '开放状态待核实';
  const comparisons = job.eligibilityComparisons?.length ? job.eligibilityComparisons : job.eligibility ? [job.eligibility] : [];
  return `<section class="assessment-panel" aria-label="资格与岗位核查"><div class="assessment-heading"><h3>申请资格与岗位状态</h3>${eligibilityBadge(job)}</div>
    <div class="availability-row"><span class="requirement-status ${availability.status === 'closed' ? 'conflict' : availability.status === 'open' || availability.manual ? 'covered' : ''}">${esc(stateLabel)}</span>${school ? '' : '<button class="button secondary compact" data-action="recheck-availability">复查官方岗位</button>'}</div>
    <p class="assessment-note">${esc(availability.evidence || '生成前会核查官方岗位。')}<br>最近核查：${esc(time(availability.checkedAt))}${availability.checkedAt ? '（多伦多时间）' : ''}${availability.checkedAt && !availability.recent && availability.status !== 'closed' ? ' · 已需重新核查' : ''}</p>
    ${availability.status === 'closed' ? '<p class="assessment-note">停止生成新材料；已有材料与申请历史继续保留。</p>' : availability.manual ? `<p class="assessment-note">本人核实依据：${esc(job.availability?.manual?.note || '')}</p>` : !school && availability.status === 'unknown' && availability.recent ? '<details class="availability-confirm" open><summary>官网仍可申请？本人核实后继续</summary><form id="availability-confirm-form"><label>核实依据<textarea name="note" rows="2" maxlength="1000" required placeholder="例如已打开此岗位官网，确认仍有有效申请入口。"></textarea></label><label class="check"><input name="confirmed" type="checkbox" required>我已在官网确认此岗位仍可申请。</label><button class="button secondary compact">记录核实结果</button></form></details>' : ''}
    <details class="eligibility-details"><summary>查看资格要求与简历依据 · ${comparisons.length > 1 ? 'CS / Data 分别对照' : `${job.eligibility?.requirements?.length || 0} 项`}</summary><p class="assessment-note">Match Score 是简历覆盖分；高分不代表全部申请资格已符合。</p>${comparisons.map(e => comparisons.length > 1 ? `<details class="eligibility-track"><summary>${esc((e.track || e.source?.track || '').toUpperCase())} 简历 · ${esc(e.summary?.label)}</summary>${requirementsPanel(e)}</details>` : requirementsPanel(e)).join('')}</details>
    <details class="assessment-version"><summary>当前评估使用的版本</summary><p>简历：${(job.assessment.resumes || []).map(r => `${esc(r.track?.toUpperCase())} · ${esc(r.name || '不可读取')} · ${esc(r.version || '未配置')}`).join('<br>')}<br>JD 版本：${esc(job.assessment.jdHash?.slice(0, 12))}<br>规则：${esc(job.assessment.ruleVersion)}<br>评估时间：${esc(time(job.assessment.assessedAt))}（多伦多时间）</p></details>
  </section>`;
}

export function freshnessReview(freshness, { id = '', required = true } = {}) {
  if (!freshness?.needsReview) return '';
  return `<div ${id ? `id="${esc(id)}"` : ''} class="material-freshness"><p>${esc((freshness.reasons || ['材料输入版本需核实']).join('；'))}。可以重新生成，或对照当前简历与 JD 重新审阅这份 PDF。</p><label class="check"><input name="staleReviewed" type="checkbox" ${required ? 'required' : ''}>我已对照当前输入重新审阅，确认继续使用这份材料。</label></div>`;
}
