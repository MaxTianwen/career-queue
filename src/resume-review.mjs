import { createHash } from 'node:crypto';
import { jobInputHash } from './assessment.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const tokens = text => new Set((String(text).toLowerCase().match(/[a-z][a-z0-9+#.-]*/g) || []).filter(t => t.length > 2 && !/^(the|and|for|with|from|this|that|our|your|will|have|using|used|built|developed)$/.test(t)));

function relatedRequirements(text, jd) {
  const words = tokens(text);
  return String(jd).split(/\r?\n/).map((quote, index) => ({ quote: quote.trim(), line: index + 1,
    overlap: [...tokens(quote)].filter(word => words.has(word)).length }))
    .filter(row => row.quote && row.overlap).sort((a, b) => b.overlap - a.overlap || a.line - b.line).slice(0, 3)
    .map(({ quote, line }) => ({ quote, line }));
}

// Only verbatim moves inside an approved, same-style experience group are suggested.
// Keeping the whole group atomic prevents half a swap duplicating/removing a bullet.
export function buildReviewDraft(job, base, plan) {
  const groups = [];
  for (const [index, paragraphs] of (base.groups || []).entries()) {
    const edits = plan.edits.filter(e => paragraphs.includes(e.paragraph));
    if (!edits.length) continue;
    const slots = paragraphs.map(p => base.slots.find(s => s.paragraph === p));
    if (slots.some(s => !s)) throw new Error('基准正文位置缺失，停止准备建议');
    const before = slots.map(s => s.original).sort();
    const after = slots.map(s => edits.find(e => e.paragraph === s.paragraph)?.text ?? s.original).sort();
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('建议包含原文之外的内容或跨经历移动，已拦截');
    const rows = edits.map(edit => {
      const slot = slots.find(s => s.paragraph === edit.paragraph);
      const support = slots.find(s => s.original === edit.text);
      if (slot.original !== edit.original || !support) throw new Error('建议与基准原文不符，已拦截');
      return { paragraph: edit.paragraph, label: slot.label, original: edit.original, proposed: edit.text,
        evidence: { paragraph: support.paragraph, quote: support.original, version: plan.baseline.version, sha256: base.sha256 },
        requirements: relatedRequirements(edit.text, job.jd) };
    });
    groups.push({ id: `group-${index}`, kind: 'reorder', label: `同一经历内的要点顺序 · ${index + 1}`, rows });
  }
  if (groups.reduce((n, g) => n + g.rows.length, 0) !== plan.edits.length) throw new Error('包含未授权正文位置，已拦截');
  const input = { jobKey: job.key, jdHash: jobInputHash(job), assessmentId: plan.assessment.id,
    baselineVersion: plan.baseline.version, baselineSha256: base.sha256, baselinePdfSha256: base.pdfSha256, track: plan.track, groups };
  return { fingerprint: digest(input), ...input, baseline: plan.baseline, groups,
    engine: '本地原文重排，无模型 / 语义改写',
    note: '关键词对应只解释排序，不证明资格满足。每组一起应用或保留原文；未经接受的内容不会进入新稿。', plan };
}

export function publicReviewDraft(draft) {
  const { plan, ...view } = draft;
  return view;
}

export function reviewedPlan(draft, fresh, input, now = new Date()) {
  if (draft.fingerprint !== fresh.fingerprint) throw new Error('JD、简历基准或核实记录已变化，请重新准备修改对照');
  if (input.confirmed !== true) throw new Error('请先确认已审阅逐句对照');
  if (!Array.isArray(input.decisions) || input.decisions.length !== draft.groups.length) throw new Error('请为每一组选择应用或保留原文');
  const choices = new Map();
  for (const d of input.decisions) {
    if (!d || !draft.groups.some(g => g.id === d.id) || choices.has(d.id) || typeof d.accepted !== 'boolean') throw new Error('审阅选择无效或重复');
    choices.set(d.id, d.accepted);
  }
  const accepted = new Set(draft.groups.filter(g => choices.get(g.id)).flatMap(g => g.rows.map(r => r.paragraph)));
  return { ...fresh.plan, edits: fresh.plan.edits.filter(e => accepted.has(e.paragraph)),
    review: { schemaVersion: 1, type: 'reviewed-reorder', fingerprint: fresh.fingerprint, jdHash: fresh.jdHash,
      baseline: fresh.baseline, baselineSha256: fresh.baselineSha256, track: fresh.track, reviewedAt: now.toISOString(),
      groups: fresh.groups.map(g => ({ ...g, accepted: choices.get(g.id) })),
      note: '本人确认的是本次原文重排选择；不是事实自动核验、语义改写或最终投递审阅。' } };
}

export function manualReview(source, edits, version, fields = []) {
  return { schemaVersion: 1, type: 'manual-edit', parentVersion: version, baseline: source.baseline,
    jdHash: source.assessment?.jdHash || null, createdAt: new Date().toISOString(),
    rows: edits.map(e => ({ paragraph: e.paragraph, original: fields.find(f => f.paragraph === e.paragraph)?.text ?? e.original, proposed: e.text,
      evidence: null, status: '用户输入，事实与语义未自动核实' })),
    note: '手动修改不继承自动重排的事实保证；仍需本人重新核对，并预览最终 PDF。' };
}
