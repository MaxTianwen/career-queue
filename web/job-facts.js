import { placementOptions, rangeText } from './placement-options.js';
// Shared by source adapters, evaluation and the browser. Never substitute index dates.
export function validPublicationDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return false;
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  return month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate() && Number.isFinite(Date.parse(value));
}
export function publication(job) {
  const evidence = job.sourceEvidence || {};
  const at = validPublicationDate(job.postedAt) ? job.postedAt : validPublicationDate(evidence.lastPublishedAt) ? evidence.lastPublishedAt : null;
  const kind = job.postedAtKind || (evidence.postedAtField === 'first_published' ? 'first' : !job.postedAt && at ? 'latest' : 'official');
  return { at, kind, dateOnly: at ? !at.includes('T') : false,
    label: kind === 'latest' ? '最近发布时间' : kind === 'first' ? '首次发布时间' : '官方发布日期' };
}
export function recentPublication(job, now = Date.now()) {
  const p = publication(job);
  if (!p.at || p.dateOnly) return false;
  const age = Number(now) - Date.parse(p.at);
  return age >= 0 && age <= 86400000;
}
export function publicationDay(job) {
  const p = publication(job);
  if (!p.at) return '';
  return p.dateOnly ? p.at : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(p.at));
}

// Ranges are displayed as ranges, never stored as a made-up exact duration.
export function durationRange(job) {
  if (job.durationRange && Number.isFinite(job.durationRange.min) && Number.isFinite(job.durationRange.max) && job.durationRange.min > 0 && job.durationRange.max >= job.durationRange.min) return job.durationRange;
  if (Number.isFinite(job.durationMonths)) return { min: job.durationMonths, max: job.durationMonths };
  if (!job.fullJd && !job.jd) return null;
  const range = (job.title || '').match(/\b(\d{1,2})\s*(?:[-–]|to)\s*(\d{1,2})[\s-]+months?\b/i);
  if (range && Number(range[1]) > 0 && Number(range[2]) >= Number(range[1])) return { min: Number(range[1]), max: Number(range[2]) };
  const minimum = (job.title || '').match(/\b(\d{1,2})\+\s*months?\b/i);
  return minimum && Number(minimum[1]) > 0 ? { min: Number(minimum[1]), max: Infinity } : null;
}
export function durationText(job) {
  const placement = placementOptions(job);
  if (placement?.status === 'confirmed') return `${[...new Set(placement.options.flatMap(o => o.ranges.map(rangeText)))].join(' 或 ')} 个月`;
  const range = durationRange(job);
  if (!range) return '时长待核实';
  return range.max === Infinity ? `${range.min}+ 个月` : range.min === range.max ? `${range.min} 个月` : `${range.min}–${range.max} 个月`;
}

// Only a choice explicitly stated for this position counts as multiple modes.
// Mentioning remote teams or conflicting metadata is not an offer of remote work.
export function workModeChoices(job) {
  const sentence = (job.jd || '').match(/\bthis (?:position|role|is an? [^\n.!?]{0,100}\b(?:position|role))[^\n.!?]{0,100}\bcan be\b[^\n.!?]{0,240}/i)?.[0];
  if (!sentence || /\b(?:not|no|cannot|can't|rather than)\b/i.test(sentence) || !/\bor\b/i.test(sentence)) return null;
  const modes = ['onsite', 'hybrid', 'remote'].filter(mode => new RegExp(mode === 'onsite' ? '\\bon[ -]?site\\b' : `\\b${mode}\\b`, 'i').test(sentence));
  return modes.length > 1 ? { modes, raw: sentence.trim() } : null;
}
export function workModes(job) {
  return workModeChoices(job)?.modes || (['onsite', 'hybrid', 'remote'].includes(job.workMode) ? [job.workMode] : []);
}
export function workModeText(job) {
  const modes = workModes(job);
  const labels = { onsite: 'On-site · 现场', hybrid: 'Hybrid · 混合', remote: 'Remote · 远程' };
  return modes.length > 1 ? `可选：${modes.map(m => labels[m]).join(' / ')}` : labels[modes[0]] || '工作方式待核实';
}

const TORONTO = /\b(toronto|north york|scarborough|etobicoke|east york)\b/i;
const GTA = /\b(toronto|north york|scarborough|etobicoke|east york|markham|vaughan|richmond hill|mississauga|brampton|caledon|oakville|burlington|milton|halton hills|pickering|ajax|whitby|oshawa|clarington|uxbridge|scugog|brock|aurora|newmarket|king city|whitchurch.stouffville|east gwillimbury|georgina|gta|greater toronto area)\b/i;
const OUTSIDE = /\b(vancouver|calgary|montreal|montréal|ottawa|waterloo|kitchener|cambridge|hamilton|london|edmonton|winnipeg|halifax|quebec|québec|victoria|burnaby|surrey|regina|saskatoon|guelph|new york|san francisco|united states|usa)\b/i;
export function locationRegion(job) {
  if (GTA.test(job.location || '')) return TORONTO.test(job.location) ? 'toronto' : 'gta';
  if (job.inGta === true) return 'gta';
  // "Canada" or "Remote" alone does not identify a city outside the GTA.
  if (OUTSIDE.test(job.location || '')) return 'outside';
  if (job.inGta === false && !/^(?:remote[\s,·/-]*)?(?:canada|ontario|on|unknown)?$/i.test((job.location || '').trim())) return 'outside';
  return 'unknown';
}
