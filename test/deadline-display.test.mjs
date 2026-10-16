import test from 'node:test';
import assert from 'node:assert/strict';
import {deadlineEntries,deadlineSummary,publicationSummary} from '../web/v2/opportunity.js';
import {displayDocument} from './helpers/display-dom.mjs';
const now=new Date('2026-10-15T16:00:00Z');
test('deadline channels preserve same-day different exact times and independent urgency',()=>{
 const job={hasPublic:true,deadline:'2026-10-15T10:00:00-04:00',schoolSources:[{schoolId:'1',row:{deadline:'2026-10-15T17:00:00-04:00'}}]},before=structuredClone(job),rows=deadlineEntries(job,now);
 assert.equal(rows[0].status,'已截止');assert.equal(rows[1].status,'48 小时内截止');assert.equal(rows[0].value,job.deadline);assert.equal(rows[1].value,job.schoolSources[0].row.deadline);assert.deepEqual(job,before);
});
test('unknown deadlines are neutral and do not borrow the other channel date',()=>{
 const rows=deadlineEntries({hasPublic:true,schoolSources:[{schoolId:'1',row:{deadline:'2026-10-16'}}]},now);
 assert.equal(rows[0].value,'未提供');assert.equal(rows[0].tone,'neutral');assert.equal(rows[0].known,false);assert.equal(rows[1].value,'2026-10-16');
 assert.equal(deadlineEntries({hasPublic:true,deadline:'2026-10-16',schoolSources:[{row:{}}]},now)[1].value,'未提供');
});
test('date precision retains whole Toronto day and never invents midnight or countdown',()=>{
 const job={hasPublic:true,deadline:'2026-10-15'};
 const row=deadlineEntries(job,new Date('2026-10-16T03:59:59Z'))[0];assert.equal(row.status,'今日截止');assert.equal(row.value,'2026-10-15');assert.equal(row.note,'仅日期');
 assert.equal(deadlineEntries(job,new Date('2026-10-16T04:00:00Z'))[0].status,'已截止');
});
test('school zone assumption and unresolved raw text remain explicit; closed status is independent',()=>{
 const rows=deadlineEntries({schoolSources:[{schoolId:'1',row:{deadlineText:'Oct 15, 2026 05:00 PM',deadline:'2026-10-15T17:00:00-04:00'}},{schoolId:'2',row:{deadlineText:'TBD',sourceStatus:'Closed'}}]},now);
 assert.match(rows[0].note,/原文未标时区/);assert.match(rows[0].title,/-04:00/);assert.equal(rows[1].tone,'neutral');assert.equal(rows[1].value,'TBD');assert.match(rows[2].value,/已关闭/);assert.match(rows[0].label,/1/);assert.match(rows[1].label,/2/);
});
test('visible deadlines are bold but missing neutral; concise publication retains detail and repost meaning',()=>{
 const previous=globalThis.document;globalThis.document=displayDocument();try{
 const box=deadlineSummary({hasPublic:true,deadline:'2026-10-16',schoolSources:[{row:{}}]},now);assert.equal(box.children[0].children[1].tagName,'strong');assert.equal(box.children[1].children[1].tagName,'span');
 const job={postedAt:'2026-10-12T19:33:21Z',postedAtKind:'latest'};const compact=publicationSummary(job),full=publicationSummary(job,{detailed:true});assert.equal(compact.textContent,'最近发布（可能重发）：2026-10-12');assert.match(full.textContent,/15:33:21/);assert.match(compact.title,/15:33:21/);assert.match(full.textContent,/Toronto/);
 assert.match(publicationSummary({postedAt:'2026-10-12'}).textContent,/仅日期/);assert.equal(publicationSummary({}).textContent,'发布时间未知');
 }finally{globalThis.document=previous;}
});
