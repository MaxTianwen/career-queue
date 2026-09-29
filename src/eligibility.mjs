import { createHash } from 'node:crypto';
import { extractDeadline } from './deadlines.mjs';

export const ELIGIBILITY_VERSION = 'eligibility-v1';
const hash = value => createHash('sha256').update(value).digest('hex');
export function eligibilityJdHash(job) {
  const input = { ...job, ...extractDeadline(job) };
  return hash(JSON.stringify(Object.fromEntries(['jd', 'title', 'company', 'term', 'location', 'url', 'deadline']
    .map(key => [key, String(input[key] || '')]).concat([['fullJd', input.fullJd !== false]]))));
}

const required = /\b(?:must|required|mandatory|essential|minimum|need to|have to)\b|必须|必需|必要条件/i;
const preferred = /\b(?:preferred|preferably|desirable|bonus|asset|nice.to.have|a plus)\b|加分|优先/i;
const waived = /\b(?:not\s+(?:strictly\s+)?(?:required|mandatory|necessary)|no\b[^.;]*\b(?:required|necessary)|optional)\b|不要求|非必需/i;
const personalFact = /\b(?:degree|bachelor|master|ph\.?d|diploma|enroll\w*|student|graduat\w*|citizen\w*|visa|sponsor\w*|permit|authori[sz]\w*|eligible to work|legally\s+(?:able|entitled)|clearance|\d+\+?\s*(?:years?|yrs?))\b|学历|学籍|工作资格|年经验/i;
const returnToSchool = /\breturn(?:ing)?\s+(?:back\s+)?to\s+(?:(?:full[- ]time|academic)\s+)?(?:school|studies|university|college|education)\b|\breturn(?:ing)?\b[^.;]*\b(?:academic term|semester)\b|\breturn(?:ing)?\s+(?:after|following)\s+(?:(?:the|this|an?)\s+)?(?:internship|placement|work term)\b|返校/i;
const strongClaim = /\b(?:proficien\w*|expert\w*|advanced|strong|excellent|fluent|proven|demonstrat\w*|extensive|professional|production)\b|熟练|精通/i;
const negation = /\b(?:no|not|without|never)\b|没有|未掌握|无经验/i;

export function excludeReturnArrangements(quote) {
  if (!returnToSchool.test(quote)) return [quote];
  return quote.split(/\s+(?:and|but)\s+|,\s*/i).filter(part => !returnToSchool.test(part));
}

function heading(text) {
  const value = text.replace(/^[#*\s]+|[:：*\s]+$/g, '').toLowerCase();
  if (/^(?:preferred|desired|additional|bonus)(?: qualifications| requirements| skills)?$|^nice.to.have$|^加分项$/.test(value)) return 'preferred';
  if (/^(?:minimum|required|basic|essential)(?: qualifications| requirements| skills)?$|^requirements$|^must.haves?$|^what you (?:need|must have)$|^必需条件$/.test(value)) return 'required';
  if (/^(?:qualifications|skills|about you|who you are|what you bring|what we(?:'re| are) looking for|your qualifications)$/.test(value)) return 'unspecified';
  if (/^(?:responsibilities|what you(?:'ll| will) do|what we offer|benefits|compensation|about us|about the (?:company|team)|equal opportunity)\b/.test(value)) return 'stop';
  return null;
}

function clauses(jd) {
  const result = [], seen = new Set();
  let section = null;
  for (const line of jd.split(/\r?\n/)) {
    const clean = line.trim().replace(/^(?:[-*•]\s+|\d+[.)]\s+)/, '');
    if (!clean) continue;
    const h = heading(clean);
    if (h) { section = h; continue; }
    const inline = clean.match(/^([^:：]{1,45})[:：]\s*(\S.*)$/);
    const inlineKind = inline && heading(inline[1]);
    const context = inlineKind && inlineKind !== 'stop' ? inlineKind : section;
    const sentences = clean.split(/(?<=[.!?;；])\s+(?=[A-Z\d•*-])/);
    // Exclude return arrangements, retaining separable enrollment/skill conditions in the same sentence.
    const parts = sentences.flatMap(excludeReturnArrangements);
    for (const quote of parts.map(x => x.trim()).filter(Boolean)) {
      if (context === 'stop' || returnToSchool.test(quote) || seen.has(quote) || !(context || required.test(quote) || preferred.test(quote))) continue;
      seen.add(quote);
      const isWaived = waived.test(quote), hasRequired = required.test(quote) && !isWaived, hasPreferred = preferred.test(quote);
      const mixed = hasRequired && hasPreferred;
      const kind = mixed ? 'unspecified' : hasPreferred ? 'preferred' : isWaived ? 'unspecified' : hasRequired ? 'required' : context || 'unspecified';
      result.push({ quote, kind, mixed, waived: isWaived, inlineLabel: inlineKind ? inline[1] : '' });
    }
  }
  return result;
}

function technicalMatches(quote, profile) {
  const hits = (profile?.technical || []).flatMap(row => {
    const match = quote.match(new RegExp(row.pattern.source, row.pattern.flags.replace(/[gy]/g, '')));
    return match ? [{ ...row, start: match.index, end: match.index + match[0].length }] : [];
  }).sort((a, b) => (b.end - b.start) - (a.end - a.start));
  const distinct = [];
  for (const row of hits) if (!distinct.some(x => row.start < x.end && x.start < row.end)) distinct.push(row);
  return distinct.sort((a, b) => a.start - b.start);
}

function evaluate(clause, profile, resumeAvailable) {
  const { quote } = clause, skills = technicalMatches(quote, profile);
  const evidence = skills.filter(x => resumeAvailable && x.level > 0 && x.evidence && !negation.test(x.evidence))
    .map(x => ({ name: x.name, quote: x.evidence, level: x.level }));
  const any = /\bor\b|\b(?:at least )?one of\b|任选|之一/i.test(quote);
  const all = /\band\b|以及|并且/i.test(quote);
  let residue = quote;
  for (const skill of [...skills].reverse()) residue = residue.slice(0, skill.start) + ' @ ' + residue.slice(skill.end);
  if (clause.inlineLabel) residue = residue.replace(new RegExp(`^${clause.inlineLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[:：]\\s*`, 'i'), '');
  residue = residue.replace(/\b(?:must\s+have|is|are|have|be|required|preferred|mandatory|essential|a\s+plus|an?\s+asset|knowledge|experience|familiarity|working|practical|hands.on|prior|with|of|in|using|and|or|either|at\s+least|one)\b/gi, '')
    .replace(/[@\s,.:;()\[\]•*-]/g, '');
  const mode = (any && all || /\//.test(residue) || any && skills.length < 2) ? 'complex' : any ? 'any' : 'all';
  const result = { mode, evidence, skills: skills.map(x => x.name) };
  if (clause.waived || negation.test(quote)) return { ...result, status: 'unknown', reason: '原文含否定或豁免表述，保留原文供核实，不按关键词判定满足。' };
  if (clause.mixed || mode === 'complex') return { ...result, status: 'unknown', reason: '必需、加分或任选关系较复杂，需要按原文核实。' };
  if (personalFact.test(quote)) return { ...result, status: 'unknown', reason: '学历、学籍、年限或工作资格需本人确认；技能提及不能证明这些条件。' };
  if (!resumeAvailable) return { ...result, status: 'unknown', reason: '当前简历不可读取，不使用历史知识库作资格证据。' };
  if (!skills.length || residue || strongClaim.test(quote)) return { ...result, status: evidence.length ? 'partial' : 'unknown', reason: '规则仅识别部分文字，技能提及不足以证明完整要求；请核对原文。' };
  const levels = skills.map(x => evidence.find(e => e.name === x.name)?.level || 0), covered = mode === 'any' ? Math.max(...levels) : Math.min(...levels);
  if (covered >= 1) return { ...result, status: 'met', reason: mode === 'any' ? '当前简历体现至少一项可选技能；只说明文字证据覆盖。' : '当前简历体现这些技能；只说明文字证据覆盖，不证明熟练度。' };
  if (levels.some(x => x > 0)) return { ...result, status: 'partial', reason: '当前简历仅部分体现，或标为基础接触；完整要求仍需核实。' };
  return { ...result, status: 'not-demonstrated', reason: '当前简历未体现这些技能，不代表本人不会或不符合资格。' };
}

export function assessEligibility(job, profile, confirmations = [], now = new Date()) {
  const jdHash = eligibilityJdHash(job), available = Boolean(job.jd?.trim() && job.fullJd !== false);
  const resumeAvailable = Boolean(profile?.available && profile?.fromResume);
  const requirements = (available ? clauses(job.jd) : []).map(clause => {
    const id = hash(`${clause.kind}\n${clause.quote}`).slice(0, 20);
    const requirement = { id, kind: clause.kind, quote: clause.quote, ...evaluate(clause, profile, resumeAvailable) };
    const confirmation = (Array.isArray(confirmations) ? confirmations : []).findLast(x => x.requirementId === id && x.jdHash === jdHash
      && ['met', 'conflict', 'unknown'].includes(x.outcome) && typeof x.note === 'string' && x.note.trim()
      && Number.isFinite(Date.parse(x.confirmedAt)) && Date.parse(x.confirmedAt) <= now.getTime());
    if (confirmation) Object.assign(requirement, { status: confirmation.outcome,
      confirmation: { outcome: confirmation.outcome, note: confirmation.note, confirmedAt: confirmation.confirmedAt },
      reason: '依据本人对当前岗位要求的确认；不会改变 Match Score。' });
    return requirement;
  });
  const count = items => Object.fromEntries(['met', 'partial', 'not-demonstrated', 'unknown', 'conflict'].map(status => [status, items.filter(x => x.status === status).length]));
  const hardConflict = requirements.some(x => x.kind === 'required' && x.status === 'conflict' && x.confirmation);
  const qualifying = requirements.filter(x => x.kind !== 'preferred');
  const needsReview = !qualifying.length || qualifying.some(x => x.status !== 'met');
  return { version: ELIGIBILITY_VERSION, jdHash, assessedAt: now.toISOString(), available, resumeAvailable, source: profile?.source || null,
    summary: { status: hardConflict ? 'conflict' : needsReview ? 'unknown' : 'evidence-covered', hardConflict,
      label: hardConflict ? '已确认必需条件冲突' : needsReview ? '资格待核实' : '已识别要求有依据，仍需核实完整 JD',
      counts: count(requirements), required: count(requirements.filter(x => x.kind === 'required')), preferred: count(requirements.filter(x => x.kind === 'preferred')) },
    requirements, note: '本地规则仅对照已识别的要求；未识别或含糊表述不代表满足。简历未写不代表没有能力；Match Score 保持独立。' };
}
