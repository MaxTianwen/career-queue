const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Layout only: keep the original words and offsets so evidence highlights remain exact.
export function descriptionBlocks(text = '') {
  const blocks = [];
  const headings = /\b(?:What You['’][lI]{2} (?:Do|Need|Bring)|What You Will Do|What You Bring|What We Offer|Who You Are|About (?:You|Us|the Role)|About [^:.\n]{1,50}:|Position (?:Overview|Summary)|(?:Key |Primary )?Responsibilities|(?:Minimum |Preferred |Required )?Qualifications|(?:Technical |Job )?Requirements|Education|Benefits|Compensation|Term Length|Term Start|Term End|Hiring Range\s*\/\s*Échelle salariale à l['’]embauche)\s*[:：]?/gi;
  const add = (type, start, end) => {
    const raw = text.slice(start, end), left = raw.length - raw.trimStart().length;
    if (raw.trim()) blocks.push({ type, start: start + left, text: raw.trim() });
  };
  const paragraphs = (start, end) => {
    // Plain JSON-LD may contain no line breaks at all. Split at sentence boundaries,
    // without splitting a sentence in the middle or inventing list items.
    while (end - start > 550) {
      const window = text.slice(start, Math.min(end, start + 750));
      const boundaries = [...window.matchAll(/[.!?](?=\s+[A-Z])/g)].map(m => m.index + 1);
      const cut = boundaries.filter(n => n >= 180 && n <= 550).at(-1) || boundaries.find(n => n > 550);
      if (!cut) break;
      add('p', start, start + cut); start += cut;
    }
    add('p', start, end);
  };
  for (const line of text.matchAll(/[^\r\n]+/g)) {
    const start = line.index, end = start + line[0].length;
    const bullet = line[0].match(/^\s*(?:[-*•▪●]\s+|\d+[.)]\s+)/);
    if (bullet) { add('li', start + bullet[0].length, end); continue; }
    const markdown = line[0].match(/^\s*#{1,6}\s+/);
    if (markdown) { add('h4', start + markdown[0].length, end); continue; }
    let cursor = start;
    for (const heading of line[0].matchAll(headings)) {
      const at = start + heading.index;
      // Ordinary mentions such as "education is important" are not headings.
      if (heading[0][0] === heading[0][0].toLowerCase() && heading.index > 0) continue;
      if (!heading[0].trim().endsWith(':') && heading.index === 0 && heading[0].length < line[0].length && /^[a-z]/.test(line[0].slice(heading[0].length).trimStart())) continue;
      paragraphs(cursor, at); add('h4', at, at + heading[0].length); cursor = at + heading[0].length;
    }
    paragraphs(cursor, end);
  }
  return blocks;
}

export function jobDescription(job) {
  const text = String(job.jd || '');
  const ranges = (job.jdHighlights || []).filter(r => Number.isInteger(r.start) && Number.isInteger(r.end) && r.start >= 0 && r.end <= text.length && r.end > r.start);
  const inline = block => {
    let html = '', cursor = block.start;
    const end = cursor + block.text.length;
    for (const r of ranges.filter(r => r.start >= cursor && r.end <= end).sort((a, b) => a.start - b.start)) {
      if (r.start < cursor) continue;
      const kind = r.level < 1 ? 'basic' : r.kind === 'experience' ? 'experience' : 'skill';
      const label = kind === 'basic' ? '基础接触' : kind === 'experience' ? '相关经历' : '简历提及的技能';
      html += esc(text.slice(cursor, r.start)) + `<mark class="jd-${kind}" tabindex="0" title="${esc(`${label}：${r.name}；${r.evidence || ''}`)}">${esc(text.slice(r.start, r.end))}</mark>`;
      cursor = r.end;
    }
    return html + esc(text.slice(cursor, end));
  };
  let html = '', list = false;
  for (const block of descriptionBlocks(text)) {
    if (list && block.type !== 'li') { html += '</ul>'; list = false; }
    if (!list && block.type === 'li') { html += '<ul>'; list = true; }
    html += `<${block.type}>${inline(block)}</${block.type}>`;
  }
  if (list) html += '</ul>';
  return `<div class="jd-legend"><span><mark class="jd-skill">简历提及的技能</mark></span><span><mark class="jd-basic">基础接触</mark></span><span><mark class="jd-experience">相关经历</mark></span></div><p class="jd-note">按标题、换行和句子整理阅读排版，正文措辞不改写。悬停或聚焦高亮可查看当前评分简历的原文；高亮不代表满足全部岗位要求。${ranges.length ? '' : ' 当前没有可标注的经历证据。'}</p><article class="jd" aria-label="职位描述正文">${html}</article>`;
}
