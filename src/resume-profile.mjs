import { readFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { activeResumeBase, resumeRuntime } from './resume-bases.mjs';
import { buildResumeProfile, matchJob, highlightJob } from './matching.mjs';

const run = promisify(execFile), cache = new Map();
const sha = data => createHash('sha256').update(data).digest('hex');
export async function currentResumeProfiles(root) {
  const profiles = {};
  for (const track of ['cs', 'data']) {
    try {
      const base = await activeResumeBase(root, track);
      let path, source, expected;
      if (base) {
        path = base.pdf; expected = base.pdfSha256;
        source = { track, name: base.name, version: base.version, kind: 'uploaded' };
      } else {
        const folder = resolve(root, 'private/resume-templates');
        const config = JSON.parse(await readFile(resolve(folder, 'templates.json'), 'utf8'));
        const template = config.templates?.[track];
        if (!template || basename(template.baselinePdf) !== template.baselinePdf) throw new Error('未配置基准简历');
        path = resolve(folder, template.baselinePdf); expected = template.baselineSha256;
        source = { track, name: template.file, version: `initial-${template.sha256.slice(0, 12)}`, kind: 'initial' };
      }
      if (sha(await readFile(path)) !== expected) throw new Error('基准简历已变化，请重新上传');
      const key = `${path}:${expected}`;
      if (!cache.has(key)) {
        const { stdout } = await run(await resumeRuntime(root), [resolve(root, 'scripts/resume_base.py'), 'text', path],
          { windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024 });
        if (cache.size >= 8) cache.delete(cache.keys().next().value);
        cache.set(key, JSON.parse(stdout).text);
      }
      profiles[track] = buildResumeProfile(cache.get(key), source);
    } catch (e) {
      profiles[track] = { available: false, source: { track }, reason: `${track.toUpperCase()} 当前简历不可读取，请上传可读取的 Word / PDF；不会使用历史知识库评分。` };
    }
  }
  return profiles;
}

export function matchCurrentResumes(job, classification, profiles) {
  const tracks = ['cs', 'data'].includes(classification.track) ? [classification.track] : ['cs', 'data'];
  const comparisons = tracks.map(track => ({ ...matchJob(job, profiles[track]), source: profiles[track].source }));
  // Select one whole resume for ordering, never union skills from both resumes.
  const best = [...comparisons].sort((a, b) => (b.score ?? -1) - (a.score ?? -1))[0];
  return { match: { ...best, comparisons, selection: tracks.length > 1 ? '两份简历分别评分，排序采用较高分；不是合并技能' : '岗位方向对应的当前简历' },
    jdHighlights: highlightJob(job, profiles[best.source.track]) };
}
