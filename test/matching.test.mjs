import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProfile, matchJob } from '../src/matching.mjs';
const knowledge = `# Synthetic knowledge
## 5. 技能与证据范围
| 工作技术 | SQL、Python、Tableau | EXP-TEST；Power BI 保留 basic。 |
| Web 项目 | JavaScript、Node.js | PROJ-TEST；项目不是 React 应用。 |
| 工作数据分析 | 数据标准化、报告 | EXP-TEST |
| 仅原简历列出、具体案例未展开 | React、FastAPI | 不可冒充项目经历 |
| 目标岗位而非已确认技能 | AWS、Kubernetes、SRE | 目标不是技能 |
## 7. 搜索词
Docker, Azure, React, machine learning
`;
const profile = buildProfile(knowledge);
test('matching uses supported knowledge rows, not prohibitions, search goals or unverified resume skills', () => {
  const result = matchJob({ jd: 'Qualifications\nPython, SQL, React, Kubernetes, Power BI, Docker.' }, profile);
  assert.equal(result.score, 42); // (1 + 1 + .5) / 6
  assert.ok(result.matched.some(x => x.name === 'Power BI' && x.level === .5));
  assert.ok(result.gaps.some(x => x.name === 'React' && x.unverified));
  assert.ok(result.gaps.some(x => x.name === 'Kubernetes'));
  assert.ok(result.gaps.some(x => x.name === 'Docker'));
});
test('no full JD or no usable knowledge yields no score; missing evidence is not a claim of inability', () => {
  assert.equal(matchJob({ jd: '', fullJd: false }, profile).score, null);
  assert.equal(matchJob({ jd: 'Python', fullJd: false }, profile).score, null);
  assert.equal(matchJob({ jd: 'Python' }, buildProfile('target roles: Python')).score, null);
  assert.equal(matchJob({ jd: 'No recognized technical requirements.' }, profile).score, null);
  assert.equal(matchJob({ jd: 'React, AWS' }, profile).score, 0);
});
test('qualification section excludes employer marketing and benefits; evidence changes recalculate the score', () => {
  const jd = 'Our team uses Kubernetes and Docker.\nQualifications\nPython and SQL.\nBenefits\nWe have an AWS partnership.';
  const result = matchJob({ jd }, profile);
  assert.equal(result.score, 100); assert.equal(result.evidenceCount, 2);
  assert.equal(result.comparedSection, 'JD 资格要求段落');
  const reduced = buildProfile(knowledge.replace('SQL、Python、Tableau', 'SQL、Tableau'));
  assert.equal(matchJob({ jd }, reduced).score, 50);
});
test('skill aliases stay distinct; experience coverage and years/degree checks are explained', () => {
  const result = matchJob({ jd: 'JavaScript and Java. Data cleaning and reporting. Requires 3 years of professional development. Bachelor degree required.' }, profile);
  assert.ok(result.gaps.some(x => x.name === 'Java'));
  assert.equal(result.components.length, 2);
  assert.equal(result.components[0].weight, 70); assert.equal(result.components[1].weight, 30);
  assert.ok(result.checks.some(x => x.includes('3 years')));
  assert.ok(result.checks.some(x => x.includes('degree')));
});
