import { amazonUrl } from './amazon.mjs';
import { qualcommUrl } from './qualcomm.mjs';
import { createHash } from 'node:crypto';
import { canonicalUrl, normalizeJob } from './core.mjs';
import { deadlineExpired } from './deadlines.mjs';
import { durationRange, publication, workModes } from '../web/job-facts.js';
import { pinpointUrl } from './discovery-sources.mjs';
import { celesticaUrl } from './celestica.mjs';

const known = value => value != null && !['', 'unknown', '未披露'].includes(String(value).trim().toLowerCase());
const lineage = jobs => [...new Map(jobs.flatMap(j => j.discoverySources || []).map(s => [s.id, s])).values()];
const snapshots = jobs => [...new Map(jobs.flatMap(j => j.groupedSources || [{ key: j.key, url: j.url, term: j.term, title: j.title, location: j.location, jd: j.jd, sourceEvidence: j.sourceEvidence, fieldEvidence: j.fieldEvidence, discoverySources: j.discoverySources, requisitionId: j.requisitionId, salary: j.salary, durationMonths: j.durationMonths, durationRange: j.durationRange, workMode: j.workMode, deadline: j.deadline }]).map(s => [JSON.stringify([s.url, s.requisitionId, s.term, s.jd]), s])).values()];
const normalized = value => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

export function postingUrl(value) {
  if (qualcommUrl(value)) return qualcommUrl(value);
  if (amazonUrl(value)) return amazonUrl(value);
  if (celesticaUrl(value)) return celesticaUrl(value);
  if (pinpointUrl(value)) return pinpointUrl(value);
  const url = new URL(canonicalUrl(value));
  // Keep existing AMD catalogue identity stable across its official route migration.
  if(url.hostname==='careers.amd.com' && /^\/(?:careers-home\/)?jobs\/\d+\/?$/.test(url.pathname)){url.pathname='/jobs/'+url.pathname.match(/\d+/)[0];url.search='?icims=1';}
  if (['boards.greenhouse.io', 'job-boards.greenhouse.io'].includes(url.hostname) && /^\/[\w-]+\/jobs\/\d+(?:\/(?:apply|application))?$/.test(url.pathname)) {
    url.hostname = 'job-boards.greenhouse.io';
    url.pathname = url.pathname.replace(/\/(apply|application)$/, '');
    url.search = '';
  } else if (['jobs.lever.co', 'jobs.ashbyhq.com'].includes(url.hostname) && /^\/[^/]+\/[a-f0-9-]{36}(?:\/(?:apply|application))?$/i.test(url.pathname)) {
    url.pathname = url.pathname.replace(/\/(apply|application)$/, '');
    url.search = '';
  }
  return url.href;
}

export function sourceName(job) {
  if (job.jdSource === 'school') return '学校来源 · 本人提供 JD';
  if (qualcommUrl(job.url)) return 'Qualcomm / Eightfold';
  if (amazonUrl(job.url)) return 'Amazon Jobs';
  if (job.schoolCandidate) return '学校列表 · 待补 JD';
  if (celesticaUrl(job.url)) return 'Celestica';
  if (pinpointUrl(job.url)) return 'Pinpoint';
  let host;
  try { host = new URL(job.url).hostname; } catch { return '来源待核实'; }
  if (['boards.greenhouse.io', 'job-boards.greenhouse.io'].includes(host)) return 'Greenhouse';
  if (host === 'jobs.lever.co') return 'Lever';
  if (host === 'jobs.ashbyhq.com') return 'Ashby';
  if (host.endsWith('.myworkdayjobs.com')) return 'Workday';
  return '其他招聘系统';
}

// Resolve known identities first, then group matching company/title/term/location.
export function mergeDiscoveryJobs(jobs, stats = {}) {
  Object.assign(stats, { exact: 0, grouped: 0, conflicts: 0 });
  const rows = [], identities = new Map();
  let duplicates = 0;
  for (const input of jobs) {
    const job = { ...input, sourceLinks: [...new Set([...(input.sourceLinks || []), input.url])] };
    // Verified employer IDs identify one official posting; an index season hint
    // must not create another card when the official start remains unknown.
    const term = normalized((amazonUrl(job.url) || qualcommUrl(job.url)) && job.requisitionId ? job.term : job.term && job.term !== 'Unknown' ? job.term : [...(job.indexEvidence?.terms || [])].sort().join('|'));
    const keys = [`url:${postingUrl(job.url)}|${term}`];
    if (job.company && job.requisitionId && ['requisition_id', 'JobPosting.identifier'].includes(job.sourceEvidence?.requisitionIdField)) {
      keys.push(`req:${normalized(job.company)}|${normalized(job.requisitionId)}|${term}`);
    }
    const matches = [...new Set(keys.map(key => identities.get(key)).filter(row => row !== undefined))];
    const existing = matches.length === 1 ? rows[matches[0]] : null;
    const conflict = existing && ['company', 'title', 'location', 'workMode', 'salary', 'durationMonths', 'deadline', 'requisitionId'].some(field =>
      known(existing[field]) && known(job[field]) && normalized(existing[field]) !== normalized(job[field]));
    if (existing && !conflict) {
      duplicates++; stats.exact++;
      const sourceLinks = [...new Set([...existing.sourceLinks, ...job.sourceLinks])];
      const discoverySources = lineage([existing, job]);
      const groupedSources = snapshots([existing, job]);
      const indexEvidence = existing.indexEvidence || job.indexEvidence;
      const richness = j => Number(Boolean(j.fullJd)) * 100 + ['salary', 'workMode', 'durationMonths', 'postedAt'].filter(f => known(j[f])).length;
      if (richness(job) > richness(existing)) Object.assign(existing, job);
      if (discoverySources.length) existing.discoverySources = discoverySources;
      if (groupedSources.length > 1) existing.groupedSources = groupedSources;
      if (indexEvidence) existing.indexEvidence = indexEvidence;
      existing.sourceLinks = sourceLinks;
      for (const key of keys) identities.set(key, matches[0]);
      continue;
    }
    const index = rows.push(job) - 1;
    for (const key of keys) if (!identities.has(key)) identities.set(key, index);
  }
  const similar = new Map();
  for (const job of rows) {
    const fields = [job.company, job.title, job.term && job.term !== 'Unknown' ? job.term : [...(job.indexEvidence?.terms || [])].sort().join('|'), job.location].map(normalized);
    if (fields.some(value => !value || value === 'unknown')) continue;
    const key = JSON.stringify(fields);
    const group = similar.get(key) || [];
    group.push(job); similar.set(key, group);
  }
  for (const group of similar.values()) if (group.length > 1) {
    // Select a whole posting; never combine conflicting salaries, deadlines or JD.
    const preferred = [...group].sort((a, b) => Number(deadlineExpired(a.deadline)) - Number(deadlineExpired(b.deadline))
      || Number(Boolean(b.fullJd)) - Number(Boolean(a.fullJd)) || (b.jd?.length || 0) - (a.jd?.length || 0)
      || a.url.localeCompare(b.url))[0];
    const groupedSources = snapshots(group);
    const merged = { ...preferred, key: preferred.identityConflict ? normalizeJob(preferred).key : preferred.key,
      sourceLinks: [...new Set(group.flatMap(job => job.sourceLinks))], groupedSources,
      discoverySources: lineage(group), indexEvidence: preferred.indexEvidence || group.find(j => j.indexEvidence)?.indexEvidence,
      duplicateNote: `已按公司、标题、批次和地点合并 ${groupedSources.length} 条记录；当前显示一个来源的完整信息，其他入口与招聘编号已保留。` };
    delete merged.identityConflict;
    rows.splice(rows.indexOf(group[0]), 1, merged);
    for (const extra of group.slice(1)) rows.splice(rows.indexOf(extra), 1);
    duplicates += group.length - 1; stats.grouped += group.length - 1;
  }
  // The existing Queue key can coincide even when facts conflict. Keep each row
  // selectable, but require a human to resolve identity before a Queue write.
  const queueKeys = new Map();
  for (const job of rows) {
    if (!job.key) continue;
    for (const key of [`key:${job.key}`, `url:${postingUrl(job.url)}|${normalized(job.term)}`]) {
      const group = queueKeys.get(key) || [];
      group.push(job); queueKeys.set(key, group);
    }
  }
  const conflicts = new Set([...queueKeys.values()].filter(group => group.length > 1).flat());
  stats.conflicts = conflicts.size;
  for (const job of conflicts) {
    job.identityConflict = true;
    job.duplicateNote = '招聘编号或链接相同，但批次或岗位信息冲突；保留独立记录。请先核对官网，再通过手动添加录入已确认的职位。';
    job.key = createHash('sha256').update(JSON.stringify([job.key, job.url, job.title, job.location, job.workMode, job.salary, job.durationMonths, job.deadline, job.indexEvidence?.terms])).digest('hex').slice(0, 24);
  }
  return { results: rows, duplicates };
}

export function discoveryCoverage(jobs) {
  const sources = new Map();
  for (const job of jobs) {
    const name = sourceName(job);
    const row = sources.get(name) || { name, total: 0, fullJd: 0, failed: 0, unsupported: 0, published: 0, duration: 0, salary: 0, workMode: 0 };
    row.total++;
    row.fullJd += Number(Boolean(job.fullJd));
    row.failed += Number(Boolean(job.fetchError));
    row.unsupported += Number(!job.fullJd && !job.fetchError);
    row.published += Number(Boolean(publication(job).at));
    row.duration += Number(Boolean(durationRange(job)));
    row.salary += Number(Boolean(job.salary && job.salary !== '未披露'));
    row.workMode += Number(workModes(job).length > 0);
    sources.set(name, row);
  }
  return [...sources.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}
