// Derived from the saved JD, never written back to identity or eligibility fields.
const months = 'January February March April May June July August September October November December'.split(' ');
const monthPattern = months.join('|');
const season = month => month < 3 ? 'Winter' : month === 3 ? 'Spring' : month < 8 ? 'Summer' : 'Fall';
const unique = values => [...new Set(values)];
function startTerms(text) {
  const pattern = new RegExp(`(${monthPattern})(?:\\s*(?:/|or)\\s*(${monthPattern}))?\\s+(20\\d{2})`, 'gi');
  const matches = [...text.matchAll(pattern)];
  if (!matches.length || text.replace(pattern, '').replace(/\b(?:and|or)\b|[,\s]/gi, '')) return null;
  return unique(matches.flatMap(m => [m[1], m[2]].filter(Boolean).map(name => `${season(months.findIndex(v => v.toLowerCase() === name.toLowerCase()))} ${m[3]}`)));
}
function durations(text) {
  const parts = text.split(/\s*(?:[-–]|to|or|\/)\s*/i).map(Number);
  if (parts.some(n => !Number.isInteger(n) || n < 1 || n > 24) || parts.length > 2) return null;
  if (/or|\//i.test(text)) return parts.map(n => ({ min: n, max: n }));
  return parts.at(-1) >= parts[0] ? [{ min: parts[0], max: parts.at(-1) }] : null;
}
export function placementOptions(job) {
  const jd = job.jd || '';
  const length = '(\\d{1,2}(?:\\s*(?:[-–]|to|or|/)\\s*\\d{1,2})?)';
  const patterns = [
    new RegExp(`${length}[ -]+months? internships?\\s*\\(starts?\\s+([^)]*)\\)`, 'gi'),
    new RegExp(`For\\s+${length}[ -]+months? internships?:\\s*must be available\\s+([^\\n;.!?]+)`, 'gi')
  ];
  const options = [];
  let incomplete = false;
  for (const [index, pattern] of patterns.entries()) for (const match of jd.matchAll(pattern)) {
    const prefix = jd.slice(jd.lastIndexOf('\n', match.index - 1) + 1, match.index);
    if (/\b(?:not|no|previous|past|cancelled)\b/i.test(prefix)) { incomplete = true; continue; }
    // In an availability interval, only the left side is a start date.
    const starts = index === 1 ? match[2].split(/\s+[-–]\s+|\s+to\s+/i)[0] : match[2];
    const terms = startTerms(starts), ranges = durations(match[1]);
    if (!terms || !ranges) { incomplete = true; continue; }
    options.push({ terms, ranges, raw: match[0].trim() });
  }
  if (!options.length && !incomplete) return null;
  const termOrder = ['Winter', 'Spring', 'Summer', 'Fall'];
  const terms = unique(options.flatMap(o => o.terms)).sort((a, b) => Number(a.split(' ')[1]) - Number(b.split(' ')[1]) || termOrder.indexOf(a.split(' ')[0]) - termOrder.indexOf(b.split(' ')[0]));
  const knownTerms = job.term === 'Summer/Fall 2027' ? ['Summer 2027', 'Fall 2027'] : job.term && job.term !== 'Unknown' ? [job.term] : [];
  const otherStarts = [...jd.matchAll(/\b(?:start date|internship starts?)\s*:\s*([^\n.!?;]+)/gi)];
  const termConflict = knownTerms.some(t => !terms.includes(t)) || otherStarts.some(m => startTerms(m[1])?.some(t => !terms.includes(t)));
  const range = job.durationRange || (Number.isFinite(job.durationMonths) ? { min: job.durationMonths, max: job.durationMonths } : null);
  const durationConflict = range && !options.some(o => o.ranges.some(r => r.min <= range.min && r.max >= range.max));
  const status = incomplete ? 'incomplete' : termConflict || durationConflict ? 'conflict' : 'confirmed';
  return { status, options, terms, reason: status === 'incomplete' ? '入职选项的日期或时长不完整，待核实' : status === 'conflict' ? 'JD 入职选项与已保存字段或其他开始日期不一致，待核实' : '' };
}
export const rangeText = r => r.min === r.max ? `${r.min}` : `${r.min}–${r.max}`;
export function placementTermText(job) {
  const placement = placementOptions(job);
  if (placement?.status === 'confirmed') return placement.terms.join(' / ');
  if (job.term && job.term !== 'Unknown') return job.term + (placement ? '（待核实）' : '');
  if (placement) return '入职时间待核实';
  return job.indexEvidence?.terms?.length ? `${job.indexEvidence.terms.join(' / ')}（索引，待核实）` : '入职时间待核实';
}
export function optionMatches(option, term, duration) {
  if (term && !option.terms.includes(term)) return false;
  if (!duration) return true;
  if (duration === 'unknown') return false;
  return option.ranges.some(r => duration === '8plus' ? r.max >= 8 : r.min <= Number(duration) && r.max >= Number(duration));
}
