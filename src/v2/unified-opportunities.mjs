import { jobCategory } from '../job-category.mjs';
import { opportunityFacts } from '../../web/v2/opportunity.js';
import { createHash } from 'node:crypto';
import { postingUrl } from '../discovery-records.mjs';
import { classifyResume } from '../resume-track.mjs';

const norm = value =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
export function identityUrl(value) {
  try {
    return value ? postingUrl(value) : '';
  } catch {
    return '';
  }
}
const term = value =>
  [...norm(value).matchAll(/winter|summer|fall|20\d{2}/g)]
    .map(m => m[0])
    .sort()
    .join(' ');
const months = job => {
  const facts = opportunityFacts(job);
  return [...facts.durations.map(d => String(d.min)), ...facts.durationIssues.map(norm)].sort().join(',');
};
export function locationIdentity(value) {
  const text = norm(value);
  const cities = [
    'toronto',
    'markham',
    'vancouver',
    'montreal',
    'ottawa',
    'waterloo',
    'calgary',
    'edmonton',
    'halifax',
    'winnipeg',
    'mississauga',
    'burnaby',
    'quebec'
  ];
  const found = cities.filter(city => new RegExp('\\b' + city + '\\b').test(text));
  if (found.length !== 1) return text;
  const province = /\b(?:ontario|on)\b/.test(text)
    ? 'on'
    : /\b(?:british columbia|bc)\b/.test(text)
      ? 'bc'
      : /\b(?:quebec|qc)\b/.test(text)
        ? 'qc'
        : /\b(?:alberta|ab)\b/.test(text)
          ? 'ab'
          : '';
  return province ? found[0] + ' ' + province : text;
}
export function identityConflicts(a, b) {
  const fields = {
    company: [norm(a.company), norm(b.company)],
    location: [locationIdentity(a.location), locationIdentity(b.location)],
    termSeason: [
      term(a.term || a.title)
        .replace(/20\d{2}/g, '')
        .trim(),
      term(b.term || b.title)
        .replace(/20\d{2}/g, '')
        .trim()
    ],
    termYear: [term(a.term || a.title).match(/20\d{2}/)?.[0], term(b.term || b.title).match(/20\d{2}/)?.[0]],
    duration: [months(a), months(b)],
    requisitionId: [norm(a.requisitionId), norm(b.requisitionId)]
  };
  // Exact employer requisitions may advertise several verified starts; a school's one term is a subset.
  const exactReq =
    norm(a.company) === norm(b.company) && norm(a.requisitionId) && norm(a.requisitionId) === norm(b.requisitionId);
  const covers = (specific, official) => {
    const seasons = term(specific.term).match(/winter|summer|fall/g) || [],
      year = term(specific.term).match(/20\d{2}/)?.[0];
    const placements = opportunityFacts(official).durationInfo.placements;
    return (
      seasons.length &&
      year &&
      seasons.every(season => placements.some(p => p.season === season && p.start?.startsWith(year)))
    );
  };
  if (
    exactReq &&
    (covers(a, b) || covers(b, a)) &&
    (!fields.termYear[0] || !fields.termYear[1] || fields.termYear[0] === fields.termYear[1])
  )
    fields.termSeason = ['', ''];
  return Object.entries(fields)
    .filter(([, v]) => v[0] && v[1] && v[0] !== v[1])
    .map(([k]) => (k.startsWith('term') ? 'term' : k));
}
// Same posting without a shared link or requisition: compare employer and title after removing
// school prefixes, requisition numbers and term words. Used only when both sides are unique.
const companyKey = value =>
  norm(value)
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(?:the|inc|incorporated|ltd|limited|llc|corp|corporation|co|company|plc)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
export const titleKey = value =>
  norm(String(value || '').replace(/\(\s*[A-Z]{2,6}\s*\)/g, ' '))
    .replace(/^new\s+/, '')
    .replace(/\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/g, ' ')
    .replace(/[[(]\s*(?:jr|r)?[\d-]{4,}\s*[\])]/g, ' ')
    .replace(/\s[-–]\s*(?:jr|r)?\d[\d-]{3,}\s*$/, ' ')
    .replace(/\b(?:winter|summer|fall|spring|20\d{2})\b/g, ' ')
    .replace(/co-?op/g, 'coop')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
// The employer was already compared by companyKey, so suffixes like "Inc." are not a conflict here.
const titleConflicts = (a, b) => identityConflicts(a, b).filter(field => field !== 'company');
// One employer posting can appear under several URLs (e.g. CIBC lists requisition 2621523 on
// two Workday sites as _2621523 and _2621523-1). Same employer + same base requisition + same
// title is one posting; keep the record with a full JD and remember the other links.
const workdayRequisition = url => String(url || '').match(/\.myworkdayjobs\.com\/.*_([A-Za-z]*\d[\w]*?)(?:-\d+)?$/)?.[1] || '';
const baseRequisition = job => String(job.requisitionId || workdayRequisition(job.url) || '').trim().replace(/-\d+$/, '').toLowerCase();
export function collapseSamePostings(jobs) {
  const groups = new Map(),
    out = [];
  for (const job of jobs) {
    const req = baseRequisition(job),
      key = req && companyKey(job.company) && titleKey(job.title) ? [companyKey(job.company), req, titleKey(job.title)].join('|') : '';
    if (!key) {
      out.push(job);
      continue;
    }
    if (!groups.has(key)) {
      groups.set(key, []);
      out.push(key);
    }
    groups.get(key).push(job);
  }
  const rank = job => [job.jd && job.fullJd !== false ? 0 : 1, job.stale ? 1 : 0, /-\d+$/.test(job.url) ? 1 : 0, job.url.length];
  const better = (a, b) => {
    const x = rank(a),
      y = rank(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i];
    return a.url < b.url;
  };
  return out.map(item => {
    if (typeof item !== 'string') return item;
    const group = groups.get(item);
    if (group.length === 1) return group[0];
    const keep = group.reduce((best, job) => (better(job, best) ? job : best));
    const sources = [...new Map(group.flatMap(job => job.sources || (job.source ? [job.source] : [])).map(s => [s.id, s])).values()];
    const aliasUrls = [...new Set([...(keep.aliasUrls || []), ...group.filter(job => job !== keep).flatMap(job => [job.url, ...(job.aliasUrls || [])])])].filter(url => url !== keep.url);
    return { ...keep, sources, aliasUrls };
  });
}
const postingKey = job => companyKey(job.company) && titleKey(job.title) ? companyKey(job.company) + '|' + titleKey(job.title) : '';
// Personal read projection only: never copy a school's private rows into the global catalogue.
export function unifiedOpportunities(owner, catalogue, schools, saved) {
  const result = catalogue.jobs.map(job => ({
    ...job,
    schoolSources: [],
    hasSchool: false,
    hasPublic: true,
    publicUpdated: job.sourceUpdatedAt || (!job.stale ? catalogue.finishedAt : null) || null,
    draftIds: saved
      .filter(
        s =>
          identityUrl(s.url) &&
          [job.url, ...(job.aliasUrls || [])].some(url => identityUrl(url) === identityUrl(s.url)) &&
          !schools.some(item => item.jobId === s.id && !item.explicitMatch && identityConflicts(item.row, job).length)
      )
      .map(s => s.id)
  }));
  const schoolKeys = new Map(), publicKeys = new Map();
  for (const item of schools) {
    const key = postingKey(item.officialFacts || item.row);
    if (key) schoolKeys.set(key, (schoolKeys.get(key) || 0) + 1);
  }
  for (const job of result) {
    const key = postingKey(job);
    if (key) publicKeys.set(key, (publicKeys.get(key) || 0) + 1);
  }
  for (const item of [...schools].sort((a, b) => a.schoolId.localeCompare(b.schoolId))) {
    const row = item.officialFacts || item.row,
      linked = saved.find(s => s.id === item.jobId);
    const explicit =
      item.explicitMatch && linked?.url
        ? result.filter(j => j.hasPublic && identityUrl(j.url) === identityUrl(linked.url))
        : [];
    const candidates = result.filter(
      j =>
        ((identityUrl(row.externalUrl) && identityUrl(row.externalUrl) === identityUrl(j.url)) ||
          (norm(row.company) &&
            norm(row.company) === norm(j.company) &&
            norm(row.requisitionId) &&
            norm(row.requisitionId) === norm(j.requisitionId))) &&
        !identityConflicts(row, j).length
    );
    // Last resort: one school row and one public posting share employer and title, with no conflicts.
    const key = postingKey(row);
    const sameTitle =
      !explicit.length && !candidates.length && key && schoolKeys.get(key) === 1 && publicKeys.get(key) === 1
        ? result.filter(j => j.hasPublic && !j.schoolSources.length && postingKey(j) === key && !titleConflicts(row, j).length)
        : [];
    const matches = explicit.length === 1 ? explicit : candidates.length ? candidates : sameTitle;
    let job = matches.length === 1 ? matches[0] : null;
    const evidence = {
      schoolId: item.schoolId,
      updated: item.updated,
      jobId: item.jobId,
      requirement: item.requirement,
      row: { ...row },
      match: explicit.length === 1 ? 'explicit' : job && !candidates.length ? 'title' : job ? 'identifier' : 'unmatched',
      conflicts: job ? (candidates.length || explicit.length ? identityConflicts(row, job) : titleConflicts(row, job)) : []
    };
    if (!job) {
      job = {
        ...row,
        id: createHash('sha256')
          .update('school:' + owner + ':' + item.schoolId)
          .digest('hex'),
        url: row.externalUrl || '',
        jd: row.jd || linked?.jd || '',
        deadline: '',
        classification: classifyResume(row),
        source: { id: 'school', name: '学校职位' },
        sources: [{ id: 'school', name: '学校职位' }],
        schoolSources: [],
        hasSchool: true,
        hasPublic: false,
        draftIds: []
      };
      result.push(job);
    }
    job.hasSchool = true;
    job.schoolSources.push(evidence);
    if (item.jobId && !job.draftIds.includes(item.jobId)) job.draftIds.unshift(item.jobId);
  }
  return result.map(job => ({ ...job, jobCategory: jobCategory(job) }));
}
