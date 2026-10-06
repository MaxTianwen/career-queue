import { EMPLOYER_SOURCES, readEmployerBoard, readPublicJson } from '../discovery-sources.mjs';
import { classifyResume } from '../resume-track.mjs';
import { extractDeadline, deadlineExpired } from '../deadlines.mjs';
import { postingUrl } from '../discovery-records.mjs';
import { digest, scoreFor } from './resume.mjs';
import { officialJob, SOURCE } from '../discovery.mjs';

// Public index and employer boards; no personal v1 cache or Notion data.
export const INDEX_SOURCE = { ...SOURCE, id: 'index' };
export async function readInternshipIndex(fetchImpl = fetch) {
  const data = await readPublicJson(SOURCE.dataUrl, fetchImpl);
  if (!Array.isArray(data) || !data.length) throw new Error('公共索引格式异常');
  const jobs=[]; let malformed=0;
  for (const e of data) {
    if (!e || !Array.isArray(e.terms) || !Array.isArray(e.locations) || typeof e.title!=='string' || typeof e.company_name!=='string') { malformed++; continue; }
    if (!e.active || !e.is_visible || !e.terms.some(t=>/^(Winter|Summer|Fall) 2027$/.test(t))) continue;
    try { jobs.push({company:e.company_name,title:e.title,url:postingUrl(e.url),location:e.locations.join(' / '),term:e.terms.join(' / '),jd:'',indexInternship:true}); } catch { malformed++; }
  }
  return {jobs,raw:data.length,status:malformed?'partial':'complete',error:malformed?'索引有无效记录':null};
}
const canada = /\b(?:canada|canadian|toronto|markham|vaughan|waterloo|ottawa|montreal|montréal|quebec|québec|vancouver|burnaby|richmond hill|scarborough|north york|newmarket|calgary|edmonton|halifax|winnipeg|saskatoon|mississauga|ontario|british columbia|alberta)\b/i;
export function catalogueJob(raw, source) {
  if ((!raw.indexInternship && !/\b(?:intern(?:ship)?|co[ -]?op)\b/i.test(raw.title || '')) || !(canada.test(raw.location || '') || /\bremote\b/i.test(raw.location || ''))) return null;
  const classification = classifyResume(raw);
  if (classification.track === 'unknown') return null;
  const url = postingUrl(raw.url);
  if (!url || String(raw.jd || '').length > 60000) return null;
  return { id: digest(url), company: String(raw.company || source.name).slice(0, 200), title: String(raw.title).slice(0, 200),
    location: String(raw.location || '').slice(0, 500), url, jd: String(raw.jd || '').slice(0, 60000),
    salary: String(raw.salary || '未披露').slice(0, 500), workMode: raw.workMode || 'unknown',
    postedAt: raw.postedAt || null, detailError: raw.detailError || null, requisitionId: String(raw.requisitionId || '').slice(0, 100), term: String(raw.term || '').slice(0, 100),
    ...extractDeadline(raw), classification, source: { id: source.id, name: source.name, url: source.url } };
}
export async function fetchCatalogue({ readBoard = readEmployerBoard, readDetail = officialJob, readIndex = readInternshipIndex, sources = [INDEX_SOURCE, ...EMPLOYER_SOURCES] } = {}) {
  const jobs = new Map(), statuses = []; let cursor = 0;
  async function worker() {
    while (cursor < sources.length) {
      const source = sources[cursor++];
      try {
        const result = source.id === 'index' ? await readIndex() : await readBoard(source, fetch);
        let selected = 0, detailed = 0, position=0;
        const records=result.jobs || [];
        async function details() { while(position<records.length) { const raw=records[position++];
          try {
            let job = catalogueJob(raw, source);
            if (job && !job.jd) {
              try { job = catalogueJob({ ...raw, ...await readDetail(raw) }, source); }
              catch { job.detailError = '正文暂时不可读，暂不评分'; }
            }
            if (job) {
              selected++; if(job.jd) detailed++;
              const old=jobs.get(job.id);
              const lineage=[...new Map([...(old?.sources || []),job.source].map(s=>[s.id,s])).values()];
              const preferred=old && (source.id==='index' || (!job.jd && old.jd)) ? old : job;
              jobs.set(job.id,{...preferred,sources:lineage});
            }
          } catch { /* An invalid external record cannot become an application URL. */ }
        } }
        await Promise.all([details(),details(),details()]);
        statuses.push({ id: source.id, name: source.name, status: result.status, raw: result.raw ?? records.length, count: selected, detailed, error: result.error ? '来源未能完整读取，请稍后重试' : null });
      } catch { statuses.push({ id: source.id, name: source.name, status: 'failed', count: 0, error: '公开列表暂时不可读' }); }
    }
  }
  await Promise.all([worker(), worker()]);
  return { jobs: [...jobs.values()], sources: statuses, finishedAt: new Date().toISOString() };
}
export function recommend(jobs, preferences, resume, now = new Date()) {
  if (preferences.jobTypes && !['intern', 'co-op', 'intern,co-op'].includes(preferences.jobTypes)) return [];
  const keywords = String(preferences.locations || '').split(/[,，;；/\n]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
  return jobs.filter(job => !deadlineExpired(job.deadline, now))
    .filter(job => !preferences.jobTypes || preferences.jobTypes === 'intern,co-op' || (preferences.jobTypes === 'intern' ? /\bintern(?:ship)?\b/i : /\bco[ -]?op\b/i).test(job.title))
    .filter(job => !preferences.direction || job.classification.track === preferences.direction || (preferences.direction !== 'mixed' && job.classification.track === 'mixed'))
    .filter(job => !keywords.length || keywords.some(word => `${job.location} ${job.workMode}`.toLowerCase().includes(word)))
    .map(job => ({ ...job, match: scoreFor(job, resume) }))
    .sort((a, b) => (b.match.score ?? -1) - (a.match.score ?? -1) || a.company.localeCompare(b.company));
}
