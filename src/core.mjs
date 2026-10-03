import { createHash } from 'node:crypto';
import { extractDeadline, deadlineExpired } from './deadlines.mjs';
import { publication, workModeChoices } from '../web/job-facts.js';

export const TARGET_TERMS = new Set(['Winter 2027', 'Summer 2027', 'Fall 2027']);
const PREFERRED = /\b(toronto|north york|scarborough|markham|vaughan|richmond hill)\b/i;
const GTA = /\b(toronto|north york|scarborough|markham|vaughan|richmond hill|etobicoke|mississauga|brampton|caledon|oakville|burlington|milton|halton hills|pickering|ajax|whitby|oshawa|clarington|uxbridge|scugog|brock|aurora|newmarket|king|whitchurch.stouffville|east gwillimbury|georgina|gta|greater toronto area)\b/i;
const clean = value => String(value ?? '').trim();
const normalized = value => clean(value).toLowerCase().replace(/\s+/g, ' ');

export function canonicalUrl(value) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('职位链接必须是无凭证的 HTTP(S) 地址');
  }
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|gh_src$|source$|ref$|referrer$|trackingId$)/i.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  url.pathname = url.pathname.replace(/\/$/, '') || '/';
  return url.toString();
}

export function normalizeJob(input, { schoolId } = {}) {
  if (schoolId && (typeof schoolId !== 'string' || input.jdSource !== 'school' || input.url)) throw new Error('学校正文身份无效');
  for (const field of ['company', 'title', ...(schoolId ? [] : ['url']), 'jd']) {
    if (typeof input[field] !== 'string' || !input[field].trim()) throw new Error(`缺少 ${field}`);
  }
  const job = { ...input, ...extractDeadline(input), company: clean(input.company), title: clean(input.title), url: schoolId ? null : canonicalUrl(input.url) };
  job.term = clean(input.term) || 'Unknown';
  job.location = clean(input.location) || 'Unknown';
  job.workMode = input.workMode ?? 'unknown';
  if (!['remote', 'hybrid', 'onsite', 'unknown'].includes(job.workMode)) throw new Error('workMode 无效');
  for (const field of ['isIntern', 'relevant', 'paid', 'meetsMinimumWage', 'inGta', 'remoteEligible', 'citizenOnly', 'graduateOnly', 'coverLetterRequired']) {
    if (input[field] != null && typeof input[field] !== 'boolean') throw new Error(`${field} 必须是 true / false / null`);
  }
  if (input.durationMonths != null && (!Number.isFinite(input.durationMonths) || input.durationMonths <= 0)) {
    throw new Error('durationMonths 必须是正数或 null');
  }
  job.salary = clean(input.salary) || '未披露';
  const identity = schoolId ? `tmu:${schoolId}` : input.requisitionId
    ? `${normalized(job.company)}|${normalized(input.requisitionId)}`
    : job.url;
  job.key = createHash('sha256').update(`${identity}|${normalized(job.term)}`).digest('hex').slice(0, 24);
  return job;
}

export function evaluateJob(job, now = new Date()) {
  const reject = [], review = [];
  if (job.isIntern === false) reject.push('明确不是 co-op / intern');
  else if (job.isIntern !== true) review.push('核实是否 co-op / intern');
  if (job.relevant === false) reject.push('明确不属于 Software / Data / Hybrid 等相关方向');
  else if (job.relevant !== true) review.push('核实岗位方向');
  if (job.term === 'Unknown') review.push('核实是否 Winter / Summer / Fall 2027 入职');
  else if (!TARGET_TERMS.has(job.term) && job.term !== 'Summer/Fall 2027') reject.push('不属于 Winter / Summer / Fall 2027 入职批次');
  if (job.paid === false) reject.push('明确无薪');
  else if (job.paid !== true) review.push('薪资未确认；未披露不等于无薪');
  if (job.meetsMinimumWage === false) reject.push('已核实低于适用最低工资');
  else if (job.paid !== false && job.meetsMinimumWage !== true) review.push('核实适用最低工资，不自动估算');
  if (job.citizenOnly === true) review.push('岗位仅限公民，需本人核实是否满足');
  if (job.graduateOnly === true) review.push('岗位仅限硕士 / 博士，需本人核实是否满足');
  if (job.eligibilityNotes) review.push(clean(job.eligibilityNotes));

  const inGta = job.inGta ?? (GTA.test(job.location) ? true : null);
  if (workModeChoices(job)) {
    review.push('官网提供多种工作方式；核实所选方式的地点、任期和工作资格限制');
  } else if (job.workMode === 'remote') {
    if (job.remoteEligible !== true) review.push('核实是否允许从多伦多远程工作及工作资格');
  } else if (job.workMode === 'unknown') {
    review.push('核实办公方式；不将未知办公方式当作现场工作');
  } else if (inGta === null) {
    review.push('核实工作地点是否在 GTA');
  } else if (job.durationMonths == null) {
    review.push('核实任期长度');
  } else if (inGta && (job.durationMonths < 4 || job.durationMonths > 16)) {
    reject.push('GTA 现场 / 混合办公任期须为 4–16 个月');
  } else if (!inGta && job.durationMonths < 8) {
    reject.push('GTA 外现场 / 混合办公任期须至少 8 个月');
  }

  const published = publication(job);
  if (!published.at) review.push('官方未提供可核实的发布日期');
  else if (published.dateOnly) review.push('官方仅提供发布日期，未提供具体时间');
  else if (new Date(published.at) > now) review.push('发布时间在未来，需核实');
  if (job.deadline) {
    if (deadlineExpired(job.deadline, now)) reject.push('申请已截止');
    else if (!/T/.test(job.deadline)) review.push('截止日未注明时间，按多伦多当日结束处理');
  }
  return { decision: reject.length ? 'REJECT' : review.length ? 'REVIEW' : 'PASS', reasons: [...reject, ...review] };
}

export function comparePreference(a, b) {
  return Number(PREFERRED.test(b.location)) - Number(PREFERRED.test(a.location))
    || Number(b.durationMonths >= 8) - Number(a.durationMonths >= 8);
}

export function newRecord(job, now = new Date()) {
  return { ...job, ...evaluateJob(job, now), status: 'Queue', applicationDate: null,
    nextStep: '人工查看后指定处理', notes: '', materials: null, firstSeen: now.toISOString(), lastSeen: now.toISOString() };
}

export function markReady(record, materials) {
  if (!['Queue', '待提交'].includes(record.status)) throw new Error('已投递记录不能退回待提交');
  if (!materials?.resume) throw new Error('缺少简历 PDF，保留 Queue');
  if (record.coverLetterRequired === true && !materials.coverLetter) throw new Error('岗位要求 Cover Letter，材料尚未齐全');
  return { ...record, materials, status: '待提交', applicationDate: null, nextStep: '检查材料并手动提交申请' };
}

export function validateApplicationDate(date, now = new Date()) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || date > today) {
    throw new Error('请填写真实投递日期 YYYY-MM-DD，不能是未来日期');
  }
  return date;
}

export function submissionMaterials(record) {
  return structuredClone({ files: record.materials || null, version: record.materialVersion || null });
}

export function markSubmitted(record, date, confirmed, now = new Date(), receipt = '', assessmentContext = null) {
  if (!confirmed) throw new Error('只有用户明确确认已实际投递后才能更新');
  if (record.status !== '待提交') throw new Error('只有待提交记录可以确认投递');
  validateApplicationDate(date, now);
  if (typeof receipt !== 'string' || receipt.length > 1000) throw new Error('回执说明不得超过 1000 字');
  return { ...record, status: '已投递', applicationDate: date, nextStep: '等待回复',
    externalSubmission: { date, confirmedAt: now.toISOString(), receipt: receipt.trim(), assessmentContext: structuredClone(assessmentContext), materials: submissionMaterials(record) } };
}
