import { createHash } from 'node:crypto';
import { assessEligibility, eligibilityJdHash, ELIGIBILITY_VERSION } from './eligibility.mjs';
import { matchCurrentResumes } from './resume-profile.mjs';
import { classifyResume } from './resume-track.mjs';
import { deadlineExpired, extractDeadline } from './deadlines.mjs';

export const ASSESSMENT_VERSION = `coverage-v1+${ELIGIBILITY_VERSION}+inputs-v1`;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const jobInputHash = eligibilityJdHash;
export const evidenceFingerprint = job => hash((job.eligibilityConfirmations || []).filter(c => c.jdHash === jobInputHash(job)));
export const isSchoolOnly = job => job.jdSource === 'school' && !job.url;
export const schoolInputHash = job => hash({ key: job.key, jdHash: jobInputHash(job), schoolId: job.portal?.id,
  deadline: job.portal?.deadline, deadlineText: job.portal?.deadlineText });

export function schoolAvailabilityState(job, now = new Date()) {
  const saved = job.schoolAvailability;
  const current = Boolean(isSchoolOnly(job) && job.portal?.id && saved?.inputHash === schoolInputHash(job));
  const age = now - new Date(saved?.confirmedAt);
  const expired = deadlineExpired(job.portal?.deadline, now);
  return { inputHash: schoolInputHash(job), current, expired, confirmedAt: saved?.confirmedAt || null,
    recent: current && !expired && age >= 0 && age <= 15 * 60 * 1000, note: current ? saved.note : '' };
}

export function confirmSchoolAvailability(job, input, now = new Date()) {
  if (!isSchoolOnly(job) || !job.portal?.id || !job.jd?.trim() || job.fullJd === false || job.status !== 'Queue') throw new Error('请选择有完整学校 JD 的待处理岗位');
  if (deadlineExpired(job.portal.deadline, now)) throw new Error('学校申请截止时间已过，不能确认或生成新材料');
  if (input.inputHash !== schoolInputHash(job)) throw new Error('学校 JD 或截止信息已变化，请重新打开详情核对');
  if (input.confirmed !== true || typeof input.note !== 'string' || !input.note.trim() || input.note.length > 1000) throw new Error('请本人核实学校仍接受申请，填写依据并勾选确认');
  return { inputHash: schoolInputHash(job), confirmedAt: now.toISOString(), note: input.note.trim() };
}

export function assessJob(job, profiles, now = new Date(), selectedTrack = null) {
  const resumeClassification = classifyResume(job);
  const match = matchCurrentResumes(job, selectedTrack ? { track: selectedTrack } : resumeClassification, profiles);
  const eligibilityComparisons = match.match.comparisons.map(comparison => ({ track: comparison.source.track,
    ...assessEligibility(job, profiles[comparison.source.track], job.eligibilityConfirmations || [], now) }));
  const eligibility = eligibilityComparisons.find(e => e.track === match.match.source.track);
  const input = { jdHash: jobInputHash(job), ruleVersion: ASSESSMENT_VERSION,
    resumes: ['cs', 'data'].map(track => ({ ...profiles[track].source, available: profiles[track].available })),
    confirmationHash: evidenceFingerprint(job), ...(isSchoolOnly(job) ? { schoolInputHash: schoolInputHash(job) } : {}) };
  const assessment = { id: hash(input), ...input, assessedAt: now.toISOString() };
  return { ...match, assessment, eligibility, eligibilityComparisons, resumeClassification };
}

export function materialFreshness(material, assessment) {
  const previous = material?.assessment;
  if (!previous) return { status: 'unknown', reasons: ['旧材料未记录完整输入版本，请重新审阅'], needsReview: true };
  const reasons = [];
  if (previous.jdHash !== assessment.jdHash) reasons.push('JD 已变化');
  if (previous.schoolInputHash !== assessment.schoolInputHash) reasons.push('学校来源或截止信息已变化');
  if (previous.ruleVersion !== assessment.ruleVersion) reasons.push('评估规则已变化');
  if (hash(previous.resumes) !== hash(assessment.resumes)) reasons.push('当前简历已变化或不可读取');
  if (previous.id !== assessment.id && !reasons.length) reasons.push('资格核实记录已变化');
  return { status: reasons.length ? 'stale' : 'current', reasons, needsReview: reasons.length > 0 };
}

export function assessmentSnapshot(job, assessed) {
  return { assessment: assessed.assessment, job: { company: job.company, title: job.title, url: job.url,
    term: job.term, location: job.location, jd: job.jd, fullJd: job.fullJd, deadline: job.deadline,
    ...(isSchoolOnly(job) ? { jdSource: 'school', schoolId: job.portal?.id, schoolDeadline: job.portal?.deadline,
      schoolDeadlineText: job.portal?.deadlineText, schoolAvailability: job.schoolAvailability } : {}) },
    match: assessed.match, eligibility: assessed.eligibility, eligibilityComparisons: assessed.eligibilityComparisons };
}

export function availabilityState(job, now = new Date()) {
  if (job.jdSource === 'school' && !job.url) return { status: 'unknown', evidence: '学校来源 JD，尚无官网链接，无法核查官网开放状态', checkedAt: null, current: false, recent: false, manual: false };
  if (deadlineExpired(extractDeadline(job).deadline, now)) return { status: 'closed', evidence: '申请截止时间已过', checkedAt: job.availability?.checkedAt || null, current: true };
  const saved = job.availability;
  const current = Boolean(saved && saved.jdHash === jobInputHash(job));
  const recent = current && Number.isFinite(Date.parse(saved.checkedAt)) && now - new Date(saved.checkedAt) >= 0 && now - new Date(saved.checkedAt) <= 15 * 60 * 1000;
  return { ...(saved || { status: 'unknown', evidence: '尚未核查官方岗位', checkedAt: null }),
    status: current && (recent || saved.status === 'closed') ? saved.status : 'unknown', current, recent,
    manual: Boolean(recent && saved.manual?.jdHash === saved.jdHash && saved.manual?.checkedAt === saved.checkedAt) };
}

export function requireAvailable(job, now = new Date()) {
  if (job.portal?.channel === 'school-only' && job.portal.status === 'submitted') throw new Error('学校申请已完成；历史材料仍可预览，不生成新的申请材料');
  if (job.fullJd === false || !job.jd?.trim()) throw new Error('请先补齐完整 JD，再准备材料');
  if (isSchoolOnly(job)) {
    const state = schoolAvailabilityState(job, now);
    if (state.expired) throw new Error('学校申请截止时间已过，不能生成新材料；历史材料继续保留');
    if (job.status !== 'Queue' || !state.recent) throw new Error('学校来源需本人核实仍接受申请；确认有效期为 15 分钟，JD 或学校截止变化后需重新确认');
    return;
  }
  const state = availabilityState(job, now);
  if (state.status === 'closed') throw new Error('岗位已关闭或截止，不能生成新的申请材料；历史材料继续保留');
  if (!state.recent || (state.status !== 'open' && !state.manual)) throw new Error('岗位开放状态暂无法确认，请先复查官网；仍无法读取时可由本人核实后继续');
}
