import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreBasisText, scoreComponentsView, workplaceEvidence, workplaceBadge } from '../web/job-summary.js';
import { fieldEvidenceView } from '../web/discovery-sources-view.js';
import { buildResumeProfile, matchJob } from '../src/matching.mjs';
import { matchCurrentResumes } from '../src/resume-profile.mjs';
import { matchesFilters, sortJobs } from '../web/job-view.js';

const profile = buildResumeProfile('Developed Python applications and used SQL for daily reporting. Power BI (basic).', { track: 'cs', version: 'v1' });

test('a high score with few recognized requirements shows its denominator, not total JD coverage', () => {
  const match = matchJob({ jd: 'Requirements\nPython', fullJd: true }, profile);
  assert.equal(match.score, 100); assert.equal(scoreBasisText(match), '基于 1 项可识别要求');
  const html = scoreComponentsView(match);
  assert.match(html, /JD 资格要求段落/); assert.match(html, /不代表完整 JD/);
  assert.match(html, /技能覆盖 · 识别 1 项/); assert.match(html, /简历体现 1 项 · 基础接触 0 项 · 未体现 0 项/);
});

test('actual evidence counts distinguish basic half credit, missing skills and experience themes', () => {
  const match = matchJob({ jd: 'Requirements\nPython, Power BI, AWS. Reporting.', fullJd: true }, profile);
  const before = JSON.stringify(match), html = scoreComponentsView(match);
  assert.equal(match.score, 65);
  assert.match(html, /技能覆盖 · 识别 3 项/); assert.match(html, /简历体现 1 项 · 基础接触 1 项 · 未体现 1 项/);
  assert.match(html, /覆盖计算值 1.5 \/ 3/); assert.match(html, /基础接触每项按 0.5/);
  assert.match(html, /经历主题覆盖 · 识别 1 项/); assert.equal(JSON.stringify(match), before);
});

test('no score reasons stay visible for missing JD, missing resume and unrecognized requirements', () => {
  for (const [job, p, reason] of [[{jd:'Python',fullJd:false},profile,/完整 JD/],[{jd:'Python'},{available:false,reason:'请上传简历'},/请上传简历/],[{jd:'General internship'},profile,/未识别/]]) {
    const match=matchJob(job,p);assert.equal(match.score,null);assert.match(scoreBasisText(match),reason);
  }
  assert.match(scoreComponentsView(matchJob({jd:'Python'},profile)),/JD 全文/);
});

test('current resume selection drives both score and explanation without combining CS and Data', () => {
  const job={jd:'Python SQL',fullJd:true};
  const data=buildResumeProfile('I created SQL reports and tested SQL queries for business applications.',{track:'data',version:'d1'});
  const original=matchCurrentResumes(job,{track:'mixed'},{cs:profile,data});
  assert.equal(original.match.score,100); assert.equal(original.match.source.version,'v1');
  const updated=buildResumeProfile('I developed Java programs and wrote Java application documentation.',{track:'cs',version:'v2'});
  const next=matchCurrentResumes(job,{track:'mixed'},{cs:updated,data});
  assert.equal(next.match.score,50);assert.equal(next.match.source.version,'d1');
  assert.match(scoreComponentsView(next.match),/简历体现 1 项 · 基础接触 0 项 · 未体现 1 项/);
  assert.equal(original.match.score,100);
});

test('mixed country metadata is surfaced while explicit separate locations and nationwide remote are retained', () => {
  const mixed={location:'Remote Employee Canada, NH, US',workMode:'remote'};
  assert.match(workplaceEvidence(mixed).warnings[0],/加拿大与美国/);
  assert.match(workplaceBadge(mixed),/地点 \/ 方式待核实/);
  for(const location of ['Toronto, Canada / Boston, MA, US','Toronto; United States','Canada','Remote']) {
    assert.deepEqual(workplaceEvidence({location,workMode:'remote'}).warnings,[]);
  }
  assert.match(fieldEvidenceView(mixed),/Remote 不代表允许从加拿大办公/);
});

test('explicit JD and stored mode contradictions have quotes without changing mode or filters', () => {
  const job={location:'Toronto',workMode:'onsite',jd:'This role is remote.\nWork arrangement: hybrid',fieldEvidence:{workMode:{status:'extracted',source:'官方字段',raw:'onsite'}}};
  const before=JSON.stringify(job), evidence=workplaceEvidence(job);
  assert.equal(evidence.warnings.length,1);assert.deepEqual(evidence.quotes,['This role is remote.','Work arrangement: hybrid']);
  assert.match(fieldEvidenceView(job),/onsite/);assert.match(fieldEvidenceView(job),/This role is remote/);
  assert.equal(matchesFilters(job,{workMode:'onsite'}),true);assert.equal(matchesFilters(job,{workMode:'remote'}),false);
  assert.equal(JSON.stringify(job),before);
});

test('unknown, negative, remote-team and explicitly optional work modes are not contradictions', () => {
  for(const jd of ['We collaborate with remote teams.','This role is not remote.','Remote Position: No']) assert.equal(workplaceEvidence({jd,workMode:'onsite'}).warnings.length,0);
  assert.equal(workplaceEvidence({jd:'This role is remote.',workMode:'unknown'}).warnings.length,0);
  const optional={jd:'This position can be hybrid or remote.',workMode:'hybrid'};
  assert.equal(workplaceEvidence(optional).warnings.length,0);assert.match(fieldEvidenceView(optional),/This position can be hybrid or remote/);
  assert.doesNotMatch(fieldEvidenceView(optional),/未识别到明确/);
  assert.match(workplaceBadge({fieldEvidence:{workMode:{status:'ambiguous'}}}),/待核实/);
});

test('source evidence safely escapes raw text, rejects unsafe URLs and tolerates missing provenance', () => {
  const html=fieldEvidenceView({location:'<img src=x>',jd:'This role is remote. <script>',workMode:'hybrid',sourceEvidence:{url:'javascript:alert(1)'}});
  assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<script>|href="javascript/);assert.match(html,/未记录可核对/);
  assert.match(fieldEvidenceView({url:'https://example.com/job',location:'Toronto'}),/href="https:\/\/example.com\/job"/);
  assert.match(fieldEvidenceView({}),/地点待核实/);
});

test('explicit location lines retain original wording without using employer background as role location', () => {
  const job={location:'Remote Employee Canada, NH, US',jd:'Country: Canada\nCity: Remote Employee Canada\nOur company operates in the US and Canada.'};
  assert.deepEqual(workplaceEvidence(job).locationQuotes,['Country: Canada','City: Remote Employee Canada']);
  const html=fieldEvidenceView(job);assert.match(html,/<blockquote>Country: Canada<\/blockquote>/);
  assert.doesNotMatch(html,/Our company operates/);assert.match(html,/Remote Employee Canada, NH, US/);
  assert.deepEqual(workplaceEvidence({jd:'Location: This is a remote position, with travel as necessary.',workMode:'remote'}).quotes,['Location: This is a remote position, with travel as necessary.']);
});

test('rendering explanations does not mutate snapshots or alter score-based ordering', () => {
  const jobs=[{key:'a',company:'A',title:'Intern',jd:'Python',match:matchJob({jd:'Python'},profile)},{key:'b',company:'B',title:'Intern',match:matchJob({jd:'Python AWS'},profile)}];
  const before=JSON.stringify(jobs), order=sortJobs(jobs).map(j=>j.key);
  for(const j of jobs){scoreComponentsView(j.match);fieldEvidenceView(j);}
  assert.equal(JSON.stringify(jobs),before);assert.deepEqual(sortJobs(jobs).map(j=>j.key),order);
});
