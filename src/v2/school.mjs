import { createHash } from 'node:crypto';
import { parsePortalPaste } from '../portal-paste.mjs';
import { previewPortal } from '../portal.mjs';
import { deadlineExpired } from '../deadlines.mjs';
import { recommend } from './catalogue.mjs';

export const schoolHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function previewSchool(text, { jobs, links, catalogue, preferences, now }) {
  let parsed;
  try { parsed = parsePortalPaste(text); } catch (error) { throw Object.assign(error, { status: 400 }); }
  const visible = new Set(recommend(catalogue.jobs, preferences, null, now).map(job => job.id));
  const records = jobs.map(job => {
    const publicJob = catalogue.jobs.find(item => item.url === job.url);
    const school = links.find(link => link.jobId === job.id);
    return { ...publicJob, ...job, key: `saved:${job.id}`, portal: school ? { id: school.row.id } : null };
  });
  for (const job of catalogue.jobs) if (!jobs.some(saved => saved.url === job.url)) records.push({ ...job, key: `catalogue:${job.id}` });
  const rows = previewPortal(parsed.rows, records).map(item => {
    if (!item.row) return item;
    const row = item.row;
    try {
      for (const key of ['company', 'title', 'location']) if (row[key].length > 200) throw new Error(`${key} 超过 200 字，请核对原列表`);
      for (const key of ['url', 'externalUrl']) if (row[key]) {
        const url = new URL(row[key]);
        if (url.protocol !== 'https:' || url.username || url.password) throw new Error('学校链接必须为无账号信息的 HTTPS 地址');
      }
    } catch (error) { return { index: item.index, category: 'invalid', error: error.message, candidates: [] }; }
    const linked = links.find(link => link.row.id === row.id);
    const candidates = item.candidates.map(candidate => {
      const job = records.find(record => record.key === candidate.key);
      const publicJob = catalogue.jobs.find(item => item.url === job.url);
      return { ...candidate, target: candidate.key, kind: candidate.key.startsWith('saved:') ? 'saved' : 'catalogue',
        employerSubmitted: Boolean(job.submissions?.some(record => record.channel === 'employer')),
        schoolSubmitted: Boolean(job.submissions?.some(record => record.channel === 'school')),
        url: job.url, requisitionId: job.requisitionId || '',
        sourceNote: publicJob ? `${publicJob.stale ? '上次公开结果，本次未确认' : '公开来源'}${visible.has(publicJob.id) ? '' : ' · 当前偏好或截止筛选未显示'}` : '本人已保存职位' };
    }).sort((a, b) => Number(b.strong) - Number(a.strong) || Number(b.kind === 'saved') - Number(a.kind === 'saved') || a.conflicts.length - b.conflicts.length);
    return { index: item.index, row, category: linked ? 'linked' : candidates.length ? 'candidates' : 'unmatched', candidates,
      linked: linked || null, sourceChanged: Boolean(linked && schoolHash(linked.row) !== schoolHash({ ...row, url: row.url || linked.row.url, externalUrl: row.externalUrl || linked.row.externalUrl })),
      expired: deadlineExpired(row.deadline, now), relatedSchoolIds: item.relatedSchoolIds,
      warning: parsed.rows[item.index].parseWarning || '' };
  });
  const warnings = parsed.warnings.map(message => message.replace('关联后可补充链接。', '没有链接时仍可保存学校候选。'));
  return { rows, warnings, errors: parsed.errors, parsedCount: parsed.parsedCount, reportedTotal: parsed.reportedTotal,
    searchedAt: catalogue.finishedAt, sources: catalogue.sources,
    fingerprint: schoolHash({ rows, jobs, links, catalogue, preferences }) };
}
