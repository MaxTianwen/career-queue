import { createHash } from 'node:crypto';
import { canonicalUrl } from './core.mjs';
import { durationRange, publication } from '../web/job-facts.js';

const normalized = value => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

export function postingUrl(value) {
  const url = new URL(canonicalUrl(value));
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
  let host;
  try { host = new URL(job.url).hostname; } catch { return '来源待核实'; }
  if (['boards.greenhouse.io', 'job-boards.greenhouse.io'].includes(host)) return 'Greenhouse';
  if (host === 'jobs.lever.co') return 'Lever';
  if (host === 'jobs.ashbyhq.com') return 'Ashby';
  if (host.endsWith('.myworkdayjobs.com')) return 'Workday';
  return '其他招聘系统';
}

// Keep uncertain identities and conflicting official facts separate.
export function mergeDiscoveryJobs(jobs) {
  const rows = [], identities = new Map();
  let duplicates = 0;
  for (const input of jobs) {
    const job = { ...input, sourceLinks: [...new Set([...(input.sourceLinks || []), input.url])] };
    const term = normalized(job.term && job.term !== 'Unknown' ? job.term : [...(job.indexEvidence?.terms || [])].sort().join('|'));
    const keys = [`url:${postingUrl(job.url)}|${term}`];
    if (job.company && job.requisitionId && ['requisition_id', 'JobPosting.identifier'].includes(job.sourceEvidence?.requisitionIdField)) {
      keys.push(`req:${normalized(job.company)}|${normalized(job.requisitionId)}|${term}`);
    }
    const matches = [...new Set(keys.map(key => identities.get(key)).filter(row => row !== undefined))];
    const existing = matches.length === 1 ? rows[matches[0]] : null;
    const conflict = existing && ['company', 'title', 'location', 'workMode', 'salary', 'durationMonths', 'deadline', 'requisitionId'].some(field =>
      existing[field] != null && job[field] != null && normalized(existing[field]) !== normalized(job[field]));
    if (existing && !conflict) {
      duplicates++;
      const sourceLinks = [...new Set([...existing.sourceLinks, ...job.sourceLinks])];
      if (!existing.fullJd && job.fullJd) Object.assign(existing, job);
      existing.sourceLinks = sourceLinks;
      for (const key of keys) identities.set(key, matches[0]);
      continue;
    }
    const index = rows.push(job) - 1;
    for (const key of keys) if (!identities.has(key)) identities.set(key, index);
  }
  const similar = new Map();
  for (const job of rows) {
    const key = [job.company, job.title, job.term && job.term !== 'Unknown' ? job.term : [...(job.indexEvidence?.terms || [])].sort().join('|'), job.location].map(normalized).join('|');
    const group = similar.get(key) || [];
    group.push(job); similar.set(key, group);
  }
  for (const group of similar.values()) if (group.length > 1) {
    for (const job of group) job.duplicateNote = `发现 ${group.length} 条同公司、同标题、同批次和地点的记录；未确认相同，保留独立职位，请核对招聘编号。`;
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
    row.workMode += Number(['onsite', 'hybrid', 'remote'].includes(job.workMode));
    sources.set(name, row);
  }
  return [...sources.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}
