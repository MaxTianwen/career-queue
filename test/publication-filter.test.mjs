import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {resolve} from 'node:path';
import {publicationFacts,publicationLabel,mergePublication} from '../src/publication-facts.mjs';
import {matchesOpportunity} from '../web/v2/opportunity.js';import {catalogueJob,fetchCatalogue} from '../src/v2/catalogue.mjs';import {WorkspaceStore} from '../src/v2/store.mjs';
const now=Date.parse('2026-11-02T05:30:00Z');
test('strict rolling 24h includes exact boundary, rejects future and handles Toronto DST offsets',()=>{
 for(const at of ['2026-11-01T05:30:00Z','2026-11-01T01:30:00-04:00','2026-11-01T01:30:00-05:00'])assert.equal(publicationFacts({postedAt:at},now).recent24h,true);
 for(const at of ['2026-11-01T05:29:59.999Z','2026-11-02T05:30:00.001Z'])assert.equal(publicationFacts({postedAt:at},now).recent24h,false);
 assert.match(publicationLabel({postedAt:'2026-11-01T05:30:00Z'},now),/Toronto/);
});
test('date-only, relative, invalid, unknown and update/collection observations never masquerade as exact publication',()=>{
 for(const at of ['2026-11-02','Posted 1 day ago','2026-11-02T01:00:00','2026-02-30T01:00:00Z','2026-11-01T24:00:00Z',''])assert.equal(publicationFacts({postedAt:at},now).recent24h,false);
 for(const field of ['updated_at','dateModified','firstSeenAt','retrievedAt','createdAt'])assert.equal(publicationFacts({postedAt:'2026-11-02T04:00:00Z',sourceEvidence:{postedAtField:field}},now).recent24h,false);
 assert.equal(publicationFacts({firstSeenAt:'2026-11-02T04:00:00Z',sourceUpdatedAt:'2026-11-02T04:00:00Z'},now).precision,'unknown');
 assert.match(publicationLabel({postedAt:'2026-11-02'},now),/仅日期/);
});
test('24h combines with country/category/term/duration and ignores unknown override; default still includes unknown school dates',()=>{
 const j={title:'Software Intern',location:'Toronto, Canada',term:'Summer 2027',duration:'4 months',postedAt:'2026-11-02T04:00:00Z',hasSchool:true};
 const f={publication:'24h',now,country:'CA',category:'cs',season:'summer',months:'4'};assert(matchesOpportunity(j,f));assert(!matchesOpportunity(j,{...f,months:'8'}));assert(!matchesOpportunity({...j,postedAt:null},{...f,unknown:true}));assert(matchesOpportunity({...j,postedAt:null},{}));
});
test('collection preserves immutable first publication and first seen, distinguishes latest/repost, and does not migrate legacy first seen',()=>{
 const a=mergePublication({postedAt:'2026-10-01T12:00:00Z',postedAtKind:'first'},null,now);
 const b=mergePublication({postedAt:'2026-11-02T04:00:00Z',postedAtKind:'first'},a,now+1000);assert.equal(b.postedAt,a.postedAt);assert.equal(b.firstSeenAt,a.firstSeenAt);
 const c=mergePublication({postedAt:'2026-11-02T04:00:00Z',postedAtKind:'latest'},a,now+1000);assert.equal(c.firstPublishedAt,a.firstPublishedAt);assert.match(publicationLabel(c,now),/最近发布/);
 assert.equal(mergePublication({}, {postedAt:'2026-10-01'},now).firstSeenAt,null);
});
test('fetch merge SQLite keeps API first/latest semantics, does not duplicate jobs or replace publication with updated_at',async t=>{
 const s=new WorkspaceStore(resolve('output/test-runs',randomUUID(),'db.sqlite'),{now:()=>now});t.after(()=>s.close());
 const source={id:'fixture',name:'Synthetic'},base={title:'Software Intern',company:'Synthetic',location:'Toronto, Canada',url:'https://example.com/jobs/1',jd:'Software internship lasts 4 months.'};
 const run=async raw=>s.saveCatalogue(await fetchCatalogue({sources:[source],cachedJobs:s.catalogue().jobs,readBoard:async()=>({status:'complete',jobs:[raw]})}));
 await run({...base,postedAt:'2026-10-01T12:00:00Z',postedAtKind:'first',sourceEvidence:{postedAtField:'first_published',url:base.url}});const first=s.catalogue().jobs[0];
 await run({...base,postedAt:'2026-11-02T04:00:00Z',sourceEvidence:{postedAtField:'updated_at',updatedAt:'2026-11-02T04:00:00Z'}});let j=s.catalogue().jobs[0];assert.equal(j.postedAt,first.postedAt);assert.equal(j.firstSeenAt,first.firstSeenAt);assert.equal(s.catalogue().jobs.length,1);assert(!publicationFacts({...j,sourceEvidence:j.publicationEvidence},now).recent24h);
 await run({...base,postedAt:'2026-11-02T04:00:00Z',postedAtKind:'latest',sourceEvidence:{postedAtField:'publishedAt',url:base.url}});j=s.catalogue().jobs[0];assert.equal(j.postedAtKind,'latest');assert.equal(j.firstPublishedAt,first.postedAt);assert(publicationFacts({...j,sourceEvidence:j.publicationEvidence},now).recent24h);
});

test('verified school official-cache projection exposes employer publication, portal-only update stays unknown',async t=>{
 const {schoolHash}=await import('../src/v2/school.mjs');const s=new WorkspaceStore(resolve('output/test-runs',randomUUID(),'db.sqlite'));t.after(()=>s.close());
 await s.createAdmin({username:'publication-school',password:'Synthetic school password!'});const owner=s.db.prepare('select id from users').get().id;
 const row={id:'900010',title:'Software Intern',company:'Synthetic',location:'Toronto',term:'Summer 2027',externalUrl:'https://example.com/jobs/1'};
 s.db.prepare('insert into school_opportunities values(?,?,?,?)').run(owner,row.id,JSON.stringify(row),now);
 assert.equal(publicationFacts(s.schoolOpportunities(owner)[0].facts,now).precision,'unknown');
 s.db.exec('CREATE TABLE IF NOT EXISTS school_official_cache (user_id TEXT,school_id TEXT,source_hash TEXT,payload TEXT)');
 s.db.prepare('insert into school_official_cache(user_id,school_id,source_hash,payload,updated) values(?,?,?,?,?)').run(owner,row.id,schoolHash(row),JSON.stringify({title:row.title,url:row.externalUrl,jd:'Software internship.',postedAt:'2026-11-02T04:00:00Z',postedAtKind:'first',sourceEvidence:{postedAtField:'first_published',url:row.externalUrl}}),now);
 const item=s.schoolOpportunities(owner)[0];assert.equal(item.row.postedAt,undefined);assert(publicationFacts(item.facts,now).recent24h);assert.equal(item.facts.postedAtKind,'first');
});
