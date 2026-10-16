import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {parseStructuredJob} from '../src/public-structured-job.mjs';
import {publicationFacts,publicationLabel} from '../src/publication-facts.mjs';
import {readCatalogueDetail,fetchCatalogue} from '../src/v2/catalogue.mjs';
import {WorkspaceStore} from '../src/v2/store.mjs';
import {matchesOpportunity} from '../web/v2/opportunity.js';
const dir=new URL('./fixtures/amd-publication/',import.meta.url);
const sources=JSON.parse(readFileSync(new URL('sources.json',dir),'utf8'));
for(const [index,source] of sources.entries())test(`official saved AMD ${source.id} replay reaches SQLite and publication filtering`,async t=>{
 const extracted=readFileSync(new URL(source.id+'.html',dir),'utf8');
 // Explicit opt-in replays the complete original response as well as the portable exact-node fixture.
 let html=extracted;
 if(process.env.CQ_REPLAY_AMD_ORIGINAL==='1'){
  const bytes=readFileSync(resolve(source.originalResponse));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),source.sha256);
  html=bytes.toString('utf8');
 }
 const candidate={company:'AMD',title:index?'Short Term 2027 Software Engineering Intern/Co-Op':'Short Term 2027 Firmware Engineering Intern/Co-Op',url:`https://careers.amd.com/jobs/${source.id}?icims=1`,location:'Canada'};
 const expected=`2026-09-01T07:${index?'52':'10'}:00+00:00`,raw=expected.replace('+00:00','+0000');
 const fixtureParsed=parseStructuredJob(extracted,candidate);
 const fullParsed=parseStructuredJob(html,candidate);
 assert.equal(fullParsed.jd,fixtureParsed.jd);assert.equal(fullParsed.postedAt,expected);
 let calls=0;
 const readDetail=job=>readCatalogueDetail(job,async url=>{calls++;assert.equal(String(url),source.sourceUrl);return new Response(html,{headers:{'content-type':'text/html'}});});
 const now=Date.parse('2026-09-02T07:00:00Z');
 const store=new WorkspaceStore(resolve('output/test-runs',randomUUID(),'db.sqlite'),{now:()=>now});t.after(()=>store.close());
 const run=async()=>store.saveCatalogue(await fetchCatalogue({sources:[{id:'amd-replay',name:'AMD'}],now:Date.now()+1000,cachedJobs:store.catalogue().jobs,readBoard:async()=>({status:'complete',jobs:[candidate]}),readDetail}));
 await run();let job=store.catalogue().jobs[0];assert(job);assert.equal(job.postedAt,expected);assert.equal(job.postedAtKind,'official');
 assert.equal(job.sourceEvidence.postedAtRaw,raw);assert.equal(job.publicationEvidence.postedAtField,'JobPosting.datePosted');assert.equal(job.publicationEvidence.publicationUrl,source.sourceUrl);
 assert.equal(publicationFacts(job,now).precision,'instant');assert(matchesOpportunity(job,{publication:'24h',now}));assert.match(publicationLabel(job,now),/官方发布.*Toronto/);
 assert(!matchesOpportunity(job,{publication:'24h',now:now+86400000}));
 assert.equal(job.sourceEvidence.field,'JobPosting.description');assert.equal(job.requisitionId,source.id);
 await run();job=store.catalogue().jobs[0];assert.equal(store.catalogue().jobs.length,1);assert.equal(job.postedAt,expected);assert.equal(job.publicationEvidence.postedAtRaw,raw);assert.equal(calls,1);
});
const candidate={url:'https://stripe.com/jobs/listing/software-intern/12345',title:'Software Intern'};
const body=extra=>'<script type="application/ld+json">'+JSON.stringify({'@graph':[{'@type':'JobPosting',title:candidate.title,url:candidate.url,description:'Develop software and maintain tests with engineers. '.repeat(4),...extra}]})+'</script>';
test('generic official JSON-LD preserves exact offsets, dates and unresolved precision without manufacturing midnight',()=>{
 const now=Date.parse('2026-10-14T12:00:00Z');
 for(const [raw,expected,precision,recent] of [
  ['2026-10-14T07:00:00-0430','2026-10-14T07:00:00-04:30','instant',true],
  ['2026-10-14T12:30:00+0530','2026-10-14T12:30:00+05:30','instant',true],
  ['2026-10-14T07:00:00Z','2026-10-14T07:00:00Z','instant',true],
  ['2026-10-14','2026-10-14','date',false],
  ['2026-10-14T07:00:00','2026-10-14T07:00:00','unresolved',false],
  ['2026-02-30T07:00:00+0000','2026-02-30T07:00:00+0000','unresolved',false],
  ['2026-10-14T07:00:00+2500','2026-10-14T07:00:00+2500','unresolved',false]
 ]){const job=parseStructuredJob(body({datePosted:raw,dateModified:'2026-10-14T11:59:00Z'}),candidate);assert.equal(job.postedAt,expected);assert.equal(job.sourceEvidence.postedAtRaw,raw);assert.equal(publicationFacts(job,now).precision,precision);assert.equal(publicationFacts(job,now).recent24h,recent);}
});
test('only the uniquely matched JobPosting datePosted is publication; dateModified and other nodes cannot fill it',()=>{
 for(const extra of [{dateModified:'2026-10-14T11:59:00Z'},{dateCreated:'2026-10-14T11:59:00Z'},{datePosted:null},{datePosted:{value:'2026-10-14'}},{datePosted:''}]){
  const job=parseStructuredJob(body(extra),candidate);assert.equal(publicationFacts(job).precision,'unknown');assert.equal(job.sourceEvidence.postedAtField,undefined);
 }
 const wrong=body({url:'https://stripe.com/jobs/listing/software-intern/99999',datePosted:'2026-10-14T11:59:00Z'});
 assert.throws(()=>parseStructuredJob(wrong,candidate));
 const job=parseStructuredJob(body({})+wrong,candidate);assert.equal(publicationFacts(job).precision,'unknown');
 assert.throws(()=>parseStructuredJob(body({datePosted:'2026-10-14'})+body({datePosted:'2026-10-13'}),candidate));
});
