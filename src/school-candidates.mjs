import { createHash } from 'node:crypto';
import { newRecord, normalizeJob, evaluateJob } from './core.mjs';
import { normalizePortalRow, linkPortal, portalRevision, updatePortal } from './portal.mjs';
import { extractFacts } from './discovery.mjs';
import { postingUrl } from './discovery-records.mjs';
import { jobInputHash } from './assessment.mjs';

export const schoolRevision = record => createHash('sha256').update(JSON.stringify([portalRevision(record), jobInputHash(record),
  record.notes, record.nextStep, record.schoolCandidate, record.fullJd, record.schoolAssociationTransfer, record.transferredTo])).digest('hex');
const norm = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
const hasMaterials = job => Boolean(job.materialVersion || Object.keys(job.materials || {}).length || job.attachments?.length);

export function schoolAssociation(record, url, records) {
  if (!url) return null;
  const matches = records.filter(j => j.key !== record.key && j.url && postingUrl(j.url) === postingUrl(url));
  if (!matches.length) return null;
  if (matches.length > 1) throw new Error('同一官网链接有多条申请，请先核对，暂不能迁移');
  const target = matches[0], conflicts = [];
  if (!(record.schoolCandidate && record.fullJd === false || record.jdSource === 'school' && !record.url) || record.status !== 'Queue' || !record.portal) conflicts.push('原记录已不是待补正文的学校候选');
  if (record.applicationDate || hasMaterials(record) || record.portal?.status === 'submitted') conflicts.push('原候选已有材料或提交记录，暂停迁移');
  if (target.schoolCandidate || target.fullJd === false || target.status === '已归档') conflicts.push('目标不是可关联的完整职位');
  if (norm(record.company) !== norm(target.company)) conflicts.push('公司不同');
  if (record.term && target.term && record.term !== 'Unknown' && target.term !== 'Unknown' && norm(record.term) !== norm(target.term)) conflicts.push('入职批次不同');
  const sourceId = record.portal?.requisitionId || record.requisitionId;
  if (sourceId && target.requisitionId && norm(sourceId) !== norm(target.requisitionId)) conflicts.push('招聘编号不同');
  const resumed = target.schoolAssociationTransfer?.sourceKey === record.key && target.portal?.id === record.portal?.id;
  if (target.portal && !resumed) conflicts.push(target.portal.status === 'submitted' ? '目标学校记录已提交' : '目标已有学校关联');
  if (target.portal?.status === 'submitted') conflicts.push('学校已提交，暂停迁移');
  if (records.some(j => j.key !== record.key && j.key !== target.key && j.portal?.id === record.portal?.id)) conflicts.push('学校 ID 已关联其他申请');
  const brief = j => ({ key: j.key, company: j.company, title: j.title, term: j.term, location: j.location, status: j.status,
    schoolId: j.portal?.id || '', revision: schoolRevision(j), notes: j.notes || '', hasMaterials: hasMaterials(j) });
  return { source: brief(record), target: brief(target), url: target.url, conflicts, resumed };
}

// Target first: a failed second write leaves the school link recoverable on both
// records. The receipt makes retries idempotent; no records or history are deleted.
export async function transferSchoolAssociation(store, key, input, now = new Date()) {
  if (input.confirmed !== true) throw new Error('请核对两条记录并确认迁移学校关联');
  const records = await store.list(), source = records.find(j => j.key === key), target = records.find(j => j.key === input.targetKey);
  if (!source || !target) throw new Error('关联记录不存在，请重新打开');
  if (source.transferredTo === target.key && source.status === '已归档' && target.schoolAssociationTransfer?.sourceKey === key) return { targetKey: target.key };
  const preview = schoolAssociation(source, target.url, records);
  if (!preview || preview.conflicts.length) throw new Error(preview?.conflicts.join('；') || '岗位关联已变化');
  if (input.sourceRevision !== schoolRevision(source)) throw new Error('原候选已变化，请重新预览后确认');
  if (!preview.resumed && input.targetRevision !== schoolRevision(target)) throw new Error('目标申请已变化，请重新预览后确认');
  if (preview.resumed && (JSON.stringify(target.schoolAssociationTransfer.portal) !== JSON.stringify(source.portal)
    || JSON.stringify(target.schoolAssociationTransfer.linkedPortal) !== JSON.stringify(target.portal))) throw new Error('迁移中学校信息已变化，请核对保留的两条记录');
  // Validate both history limits before the first write.
  const archived = { ...updatePortal(source, { action: 'unlink', confirmed: true }, now), status: '已归档',
    transferredTo: target.key, nextStep: '学校关联已迁移至已有职位；原备注与历史保留' };
  if (!preview.resumed) {
    const linked = linkPortal(target, { ...source.portal, externalUrl: target.url }, records.filter(j => j.key !== key),
      { confirmed: true, requirement: source.portal.requirement }, now);
    await store.updateState({ ...linked,
      schoolAssociationHistory: [...(target.schoolAssociationHistory || []), ...(target.schoolAssociationTransfer ? [target.schoolAssociationTransfer] : [])],
      schoolAssociationTransfer: { sourceKey: key, sourceRevision: input.sourceRevision,
      at: now.toISOString(), portal: structuredClone(source.portal), linkedPortal: structuredClone(linked.portal) } });
  }
  try { await store.updateState(archived); }
  catch { throw new Error('已有职位已保存学校关联，原候选暂未归档；请重试此操作完成收尾，不要手动解除关联'); }
  return { targetKey: target.key };
}

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
  const school = details.jdSource === 'school';
  if (!(record.schoolCandidate && record.fullJd === false || !school && record.jdSource === 'school' && !record.url) || record.status !== 'Queue' || !record.portal?.id) throw new Error('仅待补 JD 的学校候选或待补官网链接的学校正文可以补齐');
  if (school && details.url) throw new Error('学校来源正文请勿混填官网链接');
  const source = { company: record.company, title: record.title, term: record.term, location: record.location,
    ...details, jdSource: school ? 'school' : details.sourceEvidence ? 'official' : 'manual', fullJd: true };
  const facts = extractFacts(source);
  const job = normalizeJob({ ...source, ...facts, term: facts.term === 'Unknown' ? record.term : facts.term }, school ? { schoolId: record.portal.id } : {});
  if (school) Object.assign(job, { deadline: null, deadlineEvidence: null, postedAt: null, requisitionId: null });
  if (records.some(j => j.key !== record.key && (j.key === job.key || job.url && j.url === job.url))) {
    throw new Error('此官网职位已在 Queue 中。请先解除此候选的学校关联，再将学校 ID 关联已有申请，并归档此候选');
  }
  // Keep application identity and all user-owned state. School dates remain in portal only.
  return { ...record, ...job, ...evaluateJob(job), key: record.key, schoolCandidate: false, fullJd: true,
    ...(school ? { schoolJd: { text: job.jd, schoolId: record.portal.id, recordedAt: new Date().toISOString() } } : {}),
    sourceEvidence: school ? { note: '本人复制并核对的学校 JD；未核实官网开放状态', schoolId: record.portal.id, retrievedAt: new Date().toISOString() } : details.sourceEvidence || { note: '本人补充并核对的 JD', retrievedAt: new Date().toISOString() },
    availability: undefined, eligibilityConfirmations: [], nextStep: record.nextStep === '补齐官网链接与完整 JD' ? '人工查看后指定处理' : record.nextStep };
}
