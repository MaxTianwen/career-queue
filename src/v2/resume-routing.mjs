import { createHash } from 'node:crypto';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
// Routing is deliberately JD-based. Generic skills and titles cannot decide a template.
export function classifyResumeDuties(job = {}) {
  const jd = job.fullJd === false ? '' : String(job.jd || '');
  // Clause boundaries preserve real duties next to an excluded requirement.
  const lines = jd.split(/\n|(?<=[.!?;])\s+|\b(?:but|however)\b|\band\s+(?=you\b)/i);
  const ownEvidence = (line, match, requirement = false) => {
    const before = line.slice(0, match.index),
      after = line.slice(match.index + match[0].length);
    // A new explicit candidate subject ends an earlier third-person/negative scope.
    const scope = before.split(/\byou\s+(?:will|must|shall|are expected to)\b/i).at(-1);
    if (
      /\b(?:not responsible|not required|not expected|do not|will not|no need|no requirement)\b[^.!?;]*$/i.test(scope)
    )
      return false;
    if (/\b(?:team|professionals?|engineers?|analysts?|scientists?|developers?)\s+(?:who|that)\b[^.!?;]*$/i.test(scope))
      return false;
    if (
      /\b(?:collaborate|work(?: closely)?)\s+with\b[^.!?;]*$/i.test(scope) &&
      !/\bto\s+(?:build|develop|design|implement|analy[sz]e|maintain)\b/i.test(line)
    )
      return false;
    if (/\b(?:is|are|was|were)?\s*not\s+(?:required|preferred|expected|needed)\b/i.test(after)) return false;
    if (requirement && /\b(?:preferred|nice to have|optional|bonus|an asset)\b/i.test(line)) return false;
    return true;
  };
  const matches = (re, requirement = false) => {
    // Compile once per pattern (it was rebuilt for every line); matchAll clones it per line.
    const global = new RegExp(re.source, 'gi');
    return lines.flatMap(line =>
      [...line.matchAll(global)]
        .filter(match => ownEvidence(line, match, requirement))
        .map(match => match[0].trim().slice(0, 350))
    );
  };
  const patterns = {
    embedded:
      /\b(?:develop|design|implement|debug|test|maintain|build|port|integrate)(?:ing|s)?\b[^.!?\n]{0,75}\b(?:firmware|embedded (?:software|systems?)|RTOS|BSP|device drivers?|board support packages?)\b/i,
    cs: /\b(?:develop|design|implement|debug|test|maintain|build|deploy)(?:ing|s)?\b[^.!?\n]{0,75}\b(?:software (?:applications?|systems?)|web applications?|backend services?|front[ -]?end|REST(?:ful)? APIs?|mobile applications?|distributed systems?|cloud infrastructure)\b/i,
    data: /\b(?:analy[sz](?:e|ing)|clean(?:ing)?|visuali[sz](?:e|ing)|model(?:ing)?)\b[^.!?\n]{0,55}\b(?:data|datasets?)\b|\b(?:build|develop|maintain|design)(?:ing|s)?\b[^.!?\n]{0,75}\b(?:dashboards?|ETL pipelines?|data pipelines?|analytical reports?|statistical models?|machine learning models?)\b/i
  };
  const evidence = Object.fromEntries(Object.entries(patterns).map(([key, re]) => [key, matches(re).slice(0, 3)]));
  // Both positive domain requirements must concern the candidate; generic skills alone cannot route.
  const combined = (track, domain, requirement) => {
    const a = matches(domain, true)[0],
      b = matches(requirement, true)[0];
    if (a && b) evidence[track].push(a, b);
  };
  combined(
    'cs',
    /\b(?:code reviews?|codebase|data structures|algorithms|object[ -]oriented design|software design)\b/i,
    /\b(?:programming|C\+\+|JavaScript|Java|software development|write code|quality code)\b/i
  );
  combined(
    'embedded',
    /\b(?:firmware development|embedded software|device drivers?|kernel development|RTOS|board support packages?)\b/i,
    /\b(?:C\/C\+\+|C\+\+|microcontrollers?|computer architecture|RTOS|device drivers?)\b/i
  );
  combined(
    'data',
    /\b(?:dashboards?|statistical analysis|data visualization|business intelligence|ETL|data model(?:ing|ling))\b/i,
    /\b(?:SQL|Tableau|Power BI|statistical models?|data analysis)\b/i
  );
  const cs = evidence.cs.length || evidence.embedded.length,
    data = evidence.data.length;
  const track = cs && data ? 'mixed' : cs ? 'cs' : data ? 'data' : 'unknown';
  const category = track === 'cs' && evidence.embedded.length ? 'embedded' : track;
  return {
    track,
    category,
    label: {
      cs: 'CS / Software',
      embedded: 'Firmware / Embedded',
      data: 'Data / Analytics',
      mixed: 'CS / Data 混合',
      unknown: 'JD方向待确认'
    }[category],
    basis: 'JD职责本地规则；不由标题或Python/SQL单独判定',
    evidence,
    requiresChoice: !['cs', 'data'].includes(track)
  };
}
export function installResumeRouting(db) {
  db.exec(`
 CREATE TABLE IF NOT EXISTS resume_track_baselines(user_id TEXT NOT NULL REFERENCES users(id),track TEXT NOT NULL CHECK(track IN ('cs','data')),file_id TEXT REFERENCES files(id),PRIMARY KEY(user_id,track));
 CREATE TABLE IF NOT EXISTS job_resume_overrides(user_id TEXT NOT NULL REFERENCES users(id),job_id TEXT NOT NULL REFERENCES jobs(id),file_id TEXT NOT NULL REFERENCES files(id),PRIMARY KEY(user_id,job_id));
`);
}
export function routingBindings(store, owner) {
  return Object.fromEntries(
    store.db
      .prepare('SELECT track,file_id FROM resume_track_baselines WHERE user_id=?')
      .all(owner)
      .map(r => {
        if (!r.file_id) return [r.track, null];
        const f = store.file(owner, r.file_id);
        return [r.track, { fileId: f.id, name: f.name, fileSha: f.sha256, format: f.format }];
      })
  );
}
export function checkedOriginal(store, owner, id) {
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) fail(400, '原件编号无效');
  const file = store.file(owner, id);
  if (store.fileOrigin(owner, id).kind !== 'uploaded' || store.fileKind(owner, id).kind === 'cover')
    fail(409, '请选择本人上传的简历原件');
  const parsed = store.parsedResume(owner, id);
  if (!parsed) fail(409, '请先解析并核对这份简历');
  return parsed;
}
export function setBaseline(store, owner, track, input) {
  if (!['cs', 'data'].includes(track)) fail(400, '请选择CS或Data方向');
  if (input.fileId === null) {
    store.db
      .prepare(
        'INSERT INTO resume_track_baselines VALUES(?,?,NULL) ON CONFLICT(user_id,track) DO UPDATE SET file_id=NULL'
      )
      .run(owner, track);
    return routingBindings(store, owner);
  }
  const parsed = checkedOriginal(store, owner, input.fileId);
  if (input.confirmed !== true || input.fileSha !== parsed.fileSha || input.textHash !== parsed.textHash)
    fail(409, '请核对当前原件文字及版本后确认');
  if (store.fileKind(owner, parsed.fileId).kind === 'unknown') store.setFileKind(owner, parsed.fileId, 'resume');
  store.db
    .prepare(
      'INSERT INTO resume_track_baselines VALUES(?,?,?) ON CONFLICT(user_id,track) DO UPDATE SET file_id=excluded.file_id'
    )
    .run(owner, track, parsed.fileId);
  return routingBindings(store, owner);
}
export function setOverride(store, owner, id, input) {
  store.job(owner, id);
  if (input.fileId === null)
    store.db.prepare('DELETE FROM job_resume_overrides WHERE user_id=? AND job_id=?').run(owner, id);
  else {
    const parsed = checkedOriginal(store, owner, input.fileId);
    if (input.confirmed !== true || parsed.fileSha !== input.fileSha || parsed.textHash !== input.textHash)
      fail(409, '请确认本岗原件及其版本');
    if (store.fileKind(owner, parsed.fileId).kind === 'unknown') store.setFileKind(owner, parsed.fileId, 'resume');
    store.db
      .prepare(
        'INSERT INTO job_resume_overrides VALUES(?,?,?) ON CONFLICT(user_id,job_id) DO UPDATE SET file_id=excluded.file_id'
      )
      .run(owner, id, parsed.fileId);
  }
  return resolveResume(store, owner, store.job(owner, id)).selection;
}
// Classification reads only the JD text, so equal text gives an equal result across requests and
// accounts; only the CS/Data verdict is kept, never resume data. Bounded so it cannot grow forever.
const classified = new Map();
export function cachedClassification(job) {
  const jd = job.fullJd === false ? '' : String(job.jd || '');
  let result = classified.get(jd);
  if (!result) {
    if (classified.size >= 5000) classified.clear();
    result = classifyResumeDuties(job);
    classified.set(jd, result);
  }
  return result;
}
export function resolveResume(store, owner, job, cache = {}) {
  if (cache.owner && cache.owner !== owner) fail(403, '评分缓存账户不匹配');
  cache.owner = owner;
  const classification = cachedClassification(job, cache),
    bindings = (cache.bindings ??= routingBindings(store, owner));
  const ids = [job.id, ...(job.draftIds || [])].filter(Boolean);
  const overrides = ids
    .map(
      id =>
        store.db.prepare('SELECT file_id FROM job_resume_overrides WHERE user_id=? AND job_id=?').get(owner, id)
          ?.file_id
    )
    .filter(Boolean);
  const unique = [...new Set(overrides)];
  let fileId,
    mode,
    reason = '';
  if (unique.length > 1) {
    mode = 'unresolved';
    reason = '关联草稿的单岗原件选择不一致，请进入原岗位核对';
  } else if (unique.length === 1) {
    fileId = unique[0];
    mode = 'manual';
  } else if (Object.keys(bindings).length) {
    mode = 'automatic';
    if (classification.requiresChoice) reason = 'JD为混合或不足证据，请为本岗选择原件';
    else {
      fileId = bindings[classification.track]?.fileId;
      if (!fileId) reason = '尚未设置' + classification.track.toUpperCase() + '基准；不会借用另一方向';
    }
  } else {
    mode = 'legacy';
    if (!('legacy' in cache)) cache.legacy = store.activeResume(owner);
    fileId = cache.legacy?.fileId;
    reason = fileId
      ? '旧版单简历兼容模式：所有岗位使用明确启用的同一原件；请分别设置CS/Data基准'
      : '请在我的文件分别设置CS/Data基准，或为本岗选择原件';
  }
  let resume = null;
  cache.parsed ??= new Map();
  if (fileId)
    try {
      if (!cache.parsed.has(fileId))
        cache.parsed.set(fileId, cache.legacy?.fileId === fileId ? cache.legacy : store.parsedResume(owner, fileId));
      resume = cache.parsed.get(fileId);
    } catch {
      reason = '所选原件不可用，请重新指定';
    }
  const selection = {
    classification,
    mode,
    track:
      mode === 'manual'
        ? Object.entries(bindings).find(([, f]) => f?.fileId === fileId)?.[0] || 'manual'
        : classification.track,
    ready: !!resume,
    reason,
    file: resume
      ? { fileId: resume.fileId, name: resume.name, fileSha: resume.fileSha, textHash: resume.textHash }
      : null
  };
  selection.fingerprint = hash({
    mode,
    track: selection.track,
    file: selection.file,
    jd: job.jd || '',
    classification
  });
  return { resume, selection };
}
