import test from 'node:test';
import assert from 'node:assert/strict';
import {submissionSummary} from '../web/v2/application.js';
import {factsLabel,preparationRoute} from '../web/v2/opportunity.js';
test('school-imported unknown-date submission is not mislabeled as manual confirmation',()=>{
 const records=[{channel:'school',date:'',source:'school-portal'}],before=structuredClone(records);
 assert.equal(submissionSummary(records),'学校：提交日期未知，学校 Portal 状态');assert.deepEqual(records,before);
});
test('dual channels preserve independent source and exact date; missing provenance stays uncertain',()=>{
 const result=submissionSummary([{channel:'school',date:null,source:'school-portal'},{channel:'employer',date:'2026-10-14',source:'manual-confirmation'}]);
 assert.equal(result,'学校：提交日期未知，学校 Portal 状态；官网：2026-10-14，本人确认已提交');
 assert.equal(submissionSummary([{channel:'other',date:'2026-10-14'}]),'渠道待确认：2026-10-14，已记录提交（来源待核实）');assert.equal(submissionSummary([]),'尚未记录实际提交');
});
test('missing official URL never directs a school or manual job to an unavailable official entry',()=>{
 for(const job of [{title:'Software Intern 2027',schoolId:'91362'},{title:'Manual opportunity',url:''}]){const before=structuredClone(job);assert.match(preparationRoute(job),/尚无官网链接/);assert.doesNotMatch(preparationRoute(job),/去官网申请|再打开岗位官网/);assert.match(factsLabel(job),/申请入口待核实/);assert.deepEqual(job,before)}
 assert.equal(preparationRoute(null),'');
});
test('existing official application paths retain their capability-specific guidance',()=>{
 assert.match(preparationRoute({url:'https://job-boards.greenhouse.io/example/jobs/123'}),/读取这份申请表的问题/);
 assert.match(preparationRoute({url:'https://example.com/careers/123'}),/再打开岗位官网申请/);
 assert.match(factsLabel({url:'https://example.com/careers/123'}),/准备材料后去官网申请/);
});
