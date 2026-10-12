// Suggest a base resume from role duties, never from the candidate's degree alone.
const roles = {
  cs: /\b(?:software (?:engineer(?:ing|s)?|developers?|development)|platform engineer(?:ing)?|full[ -]?stack|front[ -]?end|back[ -]?end|web develop\w*|mobile develop\w*|devops|site reliability|quality assurance|qa engineer|test engineer|cybersecurity)\b/ig,
  data: /\b(?:data (?:analysts?|analysis|analytics|science|scientists?|engineer\w*|quality)|business (?:analyst|analysis|analytics|intelligence)|analytics|reporting analyst|market(?:ing)? analyst|bi (?:analyst|developer))\b/ig
};
// Explicit duties can reveal a mixed role; collaborating with another team or
// listing Python/SQL/a degree alone cannot establish a direction.
const duties = {
  cs: /\b(?:build|develop|implement|maintain|design|test)(?:ing|s)?\s+(?:[\w-]+\s+){0,4}(?:web applications?|REST(?:ful)? APIs?|software (?:applications?|systems?)|backend services?|front[ -]?end (?:interfaces?|applications?))\b/ig,
  data: /\b(?:analy[sz](?:e|ing)|clean(?:ing)?|visualiz(?:e|ing))\s+(?:[\w-]+\s+){0,3}data\b|\b(?:build|develop|maintain|design)(?:ing|s)?\s+(?:[\w-]+\s+){0,4}(?:dashboards?|ETL pipelines?|data pipelines?|analytical reports?)\b/ig
};

export function classifyResume(job) {
  const title = String(job.title || '');
  const jd = job.fullJd === false ? '' : String(job.jd || '');
  const hits = source => Object.fromEntries(Object.entries(roles).map(([track, re]) => [track, [...new Set(source.match(re)?.map(x => x.toLowerCase()) || [])]]));
  const titleHits = hits(title);
  // Short recruiting titles are explicit role evidence, but only in the title.
  // Do not infer a role from a degree, a skill list, or another team's internship.
  for (const [track, pattern] of Object.entries({
    cs: /\b(?:software[ -]+(?:intern(?:ship)?|co[ -]?op)|(?:SWE|SDE)[ -]+(?:intern(?:ship)?|co[ -]?op)|(?:intern(?:ship)?|co[ -]?op)\s*[-–:,]\s*(?:software|SWE|SDE))\b/ig,
    data: /\bdata[ -]+(?:intern(?:ship)?|co[ -]?op)\b/ig
  })) titleHits[track].push(...new Set(title.match(pattern)?.map(value => value.toLowerCase()) || []));

  const dutyHits = hits(jd.split(/\n|(?<=[.!?])\s+/).filter(line => !/\b(?:(?:collaborat\w*|work(?:ing)?)\s+(?:closely\s+)?with|degree|diploma|bachelor|master|studying|enrolled|background in)\b/i.test(line)).join('\n'));
  const actions = Object.fromEntries(Object.entries(duties).map(([track, re]) => [track, [...new Set(jd.match(re) || [])]]));
  const hasActions = actions.cs.length || actions.data.length;
  const hasTitle = titleHits.cs.length || titleHits.data.length;
  const source = hasActions ? Object.fromEntries(['cs', 'data'].map(track => [track, [...titleHits[track], ...actions[track]]])) : hasTitle ? titleHits : dutyHits;
  const track = source.cs.length && source.data.length ? 'mixed' : source.cs.length ? 'cs' : source.data.length ? 'data' : 'unknown';
  return { track, label: { cs: 'CS', data: 'Data', mixed: 'CS / Data 交叉', unknown: '方向待确认' }[track],
    basis: hasActions ? '职位名称与 JD 职责' : hasTitle ? '职位名称' : 'JD 关键词', evidence: source,
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
