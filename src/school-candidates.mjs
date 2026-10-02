import { createHash } from 'node:crypto';
import { newRecord, normalizeJob, evaluateJob } from './core.mjs';
import { normalizePortalRow, linkPortal } from './portal.mjs';
import { extractFacts } from './discovery.mjs';

export function schoolCandidate(input, records, now = new Date()) {
  const row = normalizePortalRow(input);
  const existing = records.find(j => j.portal?.id === row.id);
  if (existing) return existing;
  const key = createHash('sha256').update(`tmu:${row.id}`).digest('hex').slice(0, 24);
  if (records.some(j => j.key === key)) throw new Error('学校候选已存在但关联已变化，请核对已有记录');
  const record = newRecord({ key, company: row.company, title: row.title, location: row.location || 'Unknown',
    term: row.term || 'Unknown', url: null, jd: '', fullJd: false, schoolCandidate: true,
    workMode: 'unknown', salary: '未披露', deadline: null, postedAt: null }, now);
  record.nextStep = '补齐官网链接与完整 JD';
  return linkPortal(record, row, records, { confirmed: true }, now);
}

export function completeSchoolCandidate(record, details, records) {
  if (!record.schoolCandidate || record.fullJd !== false || record.status !== 'Queue') throw new Error('仅待补 JD 的学校候选可以补齐正文');
  const source = { company: record.company, title: record.title, term: record.term, location: record.location,
    ...details, fullJd: true };
  const facts = extractFacts(source);
  const job = normalizeJob({ ...source, ...facts, term: facts.term === 'Unknown' ? record.term : facts.term });
  if (records.some(j => j.key !== record.key && (j.key === job.key || j.url === job.url))) {
    throw new Error('此官网职位已在 Queue 中。请先解除此候选的学校关联，再将学校 ID 关联已有申请，并归档此候选');
  }
  // Keep application identity and all user-owned state. School dates remain in portal only.
  return { ...record, ...job, ...evaluateJob(job), key: record.key, schoolCandidate: false, fullJd: true,
    sourceEvidence: details.sourceEvidence || { note: '本人补充并核对的 JD', retrievedAt: new Date().toISOString() },
    availability: undefined, eligibilityConfirmations: [], nextStep: record.nextStep === '补齐官网链接与完整 JD' ? '人工查看后指定处理' : record.nextStep };
}
