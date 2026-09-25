import { canonicalUrl, normalizeJob, evaluateJob, comparePreference, TARGET_TERMS } from './core.mjs';
import { fetchGreenhouse } from './greenhouse.mjs';
import { extractDeadline } from './deadlines.mjs';
import { postingMetadata } from './posting-metadata.mjs';
import { locationRegion } from '../web/job-facts.js';

export const SOURCE = {
  name: 'Simplify / Pitt CSC · 2027 Internships',
  url: 'https://github.com/SimplifyJobs/Summer2027-Internships',
  dataUrl: 'https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/.github/scripts/listings.json'
};
const geography = /\b(canada|toronto|north york|scarborough|markham|vaughan|waterloo|vancouver|montreal|montréal|ottawa|calgary|edmonton|remote)\b/i;
const role = /\b(software|developer|programmer|data|analytics|analyst|machine learning|AI|ML|QA|quality assurance|test|SRE|DevOps|cloud|platform|IT|information (systems|technology)|cyber|security|firmware|embedded|full.stack|front.end|back.end)\b/i;
const plain = s => String(s ?? '').replace(/<\/(p|li|h[1-6]|div)>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');

async function readJson(url, fetchImpl) {
  const r = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json', 'User-Agent': 'CareerQueue/1.0' } });
  if (!r.ok) throw new Error(`来源返回 HTTP ${r.status}`);
  const text = await r.text();
  if (text.length > 25_000_000) throw new Error('来源响应超过大小限制');
  return JSON.parse(text);
}

// Only build requests to the three fixed public ATS API hosts; never fetch feed URLs directly.
export async function officialJob(candidate, fetchImpl = fetch, boards = new Map()) {
  const u = new URL(candidate.url);
  if (u.protocol !== 'https:' || u.port || u.username || u.password) return null;
  if (['boards.greenhouse.io', 'job-boards.greenhouse.io'].includes(u.hostname) && /^\/[\w-]+\/jobs\/\d+\/?$/.test(u.pathname)) {
    return fetchGreenhouse(u.href, candidate.company, fetchImpl);
  }
  const match = u.pathname.match(/^\/([^/]+)\/([a-f0-9-]{36})(?:\/(?:application|apply))?\/?$/i);
  if (!match) return null;
  const board = decodeURIComponent(match[1]);
  if (!/^[a-z0-9 ._-]{1,100}$/i.test(board)) return null;
  const id = match[2];
  if (u.hostname === 'jobs.lever.co') {
    const api = `https://api.lever.co/v0/postings/${encodeURIComponent(board)}/${id}?mode=json`;
    const j = await readJson(api, fetchImpl);
    if (j.id !== id || !j.text || !j.descriptionPlain) throw new Error('Lever 未返回完整 JD');
    const jd = [j.descriptionPlain, ...(j.lists ?? []).map(l => `${l.text}\n${plain(l.content)}`), j.additionalPlain, j.salaryDescriptionPlain].filter(Boolean).join('\n\n');
    const salary = j.salaryRange;
    const metadata = await postingMetadata(`https://jobs.lever.co/${encodeURIComponent(board)}/${id}`, j.text, fetchImpl);
    return { ...candidate, title: j.text, jd, url: `https://jobs.lever.co/${encodeURIComponent(board)}/${id}`,
      location: j.categories?.allLocations?.join(' / ') || j.categories?.location || candidate.location,
      workMode: ({ 'on-site': 'onsite', remote: 'remote', hybrid: 'hybrid' })[j.workplaceType] || 'unknown',
      salary: salary ? `${salary.currency} ${salary.min}–${salary.max} / ${salary.interval}` : '未披露',
      paid: salary?.min > 0 ? true : null, postedAt: metadata.postedAt, postedAtKind: 'official', deadline: metadata.deadline,
      sourceEvidence: { url: api, retrievedAt: new Date().toISOString(), postedAtField: metadata.postedAt ? 'JobPosting.datePosted' : null,
        publicationUrl: metadata.url, publicationError: metadata.error, note: '发布日期取自官方岗位网页 JobPosting.datePosted；createdAt 创建时间不作为发布日期。' } };
  }
  if (u.hostname === 'jobs.ashbyhq.com') {
    const api = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}?includeCompensation=true`;
    if (!boards.has(api)) boards.set(api, readJson(api, fetchImpl));
    const data = await boards.get(api);
    if (!Array.isArray(data.jobs)) throw new Error('Ashby 返回格式变化');
    const j = data.jobs.find(x => x.id === id && x.isListed === true);
    if (!j) throw new Error('雇主已不再公开列出此岗位');
    if (!j.title || !j.descriptionPlain) throw new Error('Ashby 未返回完整 JD');
    return { ...candidate, title: j.title, jd: j.descriptionPlain, url: `https://jobs.ashbyhq.com/${encodeURIComponent(board)}/${id}`,
      location: [j.location, ...(j.secondaryLocations ?? []).map(x => x.location)].filter(Boolean).join(' / '),
      workMode: ({ OnSite: 'onsite', Remote: 'remote', Hybrid: 'hybrid' })[j.workplaceType] || 'unknown',
      salary: j.compensation?.compensationTierSummary || '未披露', postedAt: j.publishedAt ?? null, postedAtKind: 'latest',
      sourceEvidence: { url: api, retrievedAt: new Date().toISOString(), postedAtField: 'publishedAt', lastPublishedAt: j.publishedAt,
        note: 'Ashby publishedAt 为最近一次发布，可能是重新发布；页面与排序保留这一含义。' } };
  }
  return null;
}

export function extractFacts(job) {
  const titleTerms = [...(job.jd ? job.title : '').matchAll(/\b(Summer|Fall|Winter|Spring)\s+(20\d{2})\b/gi)].map(m => `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2]}`);
  const terms = [...new Set(titleTerms)];
  const body = job.jd || '';
  const months = '(January|February|March|April|May|June|July|August|September|October|November|December)';
  const start = job.title.match(new RegExp(`\\b${months}\\s+(?:[-–]|to)\\s+${months}\\s+(20\\d{2})\\b`, 'i'));
  const datedStart = body.match(new RegExp(`(?:start date|starting|starts)\\s*:?\\s*${months}\\s+(20\\d{2})\\b`, 'i'));
  const season = month => /January|February|March/i.test(month) ? 'Winter' : /April/i.test(month) ? 'Spring' : /May|June|July|August/i.test(month) ? 'Summer' : 'Fall';
  if (!terms.length && start && job.jd) terms.push(`${season(start[1])} ${start[3]}`);
  if (!terms.length && datedStart) terms.push(`${season(datedStart[1])} ${datedStart[2]}`);
  // Ambiguous lengths ("8 or 12 months") are left for review; no guessed duration.
  const numbers = { one: 1, two: 2, three: 3, four: 4, six: 6, eight: 8, twelve: 12, sixteen: 16 };
  const durations = [...body.matchAll(/(?:\b(?:duration|term|length)\s*:\s*|\bfor\s+)(\d{1,2}|one|two|three|four|six|eight|twelve|sixteen)[\s-]+months?\b/gi)].map(m => numbers[m[1].toLowerCase()] ?? Number(m[1]));
  if (job.jd) durations.push(...[...job.title.matchAll(/\b(\d{1,2})[\s-]+months?\b/gi)].map(m => Number(m[1])));
  durations.push(...[...body.matchAll(/\b(\d{1,2})[\s-]+month\s+(?:co[ -]?op|internship|work term|placement)\b/gi)].map(m => Number(m[1])));
  const ambiguousDuration = /\b\d{1,2}\s*(?:or|to|[-–/])\s*\d{1,2}[\s-]+months?\b/i.test(`${job.title}\n${body}`);
  const duration = ambiguousDuration ? [] : [...new Set(durations)];
  let workMode = job.workMode || 'unknown';
  if (workMode === 'unknown') {
    const modes = [...new Set([...`${job.location || ''}\n${body}`.matchAll(/(?:work(?:place)? (?:type|mode|arrangement|model)|this (?:role|position) is)\s*:?\s*(?:an?\s+)?(hybrid|remote|on[ -]?site)\b/gi)].map(m => /^on/i.test(m[1]) ? 'onsite' : m[1].toLowerCase()))];
    if (!modes.length && /\bremote\b/i.test(job.location || '') && !/\bhybrid\b/i.test(job.location || '')) modes.push('remote');
    if (modes.length === 1) workMode = modes[0];
  }
  const region = locationRegion({ location: job.location, inGta: job.inGta });
  const result = { ...job, ...extractDeadline(job), term: terms.length === 1 ? terms[0] : terms.length === 2 && terms.includes('Summer 2027') && terms.includes('Fall 2027') ? 'Summer/Fall 2027' : 'Unknown',
    workMode, durationMonths: duration.length === 1 ? duration[0] : null,
    inGta: ['toronto', 'gta'].includes(region) ? true : region === 'outside' ? false : null,
    isIntern: /\b(intern(?:ship)?|co[ -]?op)\b/i.test(job.title) ? true : null,
    relevant: role.test(job.title) ? true : null,
    postedAt: job.postedAt ?? null, salary: job.salary || '未披露', paid: job.paid ?? null,
    meetsMinimumWage: null, coverLetterRequired: null,
    eligibilityNotes: /remote/i.test(job.location) ? '远程岗位需核实是否允许在加拿大办公；来源中的美国远程不代表加拿大可申请。' : null };
  if (/(?:^|[.!?\n]\s*)(?:this is an? unpaid internship|this position is unpaid|compensation:\s*unpaid)\b/i.test(body)) result.paid = false;
  else if (/^(?:CA|US)?\$\s*[1-9][\d,.]*\s*(?:per|\/)\s*(?:hour|year|month)/i.test(result.salary)) result.paid = true;
  return result;
}

export async function discover({ fetchImpl = fetch, now = new Date(), onProgress = () => {} } = {}) {
  const report = { dataVersion: 2, source: SOURCE, targetTerms: [...TARGET_TERMS], startedAt: now.toISOString(), finishedAt: null, total: 0, candidates: 0, duplicates: 0, skipped: 0, processed: 0, results: [], errors: [] };
  onProgress({ phase: '正在读取公开实习索引…', report });
  const data = await readJson(SOURCE.dataUrl, fetchImpl);
  if (!Array.isArray(data) || !data.length || !data.some(x => typeof x.company_name === 'string' && Array.isArray(x.terms))) throw new Error('职位索引格式变化或为空，请稍后重试');
  report.total = data.length;
  const seen = new Set(), candidates = [];
  for (const entry of data) {
    if (!entry.active || !entry.is_visible || !entry.terms?.some(t => TARGET_TERMS.has(t)) || !entry.locations?.some(l => geography.test(l)) || !role.test(entry.title)) { report.skipped++; continue; }
    try {
      const url = canonicalUrl(entry.url);
      // Application suffixes are not a separate job. Terms are kept as source hints, never asserted as employer facts.
      const identity = url.replace(/\/(?:apply|application)(?:\?.*)?$/, '');
      if (seen.has(identity)) { report.duplicates++; continue; }
      seen.add(identity);
      candidates.push({ company: entry.company_name, title: entry.title, url, location: entry.locations.join(' / '), jd: '',
        indexEvidence: { url: SOURCE.url, terms: entry.terms, addedAt: Number.isFinite(entry.date_posted) ? new Date(entry.date_posted * 1000).toISOString() : null,
          note: '索引收录时间不是雇主发布时间；批次与地点需对照官方 JD。' } });
    } catch { report.errors.push('索引中的一条链接无效，已跳过'); }
  }
  report.candidates = candidates.length;
  const boards = new Map(); let cursor = 0;
  // Three concurrent read-only requests. Failures stay attached to the affected result.
  async function worker() {
    while (cursor < candidates.length) {
      const candidate = candidates[cursor++];
      let job = candidate, fetchError = null;
      try {
        const official = await officialJob(candidate, fetchImpl, boards);
        if (official) job = { ...official, indexEvidence: candidate.indexEvidence };
      } catch (e) { fetchError = e.message; }
      job = extractFacts(job);
      const evaluation = evaluateJob(job, now);
      const result = { ...job, ...evaluation, key: normalizeJob({ ...job, jd: job.jd || 'identity only' }).key,
        fullJd: Boolean(job.jd), fetchError };
      if (!result.fullJd) result.reasons.unshift(fetchError ? `官方 JD 读取失败：${fetchError}` : '此来源暂不支持自动读取全文，需要补充完整 JD');
      report.results.push(result); report.processed++;
      onProgress({ phase: `已检查 ${report.processed} / ${report.candidates} 条候选`, report });
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  report.results.sort((a, b) => Number(a.decision === 'REJECT') - Number(b.decision === 'REJECT') || Number(b.fullJd) - Number(a.fullJd) || comparePreference(a, b) || a.company.localeCompare(b.company));
  report.finishedAt = new Date().toISOString();
  return report;
}
