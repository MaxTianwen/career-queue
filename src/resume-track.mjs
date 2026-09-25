// Suggest a base resume from role duties, never from the candidate's degree alone.
const roles = {
  cs: /\b(?:software (?:engineer(?:ing|s)?|developers?|development)|platform engineer(?:ing)?|full[ -]?stack|front[ -]?end|back[ -]?end|web develop\w*|mobile develop\w*|devops|site reliability|quality assurance|qa engineer|test engineer|cybersecurity)\b/ig,
  data: /\b(?:data (?:analysts?|analysis|analytics|science|scientists?|engineer\w*|quality)|business (?:analyst|analysis|analytics|intelligence)|analytics|reporting analyst|market(?:ing)? analyst|bi (?:analyst|developer))\b/ig
};

export function classifyResume(job) {
  const title = String(job.title || '');
  const jd = job.fullJd === false ? '' : String(job.jd || '');
  const hits = source => Object.fromEntries(Object.entries(roles).map(([track, re]) => [track, [...new Set(source.match(re)?.map(x => x.toLowerCase()) || [])]]));
  const titleHits = hits(title), dutyHits = hits(jd);
  const source = titleHits.cs.length || titleHits.data.length ? titleHits : dutyHits;
  const track = source.cs.length && source.data.length ? 'mixed' : source.cs.length ? 'cs' : source.data.length ? 'data' : 'unknown';
  return { track, label: { cs: 'CS', data: 'Data', mixed: 'CS / Data 交叉', unknown: '方向待确认' }[track],
    basis: source === titleHits ? '职位名称' : 'JD 关键词', evidence: source,
    requiresChoice: ['mixed', 'unknown'].includes(track) };
}

export function selectResumeTrack(job, requested = 'auto') {
  if (!['auto', 'cs', 'data'].includes(requested)) throw new Error('简历方向必须为 auto、cs 或 data');
  const classification = classifyResume(job);
  const track = requested === 'auto' ? classification.track : requested;
  if (!['cs', 'data'].includes(track)) throw new Error('此岗位方向不明确，请选择 CS 或 Data 原始简历');
  return { track, selection: requested === 'auto' ? 'automatic' : 'manual', classification };
}

export const resumeConstraints = Object.freeze({
  preserveOriginalTemplate: true, preserveLayout: true, preserveFonts: true, preserveFontSizes: true,
  maxPages: 1, shrinkToFit: false, requireRenderedPageCheck: true, requireSelectablePdfText: true
});
