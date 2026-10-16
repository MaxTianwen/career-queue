import { accessDenied, rateState, nextRateLimit } from '../detail-retry.mjs';
import { explicitJobRequirements } from '../job-requirements.mjs';
import {jobCategory} from '../job-category.mjs';
import { usRemoteEligibility } from '../job-country.mjs';
import { durationFacts } from '../duration-facts.mjs';
import { publicStructuredJob, publicJobIdentity } from '../public-structured-job.mjs';
import { EMPLOYER_SOURCES, readEmployerBoard, readPublicJson } from '../discovery-sources.mjs';
import { classifyResume } from '../resume-track.mjs';
import { extractDeadline, deadlineExpired } from '../deadlines.mjs';
import { postingUrl } from '../discovery-records.mjs';
import { digest, scoreFor, resumeProfile } from './resume.mjs';
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
  raw = explicitJobRequirements(raw);
  if ((!raw.indexInternship && !/\b(?:intern(?:ship)?|co[ -]?op)\b/i.test(raw.title || '')) || !(canada.test(raw.location || '') || /\bremote\b/i.test(raw.location || '') || usRemoteEligibility(raw).eligible)) return null;
  const classification = classifyResume(raw);
  if (classification.track === 'unknown' && jobCategory(raw).primary!=='embedded') return null;
  const url = postingUrl(raw.url);
  if (!url || String(raw.jd || '').length > 60000) return null;
  return { id: digest(url), company: String(raw.company || source.name).slice(0, 200), title: String(raw.title).slice(0, 200),
    location: String(raw.location || '').slice(0, 500), url, jd: String(raw.jd || '').slice(0, 60000),
    durationText:String(raw.durationText || '').slice(0,2000),durationMonths:raw.durationMonths ?? null,durationRange:raw.durationRange || null,fullJd:raw.fullJd === true ? true : raw.fullJd === false ? false : null,jdCompleteness:raw.jdCompleteness || null,officialTitle:String(raw.officialTitle || '').slice(0,200),
    durationSource:raw.durationSource || null,fieldEvidence:raw.fieldEvidence || null,durationEvidence:raw.durationEvidence || null,duration:String(raw.duration || '').slice(0,2000),sourceEvidence:raw.sourceEvidence || null,durationInfo:durationFacts(raw),
    salary: String(raw.salary || '未披露').slice(0, 500), workMode: raw.workMode || 'unknown',
    detailRateLimit:raw.detailRateLimit || null,detailRetryAt:raw.detailRetryAt || null,detailAccessDenied:raw.detailAccessDenied || false,detailFetchUrl:raw.detailFetchUrl || null,postedAt: raw.postedAt || null, postedAtKind: raw.postedAtKind || null, detailError: raw.detailError || null, requisitionId: String(raw.requisitionId || (new URL(url).hostname==='careers.amd.com'?publicJobIdentity(url):'')).slice(0, 100), term: String(raw.term || '').slice(0, 100),
    ...extractDeadline(raw), classification, jobCategory:jobCategory(raw), source: { id: source.id, name: source.name, url: source.url } };
}
export function catalogueDetailTarget(raw){
 const u=new URL(raw.url);
 if(u.protocol==='https:'&&!u.port&&!u.username&&!u.password&&u.hostname==='careers.amd.com'&&/^\/(?:careers-home\/)?jobs\/\d+\/?$/.test(u.pathname)){
  u.pathname='/careers-home/jobs/'+publicJobIdentity(raw.url);return {...raw,url:u.href};
 }
 return raw;
}
const accessScope=job=>{const u=new URL(job.detailFetchUrl||job.url);return u.hostname==='careers.amd.com'?u.origin+(u.pathname.startsWith('/careers-home/jobs/')?'/careers-home/jobs/':'/jobs/'):u.hostname;};
export async function readCatalogueDetail(raw,fetchImpl=fetch){
 const u=new URL(raw.url);let adapted=catalogueDetailTarget(raw);
 if(u.hostname==='jobs.ashbyhq.com'&&u.protocol==='http:'&&!u.port&&!u.username&&!u.password)adapted={...raw,url:raw.url.replace(/^http:/,'https:')};
 if(u.hostname==='app.careerpuck.com'&&u.protocol==='https:'&&!u.port&&!u.username&&!u.password){const m=u.pathname.match(/^\/job-board\/lyft\/job\/(\d+)$/);if(m&&u.searchParams.get('gh_jid')===m[1])adapted={...raw,url:'https://job-boards.greenhouse.io/lyft/jobs/'+m[1]};}
 const guardedFetch=async(...args)=>{const response=await fetchImpl(...args);if(response.status===429){const error=new Error('来源返回 HTTP 429');error.status=429;error.receivedAt=Date.now();error.retryAfter=response.headers?.get?.('retry-after')||null;throw error;}return response;};
 const detail=await officialJob(adapted,guardedFetch) || await publicStructuredJob(adapted,guardedFetch);return detail?{...detail,url:raw.url,detailFetchUrl:adapted.url,detailAccessDenied:false,detailRateLimit:null,detailRetryAt:null,detailError:null,jdCompleteness:detail.fullJd===true?'full':/JobPosting/i.test(detail.sourceEvidence?.field || '')?'official-description':'official-detail'}:null;
}
export async function fetchCatalogue({ readBoard = readEmployerBoard, readDetail = readCatalogueDetail, readIndex = readInternshipIndex, sources = [INDEX_SOURCE, ...EMPLOYER_SOURCES], cachedJobs = [], now = Date.now() } = {}) {
  const jobs = new Map(), statuses = [], cached=new Map(cachedJobs.map(j=>[postingUrl(j.url),j])); let cursor = 0;
  const deniedHosts=new Set(cachedJobs.filter(accessDenied).map(accessScope));
  const rates=new Map(),queues=new Map();
  for(const job of cachedJobs){const state=rateState(job),scope=accessScope(job);if(state&&(!rates.has(scope)||state.nextRetryAt>rates.get(scope).nextRetryAt))rates.set(scope,state);}
  // Serialize detail reads per host so a 429 stops queued reads immediately; no timers or automatic retries.
  async function scopedDetail(raw){
   const scope=accessScope({...raw,detailFetchUrl:catalogueDetailTarget(raw).url}),prior=queues.get(scope)||Promise.resolve();
   const work=prior.catch(()=>{}).then(async()=>{
    if(accessDenied(raw)||deniedHosts.has(scope)){deniedHosts.add(scope);const error=new Error('此前访问被拒绝，停止自动重试');error.accessStopped=true;throw error;}
    const state=rates.get(scope);
    if(state?.nextRetryAt>now){const error=new Error('来源返回 HTTP 429（冷却中，沿用已有正文）');error.detailRateLimit=state;throw error;}
    try{const detail=await readDetail(raw);rates.delete(scope);return detail;}
    catch(error){if(error.status===429||/HTTP 429\b/.test(error.message)){error.detailRateLimit=nextRateLimit(error,state,now);rates.set(scope,error.detailRateLimit);}else if(/HTTP (?:401|403)\b/.test(error.message))deniedHosts.add(scope);throw error;}
   });queues.set(scope,work);try{return await work;}finally{if(queues.get(scope)===work)queues.delete(scope);}
  }
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
            if (job && (!job.jd || raw.fullJd === false)) {
              const previous=cached.get(job.url),age=now-Date.parse(previous?.sourceEvidence?.retrievedAt || previous?.sourceUpdatedAt || '');
              if(previous?.jd && !previous.detailError && !rateState(previous) && age>=0 && age<24*60*60*1000)job={...job,...Object.fromEntries(['title','location','workMode','deadline','deadlineEvidence','jd','requisitionId','sourceEvidence','fieldEvidence','duration','durationText','durationMonths','durationRange','fullJd','jdCompleteness','officialTitle','durationSource','durationEvidence'].filter(k=>previous[k] && (!['deadline','deadlineEvidence'].includes(k) || !job.deadline)).map(k=>[k,previous[k]]))};
              else if(deniedHosts.has(accessScope({...job,detailFetchUrl:catalogueDetailTarget(job).url})))job={...job,detailFetchUrl:catalogueDetailTarget(job).url,detailAccessDenied:true,detailError:previous?.detailError || '此前访问被拒绝，停止自动重试'};
              else if(previous?.detailRetryAt>now)job={...job,detailError:previous.detailError,detailRetryAt:previous.detailRetryAt,detailRateLimit:rateState(previous)};
              else try {const detail=await scopedDetail(raw);if(detail?.jd)job=catalogueJob({...raw,...detail},source);else job={...job,detailError:'来源暂未支持完整JD',detailRetryAt:now+60*60*1000};}
              catch(error) {const detailFetchUrl=catalogueDetailTarget(job).url;job={...job,detailFetchUrl,detailAccessDenied:Boolean(error.accessStopped)||/HTTP (?:401|403)\b/.test(error.message),detailRateLimit:error.detailRateLimit||null,detailError:'正文读取失败：'+error.message,detailRetryAt:error.detailRateLimit?.nextRetryAt||now+60*60*1000};}
            }
            if (job) {
              job = explicitJobRequirements(job);
              job.durationEvidence=job.durationEvidence || cached.get(job.url)?.durationEvidence;job.durationInfo=durationFacts(job);job.jobCategory=jobCategory(job);
              selected++; if(job.jd) detailed++;
              const old=jobs.get(job.id);
              const lineage=[...new Map([...(old?.sources || []),job.source].map(s=>[s.id,s])).values()];
              const preferred=old && (source.id==='index' || (!job.jd && old.jd) || (old.fullJd && !job.fullJd)) ? old : job;
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
  const profile=resumeProfile(resume);
  return jobs.filter(job => job.hasSchool || !deadlineExpired(job.deadline, now))
    .filter(job => !preferences.jobTypes || preferences.jobTypes === 'intern,co-op' || (preferences.jobTypes === 'intern' ? /\bintern(?:ship)?\b/i : /\bco[ -]?op\b/i).test(job.title))
    .filter(job => !preferences.direction || job.classification.track === preferences.direction || (preferences.direction==='cs'&&jobCategory(job).primary==='embedded') || (preferences.direction !== 'mixed' && job.classification.track === 'mixed'))
    .filter(job => !keywords.length || keywords.some(word => `${job.location} ${job.workMode}`.toLowerCase().includes(word)))
    .map(job => ({ ...job, match: scoreFor(job, resume, profile) }))
    .sort((a, b) => (b.match.score ?? -1) - (a.match.score ?? -1) || a.company.localeCompare(b.company));
}
