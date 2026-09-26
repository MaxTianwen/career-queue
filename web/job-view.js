export function matchesTerm(job, term) {
  if (!term) return true;
  if (job.term && job.term !== 'Unknown') {
    return job.term === term || job.term === 'Summer/Fall 2027' && ['Summer 2027', 'Fall 2027'].includes(term);
  }
  return term === 'Unknown' ? !job.indexEvidence?.terms?.length : (job.indexEvidence?.terms ?? []).includes(term);
}
function comparePublication(a, b) {
  const dayOrder = publicationDay(b).localeCompare(publicationDay(a));
  if (dayOrder) return dayOrder;
  const ap = publication(a), bp = publication(b);
  const at = ap.at && !ap.dateOnly ? Date.parse(ap.at) : -Infinity;
  const bt = bp.at && !bp.dateOnly ? Date.parse(bp.at) : -Infinity;
  return at === bt ? 0 : at > bt ? -1 : 1;
}
export function matchesFilters(job, filters = {}) {
  if (!matchesTerm(job, filters.term)) return false;
  if (filters.track && (job.resumeClassification?.track || 'unknown') !== filters.track) return false;
  if (filters.workMode && (job.workMode || 'unknown') !== filters.workMode) return false;
  const range = durationRange(job);
  if (filters.duration === 'unknown' && range) return false;
  if (filters.duration === '8plus' && !(range && range.max >= 8)) return false;
  if (filters.duration && !['unknown', '8plus'].includes(filters.duration) && !(range && range.min <= Number(filters.duration) && range.max >= Number(filters.duration))) return false;
  const region = locationRegion(job);
  if (filters.location === 'gta' && !['toronto', 'gta'].includes(region)) return false;
  if (['toronto', 'outside', 'unknown'].includes(filters.location) && region !== filters.location) return false;
  if (filters.city && !(job.location || '').toLowerCase().includes(filters.city.trim().toLowerCase())) return false;
  return true;
}
const score = j => Number.isFinite(j.match?.score) ? j.match.score : -1;
export function sortJobs(jobs, by = 'match') {
  const compareNumber = (a, b) => a === b ? 0 : a > b ? -1 : 1;
  return [...jobs].sort((a, b) => (by === 'published'
    ? comparePublication(a, b) || compareNumber(score(a), score(b))
    : compareNumber(score(a), score(b)) || comparePublication(a, b))
    || a.company.localeCompare(b.company) || a.title.localeCompare(b.title) || String(a.key).localeCompare(String(b.key)));
}
import { publication, publicationDay, locationRegion, durationRange } from './job-facts.js';
