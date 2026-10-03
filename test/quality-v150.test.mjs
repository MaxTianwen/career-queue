import test from 'node:test';
import assert from 'node:assert/strict';
import { salaryFacts, salaryText, salaryDetails } from '../web/salary.js';
import { applicationSteps, applicationFlow } from '../web/application-flow.js';
import { matchEvidenceView, jobHighlights } from '../web/job-summary.js';
import { buildResumeProfile, matchJob } from '../src/matching.mjs';
import { matchCurrentResumes } from '../src/resume-profile.mjs';
import { portalSummary } from '../src/portal.mjs';

test('salary ranges retain explicit currency and unit without annual conversion', () => {
  for (const [raw,min,max,currency,period] of [['CAD $25.50–$32 / hour',25.5,32,'CAD','hour'],['USD 80,000 - 100,000 / YEAR',80000,100000,'USD','year'],['CA$30 per hour',30,30,'CAD','hour'],['£4k per month',4000,4000,'GBP','month'],['EUR 500 per week',500,500,'EUR','week']]) {
    const f=salaryFacts({salary:raw});assert.equal(f.status,'parsed',raw);assert.equal(f.min,min);assert.equal(f.max,max);assert.equal(f.currency,currency);assert.equal(f.period,period);assert.equal(f.raw,raw);
  }
});
test('existing official salary strings, suffix currency and numeric unit are understood unchanged', () => {
  for(const raw of ['$23-30 CAD/hr','$24.00-30.00 CAD/hr','CAD 45–55 / 1 HOUR','$4,275 - $6,167 CAD/month','$26 - $28.5 CAD per hr']) {
    const f=salaryFacts({salary:raw});assert.equal(f.status,'parsed',raw);assert.equal(f.currency,'CAD');assert.equal(f.raw,raw);
  }
  for(const raw of ['CAD 45 / 2 HOUR','Starting at CAD 20 per hour','CAD 20-30k per year']) assert.equal(salaryFacts({salary:raw}).status,'ambiguous',raw);
});
test('bare dollars, missing periods and absent salary remain unknown without using location', () => {
  const f=salaryFacts({salary:'$25 - $35 per hour',location:'Toronto, Canada'});
  assert.equal(f.currency,null);assert.equal(f.period,'hour');assert.match(salaryText({salary:'$25 - $35 per hour'}),/币种待核实/);
  assert.equal(salaryFacts({salary:'CAD 50,000'}).period,null);
  for(const salary of [undefined,'未披露','TBD']) assert.equal(salaryFacts({salary}).status,'unknown');
});
test('multiple regions, reversed ranges, currencies, benefits and open bounds are not combined', () => {
  for(const salary of ['CAD 25 per hour; USD 30 per hour','CAD 40-20 per hour','CAD 20-USD 30 per hour','CAD 20 per hour + bonus','up to $40 per hour','$20 per hour or $800 per week']) assert.equal(salaryFacts({salary}).status,'ambiguous',salary);
  assert.equal(salaryFacts({salary:'未披露',fieldEvidence:{salary:{status:'ambiguous',raw:'CAD 25/hour; USD 30/hour'}}}).status,'ambiguous');
});
test('salary display keeps provenance and escapes source text without mutating saved job', () => {
  const j={salary:'CAD 20–30 per hour',fieldEvidence:{salary:{source:'学校字段 <script>',raw:'CAD 20–30 per hour'}},paid:null};
  const before=JSON.stringify(j);assert.match(jobHighlights(j),/CAD 20–30 \/ 小时/);assert.match(salaryDetails(j),/学校字段 &lt;script&gt;/);assert.equal(JSON.stringify(j),before);
});

const profile=buildResumeProfile('Built Python applications and SQL reporting dashboards. Power BI (basic).',{track:'cs',version:'v1'});
test('score explanations pair required, preferred and optional JD quotes with the current resume', () => {
  const m=matchJob({jd:'Requirements\nPython or Java required.\nPreferred Qualifications\nAWS is preferred.\nPower BI',fullJd:true},profile);
  const python=m.matched.find(r=>r.name==='Python'),aws=m.gaps.find(r=>r.name==='AWS');
  assert.equal(python.jdEvidence[0].kind,'required');assert.equal(python.jdEvidence[0].mode,'any');
  assert.equal(aws.jdEvidence[0].kind,'preferred');assert.match(python.evidence,/Built Python/);
  assert.match(matchEvidenceView(m),/任选其一/);assert.match(matchEvidenceView(m),/当前简历原文/);
});
test('negative, complex and outside-requirements keywords do not claim full qualification', () => {
  const m=matchJob({jd:'Requirements\nPython is not required.\nPython and Java or SQL required.'},profile);
  const rows=m.matched.find(x=>x.name==='Python').jdEvidence;
  assert.ok(rows.every(r=>r.status==='unknown'));assert.match(rows[0].reason,/否定/);
  const outside=matchJob({jd:'Our team uses Python.'},profile);assert.equal(outside.matched[0].jdEvidence[0].kind,'unspecified');assert.equal(outside.score,100);
});
test('new explanation metadata leaves weights and score unchanged and does not mix resumes', () => {
  const jd='Requirements\nPython, Power BI, AWS. Reporting.';
  const match=matchJob({jd},profile);assert.equal(match.score,65);assert.deepEqual(match.components.map(x=>x.weight),[70,30]);
  const data=buildResumeProfile('Worked with SQL and created business reporting dashboards.',{track:'data',version:'d2'});
  const result=matchCurrentResumes({jd:'Requirements\nPython SQL'}, {track:'mixed'},{cs:profile,data});
  assert.equal(result.match.score,100);assert.equal(result.match.source.version,'v1');
  assert.ok(result.match.matched.every(r=>r.evidence.includes('Built Python')));
  const html=matchEvidenceView({matched:[{name:'<script>',level:1,evidence:'<img>',jdEvidence:[{quote:'<svg>',kind:'required'}]}]});assert.doesNotMatch(html,/<script>|<img>|<svg>/);
});

const saved = values => { const job={status:'Queue',fullJd:true,...values};return {...job,portalSummary:portalSummary(job,new Date('2026-10-03T15:00:00Z'))}; };
test('workflow guides discovery, missing JD, channel confirmation and each material step', () => {
  assert.equal(applicationSteps({}, {discovery:true})[0].code,'save');assert.equal(applicationSteps({}, {discovery:true,saved:true})[0].code,'saved');
  assert.equal(applicationSteps({fullJd:false}, {discovery:true})[0].code,'discovery-jd');
  assert.equal(applicationSteps(saved({fullJd:false}))[0].target,'#school-details-form');
  assert.equal(applicationSteps(saved({portal:{id:'1',requirement:'required'}}))[0].code,'channel');
  const j=saved({portal:{id:'1',channel:'both',requirement:'required'},generatedMaterial:{version:'new'}});
  assert.deepEqual(applicationSteps(j).map(s=>s.code),['official-materials','school-materials']);
});
test('school-first and official-first submissions remain separate without rewriting dates or status', () => {
  const first=saved({portal:{channel:'both',status:'submitted',requirement:'required',applicationDate:'2026-10-01'}});
  const before=JSON.stringify(first);assert.equal(applicationSteps(first)[0].code,'official-materials');assert.equal(JSON.stringify(first),before);
  const second=saved({status:'已投递',applicationDate:'2026-10-02',portal:{channel:'both',requirement:'required',preparedMaterials:{version:{version:'s1'}}}});
  assert.deepEqual(applicationSteps(second).map(s=>s.code),['school-submit']);
  assert.equal(applicationSteps(saved({portal:{channel:'school-only',status:'submitted'}}))[0].code,'complete');
});
test('stale materials and expired school deadlines have explicit next steps; old records still work', () => {
  const j=saved({status:'待提交',materialFreshness:{needsReview:true},portal:{channel:'both',requirement:'required',deadline:'2026-10-01'}});
  assert.deepEqual(applicationSteps(j).map(s=>s.code),['official-review','school-expired']);
  assert.equal(applicationSteps(saved({status:'已投递',applicationDate:'2026-10-01'}))[0].code,'school-link');
  assert.equal(applicationSteps(saved({status:'已归档'}))[0].code,'archived');
  assert.match(applicationFlow(j),/data-action="flow-target"/);
});
test('new generated PDF is not presented as the already reviewed school version', () => {
  const j=saved({portal:{channel:'school-only',requirement:'required',preparedMaterials:{version:{version:'old'}}},generatedMaterial:{version:'new'}});
  assert.equal(applicationSteps(j)[0].code,'school-new-version');
  assert.equal(j.portal.preparedMaterials.version.version,'old');
  const both=saved({portal:{channel:'both',requirement:'required'}});
  assert.equal(applicationSteps(both).length,1);assert.equal(applicationSteps(both)[0].code,'shared-materials');
});
test('school verification and confirmed qualification conflicts guide review before new generation', () => {
  const j=saved({jdSource:'school',url:'',portal:{channel:'school-only',requirement:'required'}});
  assert.equal(applicationSteps(j)[0].code,'school-verify');
  assert.equal(applicationSteps({...j,schoolAvailabilityView:{recent:true}})[0].code,'school-materials');
  assert.equal(applicationSteps(saved({eligibility:{summary:{hardConflict:true}}}))[0].code,'qualification');
});
