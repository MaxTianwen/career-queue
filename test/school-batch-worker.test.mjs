import{schoolTitleEvidence}from'../browser-extension/school-title-evidence.js';
import{schoolTitleEvidenceRequest}from'../browser-extension/school-title-evidence-request.mjs';
import test from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{runInNewContext}from'node:vm';
import{schoolTabBatchController,SCHOOL_ORIGIN,coversSchoolOrigin}from'../browser-extension/school-tab-batch-controller.mjs';
const source=readFileSync('browser-extension/school-batch-worker.js','utf8').replace(/^import[^\n]*\n/gm,'');
test('actual batch worker routes only own popup messages and cleans grant after restart',async()=>{
 let saved,listener,permission=false,removes=0;const store={load:async()=>saved,save:async s=>saved=structuredClone(s)};
 const chrome={runtime:{id:'fixture',getURL:p=>'chrome-extension://fixture/'+p,onMessage:{addListener:f=>listener=f}},permissions:{contains:async()=>permission,getAll:async()=>({origins:permission?[SCHOOL_ORIGIN]:[]}),remove:async()=>{removes++;permission=false;return true;}},tabs:{get:async id=>({id}),query:async()=>[],remove:async()=>{},update:async()=>{}},scripting:{executeScript:async()=>[{result:{ok:true,entries:[1,2].map(n=>({schoolId:'90010'+n,title:'Role '+n,company:'Fixture',term:'Summer 2027',candidateCount:1}))}}]}};
 const boot=()=>runInNewContext(source,{chrome,crypto:{randomUUID:()=> 'batch-fixture'},setTimeout,schoolTabBatchController,SCHOOL_ORIGIN,coversSchoolOrigin,schoolTrialState:()=>store,schoolVisibleNavigation:()=>{},schoolDetailReader:()=>{}});
 const sender={id:'fixture',url:chrome.runtime.getURL('popup.html')};
 const send=(type,extra={})=>new Promise(r=>listener({type:'school-batch-'+type,...extra},sender,r));boot();
 assert.equal(listener({type:'school-batch-prepare'},{id:'fixture',url:'https://example.com'},()=>assert.fail('untrusted sender')),undefined);
 assert.equal((await send('prepare',{tabId:1})).ok,true);const armed=await send('arm');await send('begin',{id:'batch-fixture',requestId:armed.data.permissionRequest.id});permission=true;boot();const result=await send('status');assert.equal(result.data.phase,'interrupted');assert.equal(permission,false);assert.equal(removes,1);const empty=await send('export');assert.equal(empty.ok,false);assert.equal(empty.code,'NO_VERIFIED_JOBS_TO_EXPORT');const diagnostic=await send('diagnostic');assert.equal(diagnostic.data.schema,'career-queue-school-batch-diagnostic-v1');
});
test('actual popup invokes request in click gesture before awaiting background, surfaces denial and offers export',async()=>{
 const source=readFileSync('browser-extension/school-batch-ui.js','utf8').replace(/^import[^\n]*\n/gm,'');
 const elements=new Map(),actions=[];let gesture=false,state={id:'batch',phase:'idle',jobs:[],entries:[]};
 const document={getElementById:id=>{if(!elements.has(id))elements.set(id,{disabled:false,textContent:'',hidden:true,removeAttribute(){}});return elements.get(id);}};
 const chrome={tabs:{query:async()=>[{id:1}]},runtime:{sendMessage:async m=>{actions.push(m.type);const type=m.type.replace('school-batch-','');if(type==='arm')state={...state,phase:'armed',permissionRequest:{id:'request-fixture'}};if(type==='begin')state={...state,phase:'requesting'};if(type==='granted')state={...state,phase:m.accepted?'running':'denied'};return{ok:true,data:structuredClone(state)};}},permissions:{request:()=>{assert.equal(gesture,true);actions.push('native-request');return Promise.resolve(false);}}};
 runInNewContext(source,{document,chrome,SCHOOL_ORIGIN,setInterval:()=>0,URL:{},Blob:class{}});await new Promise(r=>setImmediate(r));
 await elements.get('school-batch-prepare').onclick();assert.equal(elements.get('school-batch-grant').disabled,false);
 gesture=true;elements.get('school-batch-grant').onclick();gesture=false;await new Promise(r=>setImmediate(r));
 assert.ok(actions.indexOf('school-batch-begin')<actions.indexOf('native-request'));assert.equal(state.phase,'denied');assert.match(elements.get('school-batch-status').textContent,/授权已拒绝/);
 const html=readFileSync('browser-extension/popup.html','utf8');for(const id of elements.keys())assert.ok(html.includes('id="'+id+'"'),id);
});

test('actual worker checks original popup document across restart before touching new grant',async()=>{
 let saved,listener,permission=false,removes=0,queries=[];const store={load:async()=>structuredClone(saved),save:async s=>saved=structuredClone(s)};
 const url='chrome-extension://fixture/popup.html',doc='original-popup';
 const chrome={runtime:{id:'fixture',getURL:()=>url,getContexts:async filter=>{queries.push(filter);return[{documentId:doc,documentUrl:url}];},onMessage:{addListener:f=>listener=f}},permissions:{contains:async()=>permission,getAll:async()=>({origins:permission?[SCHOOL_ORIGIN]:[]}),remove:async()=>{permission=false;removes++;}},tabs:{query:async()=>[],get:async id=>({id}),remove:async()=>{},update:async()=>{}},scripting:{executeScript:async()=>[{result:{ok:true,entries:[1,2].map(n=>({schoolId:'90010'+n,title:'Job '+n,company:'Fixture',term:'Summer 2027',candidateCount:1}))}}]}};
 const boot=()=>runInNewContext(source,{chrome,crypto:{randomUUID:()=> 'request'},setTimeout,schoolTabBatchController,SCHOOL_ORIGIN,coversSchoolOrigin,schoolTrialState:()=>store,schoolVisibleNavigation:()=>{},schoolDetailReader:()=>{}});
 const send=(type,extra={})=>new Promise(resolve=>listener({type:'school-batch-'+type,...extra},{id:'fixture',url,documentId:doc},resolve));boot();await send('prepare',{tabId:1});const {data:s}=await send('arm');await send('begin',{id:s.id,requestId:s.permissionRequest.id});permission=true;boot();
 const status=await send('status');assert.equal(status.data.phase,'requesting');assert.equal(removes,0);assert.equal(permission,true);assert.deepEqual(Array.from(queries[0].documentIds),[doc]);assert.deepEqual(Array.from(queries[0].documentUrls),[url]);
 await send('granted',{id:s.id,requestId:s.permissionRequest.id,accepted:false});assert.equal(removes,1);const {data:d}=await send('diagnostic');assert.ok(d.events.some(e=>e.event==='new-grant-revoked'));assert.equal(d.permission.owned,false);
});
test('popup retries lost begin acknowledgement, not native permission request',async()=>{
 const ui=readFileSync('browser-extension/school-batch-ui.js','utf8').replace(/^import[^\n]*\n/gm,'');const elements=new Map();let begins=0,requests=0,accepted;
 const document={getElementById:id=>{if(!elements.has(id))elements.set(id,{removeAttribute(){}});return elements.get(id);}};
 const state={id:'batch',phase:'armed',permissionRequest:{id:'token'},jobs:[],entries:[]};
 const chrome={runtime:{sendMessage:async m=>{if(m.type==='school-batch-begin'&&++begins===1)throw Error('message port closed');if(m.type==='school-batch-granted')accepted=m.accepted;return{ok:true,data:state};}},permissions:{request:()=>{requests++;return Promise.resolve(true);}}};
 runInNewContext(ui,{document,chrome,SCHOOL_ORIGIN,setInterval:()=>0,URL:{},Blob:class{}});await new Promise(r=>setImmediate(r));elements.get('school-batch-grant').onclick();elements.get('school-batch-grant').onclick();await new Promise(r=>setImmediate(r));assert.equal(requests,1);assert.equal(begins,2);assert.equal(accepted,true);
});

test('real worker listeners precede synchronous creation and later reuse; both details preserved',async()=>{
 let listener,saved,permission=false,seq=0,clicks=0,bodies=0;const callbacks={},closed=[],url='https://recruitstudents.torontomu.ca/myAccount/coop/postings.htm',tabs=new Map([[1,{id:1,url,status:'complete'}]]);
 const event=name=>({addListener:f=>callbacks[name]=f});
 const chrome={runtime:{id:'fixture',getURL:p=>'chrome-extension://fixture/'+p,onMessage:{addListener:f=>listener=f}},permissions:{contains:async()=>permission,getAll:async()=>({origins:permission?[SCHOOL_ORIGIN]:[]}),remove:async()=>{permission=false;}},tabs:{onCreated:event('created'),onUpdated:event('updated'),onActivated:event('activated'),onRemoved:event('removed'),get:async id=>tabs.get(id),query:async()=>[...tabs.values()],remove:async id=>closed.push(id),update:async()=>{}},scripting:{executeScript:async({args})=>{
  if(args[0]==='scan')return[{result:{ok:true,entries:[1,2].map(n=>({schoolId:'90010'+n,title:'Job '+n,company:'Fixture',term:'Summer 2027',candidateCount:1}))}}];
  if(args[0]==='open'){assert.ok(callbacks.created&&callbacks.updated&&callbacks.activated&&callbacks.removed);clicks++;if(clicks===1){const tab={id:8,url,status:'complete'};tabs.set(8,tab);callbacks.created(tab);}else callbacks.updated(8,{status:'complete'});return[{result:{ok:true}}];}
  if(args[1]?.identityOnly)return[{result:{ok:true,verified:true,identity:{visibleSchoolId:args[0].schoolId}}}];bodies++;return[{result:{ok:true,identity:{verified:true},origin:'https://recruitstudents.torontomu.ca',page:{path:'/myAccount/coop/postings.htm'},jd:'Synthetic visible body',capture:{completeWithinScope:true,truncated:false,hiddenOrCollapsedRead:false}}}];
 }}};
 runInNewContext(source,{chrome,crypto:{randomUUID:()=>String(++seq)},setTimeout:fn=>setTimeout(fn,0),schoolTabBatchController,SCHOOL_ORIGIN,coversSchoolOrigin,schoolTrialState:()=>({load:async()=>saved,save:async s=>saved=structuredClone(s)}),schoolVisibleNavigation:()=>{},schoolDetailReader:()=>{}});
 const send=(type,extra={})=>new Promise(resolve=>listener({type:'school-batch-'+type,...extra},{id:'fixture',url:chrome.runtime.getURL('popup.html')},resolve));await send('prepare',{tabId:1});const {data:s}=await send('arm');await send('begin',{id:s.id,requestId:s.permissionRequest.id});permission=true;await send('granted',{id:s.id,requestId:s.permissionRequest.id,accepted:true});for(let i=0;i<300&&saved.phase==='running';i++)await new Promise(r=>setTimeout(r,1));assert.equal(saved.phase,'completed');assert.equal(clicks,2);assert.equal(bodies,2);assert.deepEqual(closed,[]);assert.equal(saved.attempt.mode,'reused');assert.equal(permission,false);
});

test('actual popup read-only reprepare calls neither native request nor arm; confirmation is separate',async()=>{
 const ui=readFileSync('browser-extension/school-batch-ui.js','utf8').replace(/^import[^\n]*\n/gm,'');const elements=new Map(),messages=[];let requests=0;
 const document={getElementById:id=>{if(!elements.has(id))elements.set(id,{removeAttribute(){}});return elements.get(id);}};
 let state={id:'old',phase:'failed',code:'NO_DETAIL_PAGE_CHANGE_OBSERVED',jobs:[],entries:[{schoolId:'900101'}],attempt:{schoolId:'900101',stage:'dispatched'}};
 const chrome={tabs:{query:async()=>[{id:1}]},permissions:{request:()=>{requests++;return Promise.resolve(true);}},runtime:{sendMessage:async m=>{messages.push(m);if(m.type==='school-batch-reprepare')state={...state,id:'new',phase:'reviewed',attempt:null};if(m.type==='school-batch-arm')state={...state,phase:'armed',permissionRequest:{id:'new-request',requestInvoked:false}};return{ok:true,data:state};}}};
 runInNewContext(ui,{document,chrome,SCHOOL_ORIGIN,setInterval:()=>0,URL:{},Blob:class{}});await new Promise(r=>setImmediate(r));await elements.get('school-batch-reprepare').onclick();assert.equal(requests,0);assert.deepEqual(messages.map(m=>m.type),['school-batch-status','school-batch-reprepare']);assert.equal(state.phase,'reviewed');await elements.get('school-batch-new-attempt').onclick();assert.equal(messages.at(-1).confirmNewAttempt,true);assert.equal(requests,0);assert.equal(state.phase,'armed');
});

test('actual popup title-evidence action downloads one diagnostic without arm, request or plan mutation',async()=>{
 const ui=readFileSync('browser-extension/school-batch-ui.js','utf8').replace(/^import[^\n]*\n/gm,'');const elements=new Map(),messages=[],files=[];let reads=0;
 const document={getElementById:id=>{if(!elements.has(id))elements.set(id,{removeAttribute(){},click(){files.push(this.download);}});return elements.get(id);}};
 const state={id:'old',listTabId:1,phase:'failed',code:'NO_DETAIL_PAGE_CHANGE_OBSERVED',jobs:[],entries:[{schoolId:'900101'}],attempt:{schoolId:'900101',stage:'dispatched'}};
 const chrome={tabs:{query:async()=>[{id:1}]},permissions:{request:()=>assert.fail('permission request forbidden')},runtime:{sendMessage:async m=>{messages.push(m.type);if(m.type==='school-batch-title-evidence'){reads++;await new Promise(r=>setImmediate(r));return{ok:true,data:{schema:'career-queue-school-title-evidence-v1',jobs:[{schoolId:'900101'}]}};}return{ok:true,data:structuredClone(state)};}}};
 runInNewContext(ui,{document,chrome,SCHOOL_ORIGIN,setInterval:()=>0,URL:{createObjectURL:()=> 'blob:evidence',revokeObjectURL(){}},Blob:class{}});await new Promise(r=>setImmediate(r));const p=elements.get('school-batch-title-evidence').onclick();await elements.get('school-batch-title-evidence').onclick();await p;assert.equal(reads,1);assert.deepEqual(files,['career-queue-school-title-evidence.json']);assert.equal(messages.includes('school-batch-arm'),false);assert.equal(messages.includes('school-batch-prepare'),false);assert.equal(state.attempt.stage,'dispatched');
});

test('actual worker read-only route injects only the evidence function with saved selected entries',async()=>{
 let listener,execs=0,writes=0;const entries=[{schoolId:'900101',title:'Synthetic Job',company:'Fixture',term:'2027 - Summer'}],saved={stateVersion:3,id:'saved',phase:'failed',code:'NO_DETAIL_PAGE_CHANGE_OBSERVED',listTabId:1,entries,jobs:[],attempt:{stage:'dispatched'},owned:false,pendingPermission:false,requestIntent:false};
 const chrome={runtime:{id:'fixture',getURL:p=>'chrome-extension://fixture/'+p,onMessage:{addListener:f=>listener=f}},permissions:{getAll:()=>assert.fail('permission API not needed'),request:()=>assert.fail('must not request')},tabs:{},scripting:{executeScript:async({target,world,func,args})=>{execs++;assert.equal(target.tabId,1);assert.equal(world,'ISOLATED');assert.equal(func,schoolTitleEvidence);assert.deepEqual(JSON.parse(JSON.stringify(args)),[entries]);return[{result:{ok:true,schema:'career-queue-school-title-evidence-v1',jobs:[{schoolId:'900101',identityVerified:true}]}}];}}};
 runInNewContext(source,{chrome,crypto:{randomUUID:()=> 'fixture-id'},setTimeout,schoolTabBatchController,SCHOOL_ORIGIN,coversSchoolOrigin,schoolTitleEvidence,schoolTitleEvidenceRequest,schoolTrialState:()=>({load:async()=>structuredClone(saved),save:async()=>writes++}),schoolVisibleNavigation:()=>assert.fail('must not navigate'),schoolDetailReader:()=>assert.fail('must not read JD')});
 const reply=await new Promise(resolve=>listener({type:'school-batch-title-evidence',tabId:1},{id:'fixture',url:chrome.runtime.getURL('popup.html')},resolve));assert.equal(reply.ok,true);assert.equal(reply.data.batchId,'saved');assert.equal(execs,1);assert.equal(writes,0);assert.equal(saved.attempt.stage,'dispatched');
});
