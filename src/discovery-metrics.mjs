import { durationRange, publication, workModes } from '../web/job-facts.js';

export function discoveryMetrics(sources, raw, results, dedup) {
  const has = (job, id) => job.discoverySources?.some(s => s.id === id);
  const baselineComplete = sources.find(s => s.id === 'index')?.status === 'complete';
  const incremental = results.filter(j => !has(j, 'index') && !j.identityConflict && j.decision !== 'REJECT');
  const bySource = sources.map(source => {
    const candidates = raw.filter(j => has(j, source.id));
    const independent = results.filter(j => has(j, source.id));
    const additions = incremental.filter(j => has(j, source.id));
    return { id: source.id, name: source.name, independent: independent.length,
      incremental: baselineComplete ? additions.filter(j => j.decision === 'PASS').length : null,
      pending: baselineComplete ? additions.filter(j => j.decision === 'REVIEW').length : null,
      shared: independent.filter(j => j.discoverySources.length > 1).length,
      inline: candidates.filter(j => j.readMethod === 'inline').length,
      attempted: candidates.filter(j => ['detail', 'failed'].includes(j.readMethod)).length,
      succeeded: candidates.filter(j => j.readMethod === 'detail' && j.fullJd).length,
      failed: candidates.filter(j => j.readMethod === 'failed').length,
      unsupported: candidates.filter(j => j.readMethod === 'unsupported').length,
      fields: { denominator: independent.length,
        published: independent.filter(j => publication(j).at).length,
        deadline: independent.filter(j => j.deadline).length,
        salary: independent.filter(j => j.salary && j.salary !== '未披露').length,
        duration: independent.filter(j => durationRange(j)).length,
        workMode: independent.filter(j => workModes(j).length).length } };
  });
  return { baselineComplete, ...dedup, bySource, independent: results.length,
    incremental: baselineComplete ? incremental.filter(j => j.decision === 'PASS').length : null,
    pending: baselineComplete ? incremental.filter(j => j.decision === 'REVIEW').length : null };
}
