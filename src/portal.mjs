import { placementOptions, placementTermText } from '../web/placement-options.js';
import { createHash } from 'node:crypto';
import { canonicalUrl, validateApplicationDate, submissionMaterials, evaluateJob } from './core.mjs';
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
  for(const key of ['duration','jd','applicationInstructions'])if(input[key])row[key]=field(input[key],key==='jd'?60000:2000);
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
  const schoolOnlyCompleted = portal?.channel === 'school-only' && portal.status === 'submitted';
  const category = !portal ? 'unlinked' : portal.status === 'submitted' ? 'submitted'
    : portal.requirement === 'not-required' ? 'not-required' : expired ? 'expired'
      : portal.requirement !== 'required' ? 'unknown' : submitted || portal.channel === 'school-only' ? 'pending' : 'external-pending';
  return { category, schoolOnlyCompleted, externalSubmitted: submitted, schoolExpired: expired, employerDeadline: record.deadline || null,
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
  const placement = placementOptions(job);
  const terms = placement?.status === 'confirmed' ? placement.terms : job.term === 'Summer/Fall 2027' ? ['Summer 2027', 'Fall 2027'] : known(job.term) ? [job.term] : [];
  if (placement && placement.status !== 'confirmed') conflicts.push(placement.reason);
  if (known(row.term) && terms.length && !terms.some(term => norm(row.term) === norm(term))) conflicts.push('入职批次不同');
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
        return { key: j.key, company: j.company, title: j.title, location: j.location, term: j.term, termLabel: placementTermText(j), status: j.status,
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

// Discovery suggestions are read-only; they never become an application match.
export function portalDiscovery(row, report, now = new Date()) {
  if (!report?.finishedAt) return { status: 'not-searched', message: '尚无已完成的搜索结果，请先运行自动发现。', candidates: [] };
  // A display group can contain different requisitions; adopt the matching
  // source's URL, never silently substitute the group's primary posting.
  const discovered = (report.results || []).flatMap(job => job.groupedSources?.length ? job.groupedSources.map(source => {
    const item = { ...job, ...source, groupedSources: [], fullJd: Boolean(source.jd) };
    return { ...item, ...evaluateJob(item, now) };
  }) : [job]);
  const discoveredUrls = new Set(discovered.map(j => j.url));
  const jobs = [...discovered, ...(report.filteredJobs || []).filter(j => !discoveredUrls.has(j.url)).map(j => ({ ...j, prefiltered: true }))];
  const company = norm(row.company);
  const title = norm(row.title), words = new Set(title.split(' ').filter(Boolean));
  const titleSimilarity = candidate => {
    const other = new Set(norm(candidate.title).split(' ').filter(Boolean));
    return words.size && other.size ? [...words].filter(word => other.has(word)).length / Math.max(words.size, other.size) : 0;
  };
  const candidates = jobs.filter(job => {
    if (norm(job.company) === company) return true;
    if (!row.externalUrl) return false;
    try { return canonicalUrl(job.url) === row.externalUrl; } catch { return false; }
  }).map(job => {
    const match = evidence(row, job);
    return { key: job.key, title: job.title, company: job.company, url: job.url, term: job.term, termLabel: placementTermText(job), location: job.location,
      requisitionId: job.requisitionId, ...match,
      rankingReason: match.reasons.includes('公司与雇主招聘编号一致') ? '招聘编号一致，仍需核对'
        : match.reasons.includes('外部职位链接一致') ? '官网链接一致，仍需核对'
          : title === norm(job.title) ? '标题一致，仅供核对' : '标题相近，仅供核对',
      stateCode: job.prefiltered ? 'prefiltered' : deadlineExpired(job.deadline, now) ? 'expired' : job.decision === 'REJECT' ? 'excluded' : !job.fullJd ? 'incomplete' : 'found',
      state: job.prefiltered ? '搜索预筛排除，尚未读取正文' : deadlineExpired(job.deadline, now) ? '官网截止已过，默认隐藏' : job.decision === 'REJECT' ? '未通过当前岗位条件' : !job.fullJd ? '已发现，正文待补齐' : '已发现，可在自动发现中查看',
      detail: job.fetchError || (job.prefiltered || job.decision === 'REJECT' ? (job.reasons || []).join('；') : '') };
  }).filter(c => c.reasons.length).sort((a, b) => Number(b.strong) - Number(a.strong)
    || Number(Boolean(row.requisitionId) && norm(b.requisitionId) === norm(row.requisitionId)) - Number(Boolean(row.requisitionId) && norm(a.requisitionId) === norm(row.requisitionId))
    || Number(b.reasons.includes('外部职位链接一致')) - Number(a.reasons.includes('外部职位链接一致'))
    || Number(norm(b.title) === title) - Number(norm(a.title) === title)
    || titleSimilarity(b) - titleSimilarity(a)
    || norm(a.title).localeCompare(norm(b.title), 'en')
    || String(a.requisitionId || '').localeCompare(String(b.requisitionId || ''), 'en')
    || a.url.localeCompare(b.url, 'en'));
  const source = (report.sources || []).find(s => norm(s.name) === norm(row.company));
  return { searchedAt: report.finishedAt, total: candidates.length, candidates,
    status: candidates.length ? 'candidates' : source ? source.status === 'complete' ? 'not-found' : 'source-incomplete' : 'source-uncovered',
    message: candidates.length ? `最近搜索中找到 ${candidates.length} 条来源候选；请核对编号、批次与地点，列表显示仍受当前筛选影响。`
      : source?.status !== 'complete' && source ? '本次雇主来源读取不完整，暂不能判断是否漏岗。'
        : source ? '最近搜索未找到对应岗位；可能不在本次列表或筛选范围内，不能据此判断岗位已关闭。'
          : '最近搜索未找到对应岗位，且尚未接入此雇主的主动发现列表；公共索引覆盖不全。' };
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
  const portal = { ...record.portal, ...row, requirement: record.portal?.requirement || requirement,
    status: record.portal?.status || 'unknown', linkedAt: record.portal?.linkedAt || now.toISOString() };
  if (record.portal && JSON.stringify(portal) === JSON.stringify(record.portal)) return record;
  return { ...record, portal, portalHistory: history(record, record.portal ? 'refresh-source' : 'link', now) };
}

export function updatePortal(record, input, now = new Date()) {
  if (!record.portal) throw new Error('请先关联学校职位');
  if (input.confirmed !== true) throw new Error('需要本人明确确认');
  if (input.action === 'unlink') return { ...record, portal: null, portalHistory: history(record, 'unlink', now) };
  if (record.portal.status === 'submitted') throw new Error('学校提交记录已冻结；如关联有误，可解除并保留历史');
  if (input.action === 'channel') {
    if (!['unknown', 'both', 'school-only'].includes(input.channel)) throw new Error('申请渠道无效');
    if (record.portal.channel === input.channel) return record;
    return { ...record, portal: { ...record.portal, channel: input.channel,
      requirement: input.channel === 'unknown' ? 'unknown' : 'required' }, portalHistory: history(record, 'channel', now) };
  }
  if (input.action === 'requirement') {
    if (!['unknown', 'required', 'not-required'].includes(input.requirement)) throw new Error('学校提交要求无效');
    return { ...record, portal: { ...record.portal, requirement: input.requirement,
      ...(input.requirement !== 'required' ? { channel: 'unknown' } : {}) }, portalHistory: history(record, 'requirement', now) };
  }
  if (input.action !== 'submitted') throw new Error('未知学校操作');
  if (record.portal.requirement !== 'required') throw new Error('请先确认此岗位需要学校提交');
  if (input.attachmentsConfirmed !== true) throw new Error('请确认学校要求的全部附件已实际上传');
  if (!['both', 'school-only'].includes(record.portal.channel)) throw new Error('请先确认申请渠道，缺少官网链接不代表仅学校提交');
  validateApplicationDate(input.date, now);
  let materials;
  if (input.materialSource === 'school-reviewed') {
    const prepared = record.portal.preparedMaterials;
    if (!prepared?.files?.resume || input.preparedVersion !== prepared.version?.version || input.resumeHash !== prepared.version?.sha256) throw new Error('学校材料已变化，请重新核对实际提交版本');
    materials = structuredClone(prepared);
  } else if (input.materialSource === 'external') {
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
    materialSource: input.materialSource, materials, attachmentsConfirmedAt: now.toISOString(), attachmentNote: field(input.materialNote, 1000) } };
}

export function prepareSchoolMaterials(record, materials, now = new Date()) {
  if (!record.portal || !['both', 'school-only'].includes(record.portal.channel)) throw new Error('请先确认申请渠道');
  if (record.portal.status === 'submitted') throw new Error('学校提交记录已冻结，不能替换材料');
  if (record.portal.preparedMaterials?.version?.version === materials.version.version
      && record.portal.preparedMaterials.version.sha256 === materials.version.sha256
      && record.portal.preparedMaterials.inputHash === materials.inputHash
      && record.portal.preparedMaterials.version.assessment?.id === materials.version.assessment?.id) return record;
  return { ...record, portal: { ...record.portal, preparedMaterials: structuredClone(materials) },
    portalHistory: history(record, 'materials', now) };
}
