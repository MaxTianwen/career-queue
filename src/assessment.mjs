import { createHash } from 'node:crypto';
import { assessEligibility, eligibilityJdHash, ELIGIBILITY_VERSION } from './eligibility.mjs';
import { matchCurrentResumes } from './resume-profile.mjs';
import { classifyResume } from './resume-track.mjs';
import { deadlineExpired, extractDeadline } from './deadlines.mjs';

export const ASSESSMENT_VERSION = `coverage-v1+${ELIGIBILITY_VERSION}+inputs-v1`;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const jobInputHash = eligibilityJdHash;
export const evidenceFingerprint = job => hash((job.eligibilityConfirmations || []).filter(c => c.jdHash === jobInputHash(job)));

export function assessJob(job, profiles, now = new Date(), selectedTrack = null) {
  const resumeClassification = classifyResume(job);
  const match = matchCurrentResumes(job, selectedTrack ? { track: selectedTrack } : resumeClassification, profiles);
  const eligibilityComparisons = match.match.comparisons.map(comparison => ({ track: comparison.source.track,
    ...assessEligibility(job, profiles[comparison.source.track], job.eligibilityConfirmations || [], now) }));
  const eligibility = eligibilityComparisons.find(e => e.track === match.match.source.track);
  const input = { jdHash: jobInputHash(job), ruleVersion: ASSESSMENT_VERSION,
    resumes: ['cs', 'data'].map(track => ({ ...profiles[track].source, available: profiles[track].available })),
    confirmationHash: evidenceFingerprint(job) };
  const assessment = { id: hash(input), ...input, assessedAt: now.toISOString() };
  return { ...match, assessment, eligibility, eligibilityComparisons, resumeClassification };
}

export function materialFreshness(material, assessment) {
  const previous = material?.assessment;
  if (!previous) return { status: 'unknown', reasons: ['旧材料未记录完整输入版本，请重新审阅'], needsReview: true };
  const reasons = [];
  if (previous.jdHash !== assessment.jdHash) reasons.push('JD 已变化');
  if (previous.ruleVersion !== assessment.ruleVersion) reasons.push('评估规则已变化');
  if (hash(previous.resumes) !== hash(assessment.resumes)) reasons.push('当前简历已变化或不可读取');
  if (previous.id !== assessment.id && !reasons.length) reasons.push('资格核实记录已变化');
  return { status: reasons.length ? 'stale' : 'current', reasons, needsReview: reasons.length > 0 };
}

export function assessmentSnapshot(job, assessed) {
  return { assessment: assessed.assessment, job: { company: job.company, title: job.title, url: job.url,
    term: job.term, location: job.location, jd: job.jd, fullJd: job.fullJd, deadline: job.deadline },
    match: assessed.match, eligibility: assessed.eligibility, eligibilityComparisons: assessed.eligibilityComparisons };
}

export function availabilityState(job, now = new Date()) {
  if (deadlineExpired(extractDeadline(job).deadline, now)) return { status: 'closed', evidence: '申请截止时间已过', checkedAt: job.availability?.checkedAt || null, current: true };
  const saved = job.availability;
  const current = Boolean(saved && saved.jdHash === jobInputHash(job));
  const recent = current && Number.isFinite(Date.parse(saved.checkedAt)) && now - new Date(saved.checkedAt) >= 0 && now - new Date(saved.checkedAt) <= 15 * 60 * 1000;
  return { ...(saved || { status: 'unknown', evidence: '尚未核查官方岗位', checkedAt: null }),
    status: current && (recent || saved.status === 'closed') ? saved.status : 'unknown', current, recent,
    manual: Boolean(recent && saved.manual?.jdHash === saved.jdHash && saved.manual?.checkedAt === saved.checkedAt) };
}

export function requireAvailable(job, now = new Date()) {
  if (job.fullJd === false || !job.jd?.trim()) throw new Error('请先补齐完整 JD，再准备材料');
  const state = availabilityState(job, now);
  if (state.status === 'closed') throw new Error('岗位已关闭或截止，不能生成新的申请材料；历史材料继续保留');
  if (!state.recent || (state.status !== 'open' && !state.manual)) throw new Error('岗位开放状态暂无法确认，请先复查官网；仍无法读取时可由本人核实后继续');
}
