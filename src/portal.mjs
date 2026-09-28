import { createHash } from 'node:crypto';
import { canonicalUrl, validateApplicationDate, submissionMaterials } from './core.mjs';
import { deadlineExpired } from './deadlines.mjs';
import { schoolDeadline } from './portal-paste.mjs';

const norm = value => String(value || '').normalize('NFKC').trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const known = value => value && !/^(unknown|待核实|未披露)$/i.test(value);
const field = (value, max = 300) => {
  if (value == null) return '';
  if (typeof value !== 'string' || value.length > max) throw new Error(`字段须为不超过 ${max} 字的文字`);
  return value.trim();
};
const safeLink = value => value ? canonicalUrl(value) : '';
export const portalRevision = record => createHash('sha256').update(JSON.stringify({ key: record.key, portal: record.portal,
  history: record.portalHistory, status: record.status, applicationDate: record.applicationDate,
  materials: record.materials, materialVersion: record.materialVersion, externalSubmission: record.externalSubmission })).digest('hex');

export function normalizePortalRow(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('学校岗位字段无效');
  const row = Object.fromEntries(['id', 'company', 'title', 'location', 'term', 'requisitionId'].map(k => [k, field(input[k])]));
  row.url = safeLink(field(input.url, 2000));
  row.externalUrl = safeLink(field(input.externalUrl, 2000));
  Object.assign(row, schoolDeadline(field(input.deadline, 100)));
  if (input.deadlineText) row.deadlineText = field(input.deadlineText, 100);
  row.sourceStatus = field(input.sourceStatus);
  if (!row.id || !row.company || !row.title) throw new Error('需要学校职位 ID、公司和标题');
  return row;
}

export function externalSubmitted(record) {
  // A closed application without a submission date is not proof of submission.
  return Boolean(record.applicationDate && ['已投递', '面试中', '已结束'].includes(record.status));
}

export function portalSummary(record, now = new Date()) {
  const portal = record.portal;
  const submitted = externalSubmitted(record);
  const expired = deadlineExpired(portal?.deadline, now);
  const category = !portal ? 'unlinked' : portal.status === 'submitted' ? 'submitted'
    : portal.requirement === 'not-required' ? 'not-required' : expired ? 'expired'
      : portal.requirement !== 'required' ? 'unknown' : submitted ? 'pending' : 'external-pending';
  return { category, externalSubmitted: submitted, schoolExpired: expired, employerDeadline: record.deadline || null,
    schoolDeadline: portal?.deadline || null, label: { unlinked: '未关联学校岗位', submitted: '学校已交', 'not-required': '无需学校提交',
      expired: '学校截止已过', unknown: '双渠道要求待确认', pending: '学校待补交', 'external-pending': '官网尚未确认投递' }[category] };
}

function evidence(row, job) {
  const sources = [job, ...(job.groupedSources || [])];
  const reasons = [], conflicts = [];
  const sameCompany = norm(row.company) === norm(job.company);
  const urlMatch = row.externalUrl && sources.some(s => { try { return canonicalUrl(s.url) === row.externalUrl; } catch { return false; } });
  const idMatch = sameCompany && row.requisitionId && sources.some(s => norm(s.requisitionId) === norm(row.requisitionId));
  if (urlMatch) reasons.push('外部职位链接一致');
  if (idMatch) reasons.push('公司与雇主招聘编号一致');
  if (known(row.term) && known(job.term) && norm(row.term) !== norm(job.term)) conflicts.push('入职批次不同');
  if (known(row.location) && known(job.location) && norm(row.location) !== norm(job.location)) conflicts.push('地点表述不同，需核对');
  if (!sameCompany && urlMatch) conflicts.push('公司名称不同');
  if (row.requisitionId && job.requisitionId && norm(row.requisitionId) !== norm(job.requisitionId)) conflicts.push('主记录招聘编号不同');
  const words = norm(row.title).split(' ').filter(Boolean), other = new Set(norm(job.title).split(' '));
  const titleSimilar = words.length && words.filter(w => other.has(w)).length / Math.max(words.length, other.size) >= 0.6;
  if (!reasons.length && sameCompany && titleSimilar) reasons.push('公司相同、标题相近，仅供核对');
  return { reasons, conflicts, strong: Boolean((urlMatch || idMatch) && !conflicts.length) };
}

export function previewPortal(rows, records) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 100) throw new Error('每批需要 1–100 条学校岗位');
  const ids = new Set();
  return rows.map((input, index) => {
    try {
      const row = normalizePortalRow(input);
      if (ids.has(row.id)) throw new Error('本批学校职位 ID 重复，请保留一条后预览');
      ids.add(row.id);
      const linked = records.filter(j => j.portal?.id === row.id);
      const candidates = records.map(j => {
        const match = evidence(row, j);
        if (j.portal?.id === row.id && !match.reasons.length) match.reasons.push('已有关联，需要核对更新后的来源');
        return { key: j.key, company: j.company, title: j.title, location: j.location, term: j.term, status: j.status,
          externalSubmitted: externalSubmitted(j), linkedId: j.portal?.id || null, revision: portalRevision(j), ...match };
      }).filter(c => c.reasons.length);
      const strong = candidates.filter(c => c.strong && (!c.linkedId || c.linkedId === row.id));
      const category = linked.length ? 'linked' : strong.length === 1 ? 'exact' : candidates.length ? 'possible' : 'unmatched';
      return { index, row, category, candidates, suggestedKey: linked.length === 1 ? linked[0].key : category === 'exact' ? strong[0].key : null,
        relatedSchoolIds: rows.filter(other => other?.id !== row.id && row.requisitionId && norm(other?.requisitionId) === norm(row.requisitionId) && norm(other?.company) === norm(row.company) && norm(other?.term) === norm(row.term)).map(other => other.id),
        missing: ['url', 'location', 'term', 'externalUrl', 'requisitionId', 'deadline'].filter(k => !row[k]) };
    } catch (e) { return { index, category: 'invalid', error: e.message, candidates: [] }; }
  });
}

function history(record, action, now) {
  const events = record.portalHistory || [];
  if (events.length >= 30) throw new Error('关联历史已达本版上限，请保留记录并联系维护，不自动删除历史');
  return [...events, { action, at: now.toISOString(), portal: structuredClone(record.portal || null) }];
}

export function linkPortal(record, input, records, { confirmed, requirement = 'unknown' } = {}, now = new Date()) {
  if (confirmed !== true) throw new Error('请核对学校岗位与外部职位后确认关联');
  if (!['unknown', 'required', 'not-required'].includes(requirement)) throw new Error('学校提交要求无效');
  const row = normalizePortalRow(input);
  // A plain-text reimport often lacks links and other optional fields already supplied by the user.
  if (record.portal?.id === row.id) for (const key of ['url', 'externalUrl', 'location', 'term', 'requisitionId', 'deadline', 'deadlineText', 'sourceStatus']) {
    if (!row[key] && record.portal[key]) row[key] = record.portal[key];
  }
  if (records.some(j => j.key !== record.key && j.portal?.id === row.id)) throw new Error('学校职位已关联另一条申请；请先核对并解除原关联');
  if (record.portal && record.portal.id !== row.id) throw new Error('已有其他学校岗位关联；请先解除，历史将保留');
  if (record.portal?.status === 'submitted') {
    if (JSON.stringify(row) === JSON.stringify(normalizePortalRow(record.portal))) return record;
    throw new Error('学校已提交的来源快照不可覆盖；如关联有误，请解除后重新关联');
  }
  const portal = { ...row, requirement: record.portal?.requirement || requirement,
    status: record.portal?.status || 'unknown', linkedAt: record.portal?.linkedAt || now.toISOString() };
  if (record.portal && JSON.stringify(portal) === JSON.stringify(record.portal)) return record;
  return { ...record, portal, portalHistory: history(record, record.portal ? 'refresh-source' : 'link', now) };
}

export function updatePortal(record, input, now = new Date()) {
  if (!record.portal) throw new Error('请先关联学校职位');
  if (input.confirmed !== true) throw new Error('需要本人明确确认');
  if (input.action === 'unlink') return { ...record, portal: null, portalHistory: history(record, 'unlink', now) };
  if (record.portal.status === 'submitted') throw new Error('学校提交记录已冻结；如关联有误，可解除并保留历史');
  if (input.action === 'requirement') {
    if (!['unknown', 'required', 'not-required'].includes(input.requirement)) throw new Error('学校提交要求无效');
    return { ...record, portal: { ...record.portal, requirement: input.requirement }, portalHistory: history(record, 'requirement', now) };
  }
  if (input.action !== 'submitted') throw new Error('未知学校操作');
  if (record.portal.requirement !== 'required') throw new Error('请先确认此岗位需要学校提交');
  validateApplicationDate(input.date, now);
  let materials;
  if (input.materialSource === 'external') {
    if (!externalSubmitted(record)) throw new Error('官网尚未确认投递，不能引用已投材料');
    materials = structuredClone(record.externalSubmission?.materials || submissionMaterials(record));
    if (!materials.files?.resume) throw new Error('历史官网材料版本不完整，请填写实际学校材料说明');
  } else if (input.materialSource === 'reviewed') {
    materials = submissionMaterials(record);
    if (!materials.files?.resume) throw new Error('没有已审阅材料，请填写实际学校材料说明');
  } else if (input.materialSource === 'other') {
    const note = field(input.materialNote, 1000);
    if (!note) throw new Error('请说明实际向学校提交的简历版本及其他附件');
    materials = { note };
  } else throw new Error('请选择实际向学校提交的材料');
  return { ...record, portalHistory: history(record, 'submitted', now), portal: { ...record.portal, status: 'submitted',
    applicationDate: input.date, confirmedAt: now.toISOString(), receipt: field(input.receipt, 1000),
    materialSource: input.materialSource, materials } };
}
