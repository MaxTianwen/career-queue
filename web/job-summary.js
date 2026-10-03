import { durationText, locationRegion, workModeText, workModes, workModeChoices } from './job-facts.js';
import { salaryText, salaryDetails } from './salary.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function jobHighlights(job) {
  const region = locationRegion(job);
  const location = job.location?.trim() && job.location !== 'Unknown' ? job.location : '地点待核实';
  const work = workModeText(job);
  const remote = workModes(job).includes('remote');
  const facts = [
    ['工作时长', durationText(job), false],
    ['工作地点', location, ['toronto', 'gta'].includes(region)],
    ['薪资', salaryText(job), false],
    ['工作方式', work, remote]
  ];
  return `<dl class="job-facts" aria-label="岗位关键信息">${facts.map(([label, value, preferred]) => `<div class="job-fact${preferred ? ' preferred' : ''}"><dt>${label}</dt><dd>${esc(value)}</dd>${label === '工作地点' && preferred ? `<small>${region === 'toronto' ? 'Toronto 市内' : 'GTA 地区'}</small>` : ''}</div>`).join('')}</dl>${job.fullJd === false ? '<p class="fact-caveat">来源摘要 · 全文未取得，任期和资格待核实</p>' : ''}${salaryDetails(job)}${remote ? '<p class="fact-caveat">Remote 不代表允许从加拿大办公，请核实工作资格。</p>' : ''}`;
}

export function skillHighlights(job) {
  const matched = (job.match?.matched || []).filter(item => item.kind === 'skill');
  const gaps = (job.match?.gaps || []).filter(item => item.kind === 'skill');
  const reason = job.match?.score == null ? job.match?.reason || '暂未取得技能匹配依据' : '未识别到简历中对应的技能';
  return `<section class="skill-summary" aria-label="技能匹配摘要"><strong>匹配技能</strong><div class="skill-chips">${matched.length ? matched.slice(0, 6).map(item => `<span class="skill-chip" title="${esc(item.evidence || '详情中查看依据')}">${esc(item.name)}${item.level < 1 ? ' · 基础' : ''}</span>`).join('') + (matched.length > 6 ? `<span class="skill-more">另 ${matched.length - 6} 项见详情</span>` : '') : `<span class="skill-empty">${esc(reason)}</span>`}</div>${gaps.length ? `<p class="skill-gaps">当前简历未提及：${gaps.slice(0, 3).map(item => esc(item.name)).join('、')}${gaps.length > 3 ? ` 等 ${gaps.length} 项` : ''}</p>` : ''}</section>`;
}

export function scoreBasisText(match) {
  if (match?.score == null) return match?.reason || '暂不评分';
  const components = match.components || [];
  const total = components.reduce((sum, c) => sum + c.total, 0);
  return total ? `基于 ${total} 项可识别要求` : '评分依据待核实';
}

export function matchEvidenceView(match) {
  const rows = [...(match.matched || []), ...(match.gaps || [])];
  return `<details class="match-evidence"><summary>查看逐项 JD 与当前简历对照（${rows.length} 项）</summary><p class="assessment-note">必需 / 加分 / 任选仅解释原文，不改变覆盖分；最多展示每项前三处计分范围内的上下文。关键词提及不证明整项资格满足。</p>${rows.map(row => `<article class="evidence-pair"><h4>${esc(row.name)} <span class="badge">${row.level === 1 ? '简历体现' : row.level > 0 ? '基础接触 · 半项' : '简历未体现'}</span></h4><div class="evidence-columns"><div><strong>JD 原文</strong>${row.jdEvidence?.length ? row.jdEvidence.map(e => `<p class="requirement-kind">${esc({required:'必需',preferred:'加分',unspecified:'类别待核实'}[e.kind] || '类别待核实')}${e.mode === 'any' ? ' · 任选其一' : ''}</p><blockquote>${esc(e.quote)}</blockquote><p class="assessment-note">${esc(e.reason)}</p>`).join('') : '<p>旧评估没有记录原句，请刷新详情重新评估。</p>'}</div><div><strong>当前简历原文</strong><blockquote>${esc(row.evidence || '当前简历未体现，不代表本人不会。')}</blockquote></div></div></article>`).join('')}</details>`;
}

export function scoreComponentsView(match) {
  return `<p>比较范围：${esc(match.comparedSection || '待核实')} · ${esc(scoreBasisText(match))}。仅覆盖规则识别的技能与经历主题，不代表完整 JD 或全部申请资格。</p><div class="match-components">${(match.components || []).map(c => {
    const kind = c.name === '技能覆盖' ? 'skill' : 'experience';
    const rows = [...(match.matched || []), ...(match.gaps || [])].filter(r => r.kind === kind);
    const full = rows.filter(r => r.level === 1).length, basic = rows.filter(r => r.level > 0 && r.level < 1).length;
    const missing = rows.filter(r => r.level === 0).length;
    return `<div><b>${esc(c.name)} · 识别 ${esc(c.total)} 项</b><p>简历体现 ${full} 项 · 基础接触 ${basic} 项 · 未体现 ${missing} 项</p><small>覆盖计算值 ${esc(c.matched)} / ${esc(c.total)} · 权重 ${esc(c.weight)}%${basic ? ' · 基础接触每项按 0.5 计算' : ''}</small></div>`;
  }).join('')}</div>`;
}

// Presentation only: retain source fields and existing filtering decisions.
export function workplaceEvidence(job) {
  const warnings = [], quotes = [];
  const location = job.location || '';
  if (/\bCanada\s*,\s*(?:[A-Z]{2}\s*,\s*)?(?:US|USA|United States)\b/i.test(location)) warnings.push('地点同时包含加拿大与美国标记，请核实实际办公地点');
  const choices = workModeChoices(job);
  if (choices) quotes.push(choices.raw);
  const statements = (job.jd || '').split(/\n|(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
  const locationQuotes = statements.filter(s => /^(?:Job Location|Location|City|Country)\s*:/i.test(s));
  for (const line of statements) {
    const mode = line.match(/^(?:Remote Position|Work(?:place)? (?:Type|Mode|Arrangement|Model)|This (?:role|position) is)\s*:?\s*(?:an?\s+)?(hybrid|remote|on[ -]?site)\b/i)
      || line.match(/^(?:Location:\s*)?This is an? (remote|hybrid|on[ -]?site) (?:position|role)\b/i);
    if (!mode || /\b(?:not|no|cannot|can't|or)\b/i.test(line)) continue;
    quotes.push(line);
    const value = mode[1].toLowerCase().replace(/[ -]/g, '');
    if (!choices && ['remote', 'onsite', 'hybrid'].includes(job.workMode) && value !== job.workMode) warnings.push('当前工作方式与 JD 明确表述不同，请核实');
  }
  if (job.fieldEvidence?.workMode?.status === 'ambiguous') warnings.push('工作方式来源信息不一致，请核实');
  return { warnings: [...new Set(warnings)], quotes: [...new Set(quotes)], locationQuotes };
}

export function workplaceBadge(job) {
  return workplaceEvidence(job).warnings.length ? '<span class="badge workplace-warning">地点 / 方式待核实</span>' : '';
}
