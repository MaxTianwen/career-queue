import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID,createHash} from 'node:crypto';import {resolve} from 'node:path';
import {WorkspaceStore} from '../src/v2/store.mjs';import {CatalogueRunner} from '../src/v2/discovery-runner.mjs';import {refreshNovelty} from '../src/v2/refresh-novelty.mjs';import {orderDiscovery,discoveryPriority,matchesOpportunity} from '../web/v2/opportunity.js';
const now=Date.parse('2026-10-18T12:00:00Z'),source={id:'fixture',name:'Synthetic'};
const job=(id,extra={})=>({id:createHash('sha256').update(id).digest('hex'),company:'Synthetic',title:'Software Intern 2027',location:'Toronto, Canada',url:'https://example.test/jobs/'+id,jd:'Start Date: May 2027. Duration: 4 months. Develop software applications.',classification:{track:'cs'},source,sources:[source],...extra});
function fixture(t){const database=resolve('output/test-runs',randomUUID(),'db.sqlite'),store=new WorkspaceStore(database,{now:()=>now});t.after(()=>store.close());let result;const runner=new CatalogueRunner(store,{discover:async()=>result});return {store,runner,database,set:(jobs,status='complete')=>result={jobs,sources:[{...source,status}],finishedAt:new Date(now).toISOString()},run:()=>runner.start('manual',{interactive:true})};}
test('new refresh records only unseen deduplicated public identities; updates, disappearance and reappearance are not new',async t=>{
 const f=fixture(t),a=job('a'),b=job('b');f.store.saveCatalogue({jobs:[a],sources:[{...source,status:'complete'}]});f.set([{...a,jd:a.jd+' Updated.'},b,b]);await f.run();assert.deepEqual(f.store.catalogue().refreshBatch.newIds,[b.id]);assert.equal(f.runner.status().runs.at(-1).added,1);f.set([]);await f.run();assert.deepEqual(f.store.catalogue().refreshBatch.newIds,[]);f.set([a,b]);await f.run();assert.deepEqual(f.store.catalogue().refreshBatch.newIds,[]);assert(f.store.catalogue().discoveryHistory.seenIds.includes(b.id));
});
test('failed refresh and rejected completion transaction preserve the prior successful batch and identity history',async t=>{
 const f=fixture(t);f.set([job('a')]);await f.run();const before=f.store.catalogue();f.set([],'failed');await assert.rejects(f.run());assert.deepEqual(f.store.catalogue(),before);
 f.store.db.exec("CREATE TRIGGER reject_done BEFORE UPDATE ON discovery_state WHEN json_extract(NEW.payload,'$.runs[#-1].status')='done' BEGIN SELECT RAISE(ABORT,'synthetic completion failure'); END");f.set([job('b')]);await assert.rejects(f.run());assert.deepEqual(f.store.catalogue(),before);assert.equal(f.runner.status().runs.at(-1).status,'failed');
});
test('partial success replaces batch with only new successful-source jobs while preserving failed-source cache',async t=>{
 const f=fixture(t),old=job('old',{source:{id:'down'},sources:[{id:'down'}]});f.store.saveCatalogue({jobs:[old],sources:[{id:'down',status:'complete'}]});f.runner.discover=async()=>({jobs:[job('new')],sources:[{...source,status:'partial'},{id:'down',status:'failed'}]});await f.run();const c=f.store.catalogue();assert(c.jobs.some(j=>j.id===old.id));assert.equal(c.refreshBatch.partial,true);assert.deepEqual(c.refreshBatch.newIds,[job('new').id]);
});
test('concurrent refresh requests share a batch; public flags never turn personal school rows into shared discoveries',async t=>{
 const f=fixture(t);let release;f.runner.discover=()=>new Promise(r=>release=r);assert.equal(f.runner.requestRefresh('manual').reused,false);await Promise.resolve();assert.equal(f.runner.requestRefresh('manual').reused,true);release({jobs:[job('new')],sources:[{...source,status:'complete'}]});await f.runner.pending;assert.equal(f.runner.status().runs.length,1);
 const owners=[randomUUID(),randomUUID()];for(const owner of owners)f.store.db.prepare('INSERT INTO users(id,username,salt,password_hash) VALUES(?,?,?,?)').run(owner,owner,'synthetic','synthetic');for(const owner of owners){const projected=f.store.opportunities(owner);assert.equal(projected[0].newInRefresh,true);assert.equal(projected[0].schoolSources.length,0);}assert.equal(discoveryPriority({...job('private'),hasPublic:false,newInRefresh:true},now).rank,2);
});
test('novelty history is persistent across store reopen, not a session or browser cache',async t=>{
 const f=fixture(t);f.set([job('a')]);await f.run();const other=new WorkspaceStore(f.database,{now:()=>now});try{const c=other.catalogue();assert(c.discoveryHistory.seenIds.includes(job('a').id));assert.deepEqual(c.refreshBatch.newIds,[job('a').id]);}finally{other.close();}
});
test('priority separates new from publication, overlaps have one rank, and country/city/year/duration filters still apply',()=>{
 const a={...job('new'),hasPublic:true,newInRefresh:true,firstSeenAt:new Date(now).toISOString(),postedAt:'2026-10-18T11:00:00Z'},b={...job('recent'),hasPublic:true,postedAt:'2026-10-17T12:00:00Z'},c={...job('old'),hasPublic:true,postedAt:'2026-10-18',firstSeenAt:new Date(now).toISOString()};assert.deepEqual(orderDiscovery([c,b,a],now).map(j=>j.id),[a.id,c.id,b.id]);assert.equal(discoveryPriority(a,now).label,'新发现');assert.equal(discoveryPriority(b,now).label,'近24小时发布');assert.equal(discoveryPriority(b,now+1).rank,2);assert.equal(discoveryPriority(c,now).rank,0);
 assert(matchesOpportunity(a,{country:'CA',location:'toronto',year:'2027',season:'summer',months:'4'}));assert(!matchesOpportunity(a,{country:'US'}));assert(!matchesOpportunity(a,{location:'Boston'}));assert(!matchesOpportunity(a,{year:'2028'}));assert(!matchesOpportunity(a,{months:'8'}));assert.deepEqual(orderDiscovery([c,b],now+1).map(j=>j.id),[c.id,b.id]);assert.deepEqual(orderDiscovery([b,c],now+1).map(j=>j.id),[c.id,b.id]);
});
test('bounded public history rolls forward: oldest unseen identities fall out and novelty stays on',()=>{
 const ids=Array.from({length:100000},(_,i)=>String(i)),overflow=job('overflow');
 const next=refreshNovelty({jobs:[],discoveryHistory:{startedAt:'2026-10-18',seenIds:ids,complete:true}},{jobs:[{...job('x'),id:'0'},overflow],sources:[{...source,status:'complete'}]},'run',now);
 assert.equal(next.discoveryHistory.complete,true);assert.equal(next.refreshBatch.historyComplete,true);assert.equal(next.discoveryHistory.seenIds.length,100000);assert.deepEqual(next.refreshBatch.newIds,[overflow.id]);
 assert.deepEqual(next.discoveryHistory.seenIds.slice(-2),['0',overflow.id]);assert.ok(!next.discoveryHistory.seenIds.includes('1'));assert.equal(next.discoveryHistory.seenIds[0],'2');
});
test('history disabled by the former cap recovers on the next refresh',()=>{
 const seenJob=job('seen'),fresh=job('fresh');
 const next=refreshNovelty({jobs:[],discoveryHistory:{startedAt:'2026-10-18',seenIds:[seenJob.id],complete:false}},{jobs:[seenJob,fresh],sources:[{...source,status:'complete'}]},'run',now);
 assert.equal(next.discoveryHistory.complete,true);assert.deepEqual(next.refreshBatch.newIds,[fresh.id]);
});

test('approved compatible aliases count once and cannot make a known opportunity new; conflicts remain separate',()=>{
 const canonical=job('canonical',{term:'Summer 2027',requisitionId:'REQ-1'}),alias={...canonical,id:job('alias').id,url:'https://example.test/alias'},mapping=[{canonical_id:canonical.id,alias_id:alias.id}],value={jobs:[canonical,alias],sources:[{...source,status:'complete'}]};
 assert.deepEqual(refreshNovelty({jobs:[]},value,'run',now,mapping).refreshBatch.newIds,[canonical.id]);assert.deepEqual(refreshNovelty({jobs:[alias]},value,'run',now,mapping).refreshBatch.newIds,[]);assert.deepEqual(refreshNovelty({jobs:[canonical]},value,'run',now,mapping).refreshBatch.newIds,[]);const changed={...alias,title:'Different software intern'};assert.equal(refreshNovelty({jobs:[]},{...value,jobs:[canonical,changed]},'run',now,mapping).refreshBatch.newIds.length,2);
});

test('unknown publication sorts deterministically, ignoring refresh novelty and match score',()=>{const items=[{id:'z',match:{score:1},company:'Z'},{id:'n2',hasPublic:true,newInRefresh:true},{id:'a',match:{score:99},company:'A'},{id:'n1',hasPublic:true,newInRefresh:true}];assert.deepEqual(orderDiscovery(items,now).map(j=>j.id),['a','n1','n2','z']);});

test('first discovery survives refresh, disappearance, reopen, and expires exactly at 24h',t=>{
 let clock=now;const database=resolve('output/test-runs',randomUUID(),'db.sqlite');let store=new WorkspaceStore(database,{now:()=>clock});
 const a=job('persistent',{postedAt:'2026-01-01T00:00:00Z'}),save=jobs=>store.saveCatalogue({jobs,sources:[{...source,status:'complete'}]},{refreshId:String(clock)});
 save([a]);const first=store.catalogue().jobs[0].firstSeenAt;clock+=3600000;save([a]);assert.equal(store.catalogue().jobs[0].firstSeenAt,first);assert.equal(discoveryPriority({...store.catalogue().jobs[0],hasPublic:true},clock).label,'新发现');
 save([]);store.close();store=new WorkspaceStore(database,{now:()=>clock});t.after(()=>store.close());save([a]);assert.equal(store.catalogue().jobs[0].firstSeenAt,first);assert.equal(discoveryPriority({...store.catalogue().jobs[0],hasPublic:true},now+86400000).label,'');
 store.db.prepare('UPDATE catalogue SET payload=? WHERE id=1').run(JSON.stringify({jobs:[],sources:[],discoveryHistory:{seenIds:[a.id],complete:true}}));save([a]);assert.equal(store.catalogue().jobs[0].firstSeenAt,null);
});
test('publication descending handles offsets, dates, unknowns and filters independently of new discovery',()=>{
 const items=[{id:'old-new',hasPublic:true,firstSeenAt:new Date(now).toISOString(),postedAt:'2026-01-01T00:00:00Z'},{id:'unknown'},{id:'newest',postedAt:'2026-10-18T09:00:00-04:00'},{id:'earlier',postedAt:'2026-10-18T12:00:00Z'},{id:'date',postedAt:'2026-10-18'}];
 const expected=['newest','earlier','date','old-new','unknown'];assert.deepEqual(orderDiscovery(items,now).map(j=>j.id),expected);assert.deepEqual(orderDiscovery([...items].reverse(),now).map(j=>j.id),expected);
 assert(!matchesOpportunity(items[0],{publication:'24h',now}));
});
