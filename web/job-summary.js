import { durationText, locationRegion, workModeText, workModes } from './job-facts.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function jobHighlights(job) {
  const region = locationRegion(job);
  const location = job.location?.trim() && job.location !== 'Unknown' ? job.location : '地点待核实';
  const work = workModeText(job);
  const remote = workModes(job).includes('remote');
  const facts = [
    ['工作时长', durationText(job), false],
    ['工作地点', location, ['toronto', 'gta'].includes(region)],
    ['薪资', job.salary || '未披露', false],
    ['工作方式', work, remote]
  ];
  return `<dl class="job-facts" aria-label="岗位关键信息">${facts.map(([label, value, preferred]) => `<div class="job-fact${preferred ? ' preferred' : ''}"><dt>${label}</dt><dd>${esc(value)}</dd>${label === '工作地点' && preferred ? `<small>${region === 'toronto' ? 'Toronto 市内' : 'GTA 地区'}</small>` : ''}</div>`).join('')}</dl>${job.fullJd === false ? '<p class="fact-caveat">来源摘要 · 全文未取得，任期和资格待核实</p>' : ''}${remote ? '<p class="fact-caveat">Remote 不代表允许从加拿大办公，请核实工作资格。</p>' : ''}`;
}

export function skillHighlights(job) {
  const matched = (job.match?.matched || []).filter(item => item.kind === 'skill');
  const gaps = (job.match?.gaps || []).filter(item => item.kind === 'skill');
  const reason = job.match?.score == null ? job.match?.reason || '暂未取得技能匹配依据' : '未识别到简历中对应的技能';
  return `<section class="skill-summary" aria-label="技能匹配摘要"><strong>匹配技能</strong><div class="skill-chips">${matched.length ? matched.slice(0, 6).map(item => `<span class="skill-chip" title="${esc(item.evidence || '详情中查看依据')}">${esc(item.name)}${item.level < 1 ? ' · 基础' : ''}</span>`).join('') + (matched.length > 6 ? `<span class="skill-more">另 ${matched.length - 6} 项见详情</span>` : '') : `<span class="skill-empty">${esc(reason)}</span>`}</div>${gaps.length ? `<p class="skill-gaps">当前简历未提及：${gaps.slice(0, 3).map(item => esc(item.name)).join('、')}${gaps.length > 3 ? ` 等 ${gaps.length} 项` : ''}</p>` : ''}</section>`;
}
