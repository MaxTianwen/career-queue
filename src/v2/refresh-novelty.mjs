import { projectAliases } from './opportunity-aliases.mjs';
export const HISTORY_LIMIT = 100000;
// Public catalogue identities only. Never store owner/private school records here.
export function refreshNovelty(previous, value, runId, now, mappings = []) {
  const seen = new Set([...(previous.discoveryHistory?.seenIds || []), ...previous.jobs.map(j => j.id)]),
    startedAt = previous.discoveryHistory?.startedAt || new Date(now).toISOString();
  const successful = new Set(value.sources.filter(s => ['complete', 'partial'].includes(s.status)).map(s => s.id));
  const fresh = [
    ...new Set(
      projectAliases(value.jobs, mappings)
        .filter(
          j =>
            !seen.has(j.id) &&
            !(j.publicAliases || []).some(a => seen.has(a.id)) &&
            (j.sources || [j.source]).some(s => successful.has(s?.id))
        )
        .map(j => j.id)
    )
  ].sort();
  // Rolling window: identities seen now move to the newest end and only the oldest unseen ones fall out, so novelty never switches off.
  const current = new Set(value.jobs.map(j => j.id)),
    seenIds = [...[...seen].filter(id => !current.has(id)), ...current].slice(-HISTORY_LIMIT);
  return {
    discoveryHistory: { startedAt, complete: true, seenIds },
    refreshBatch: {
      id: runId,
      finishedAt: new Date(now).toISOString(),
      startedAt,
      historyComplete: true,
      newIds: fresh,
      partial: value.sources.some(s => s.status !== 'complete')
    }
  };
}
