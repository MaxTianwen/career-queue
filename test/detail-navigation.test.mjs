import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import { workplaceBadge } from '../web/job-summary.js';
const app=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
const controller=app.slice(app.indexOf('async function detail(key)'),app.indexOf('const select ='));
function fixture(){
  const pending=[], messages=[], dialog={dataset:{},inert:false}, body={innerHTML:''}; let shown=0;
  const helpers=Object.fromEntries(['directionBadge','jobHighlights','skillHighlights','sourceLinks','fieldEvidenceView','assessmentPanel','scoreDetails','resumeControls','portalPanel','jobDescription','fileLinks','materialForm','freshnessReview'].map(name=>[name,()=> '']));
  const api=()=>new Promise((resolve,reject)=>pending.push({resolve,reject}));
  const f=runInNewContext(`let detailRequest=0,view='queue',mode='live',selected,detailContext;${controller};({detail,invalidate:()=>detailRequest++,navigate:()=>view='resumes',switchMode:()=>mode='demo',selected:()=>selected})`,{
    ...helpers,workplaceBadge,api,esc:String,safeUrl:String,publicationText:()=>'',modeText:()=>'',deferDetailRefresh:()=>Boolean(dialog.dataset.dirty),document:{activeElement:{closest:()=>dialog}},detailFeedback:(key,error)=>messages.push({key,error:error?.message}),showDetailSurface:()=>{shown++;dialog.inert=false;},$:s=>s==='#detail'?dialog:body
  });
  return {...f,pending,messages,dialog,body,shown:()=>shown};
}
const job=key=>({key,company:'Example',title:key,term:'Summer 2027',status:'Queue',url:'https://example.com',localFiles:[],reasons:[]});
test('split detail keeps the newest job when responses arrive out of order',async()=>{
 const f=fixture(),a=f.detail('first'),b=f.detail('second');
 f.pending[1].resolve(job('second'));await b;f.pending[0].resolve(job('first'));await a;
 assert.equal(f.selected().key,'second');assert.equal(f.shown(),1);assert.equal(f.dialog.inert,false);
});
for(const action of ['navigate','switchMode','invalidate'])test(`detail response cannot reopen after ${action}`,async()=>{
 const f=fixture(),loading=f.detail('old');f[action]();f.pending[0].resolve(job('old'));
 assert.equal(await loading,false);assert.equal(f.shown(),0);assert.equal(f.selected(),null);
});
test('loading names the requested job and immediately clears the previous selection',async()=>{
 const f=fixture(),a=f.detail('first');f.pending[0].resolve(job('first'));await a;
 const b=f.detail('second');assert.equal(f.selected(),null);assert.equal(f.messages.at(-1).key,'second');
 f.pending[1].resolve(job('second'));await b;assert.equal(f.dialog.dataset.state,'ready');
});
test('a failed detail read shows a local error without leaving the old job actionable',async()=>{
 const f=fixture(),loading=f.detail('missing');f.pending[0].reject(new Error('offline'));
 assert.equal(await loading,false);assert.equal(f.messages.at(-1).error,'offline');assert.equal(f.selected(),null);
});
test('an older failed request cannot replace the newer job loading message',async()=>{
 const f=fixture(),a=f.detail('first'),b=f.detail('second');
 f.pending[0].reject(new Error('offline'));await a;assert.equal(f.messages.at(-1).key,'second');assert.equal(f.messages.at(-1).error,undefined);
 f.pending[1].resolve(job('second'));await b;assert.equal(f.selected().key,'second');
});
test('retry reads the same job and replaces the failure with fresh detail',async()=>{
 const f=fixture(),a=f.detail('job');f.pending[0].reject(new Error('offline'));await a;
 const b=f.detail('job');f.pending[1].resolve(job('job'));assert.equal(await b,true);assert.equal(f.selected().key,'job');
});
test('late failure after navigating away does not reopen an error',async()=>{
 const f=fixture(),a=f.detail('job');f.navigate();f.pending[0].reject(new Error('offline'));await a;
 assert.equal(f.messages.length,1);assert.equal(f.shown(),0);
});
test('automatic reread of the current job does not destroy edited detail',async()=>{
 const f=fixture(),first=f.detail('job');f.pending[0].resolve(job('job'));await first;
 f.dialog.open=true;f.dialog.dataset.dirty='true';const html=f.body.innerHTML;
 assert.equal(await f.detail('job'),false);assert.equal(f.pending.length,1);
 assert.equal(f.body.innerHTML,html);assert.equal(f.selected().key,'job');
});
// The navigation guard is exercised before any API or DOM replacement.
const guard=app.slice(app.indexOf('async function handle(action, button)'),app.indexOf("  if (action === 'recheck-availability')"))+"return 'proceed';}";
function navigationGuard({dirty=false,saving=false,confirm=true}={}){
 let confirmations=0,focuses=0,refreshes=0;
 const dialog={open:true,dataset:{...(dirty?{dirty:'true'}:{}),...(saving?{saving:'true'}:{})}};
 const handle=runInNewContext(`let window={scrollY:100},view='queue',detailReturnY=0,detailReturnView='',detailContext={key:'current',source:'queue'},detailRequest=0,detailOpener;${guard};handle`,{
  $:s=>s==='#detail'?dialog:{focus:()=>focuses++},confirm:()=>{confirmations++;return confirm;},refreshAssessmentDetail:async()=>{refreshes++;return 'refreshed';}
 });
 return{handle,dialog,refreshes:()=>refreshes,confirmations:()=>confirmations,focuses:()=>focuses};
}
test('cancelled navigation preserves unsaved detail and does not proceed',async()=>{
 const f=navigationGuard({dirty:true,confirm:false});assert.equal(await f.handle('detail',{dataset:{key:'next'}}),undefined);assert.equal(f.confirmations(),1);
});
test('confirmed navigation can leave an edited detail',async()=>{
 const f=navigationGuard({dirty:true});assert.equal(await f.handle('queue',{}),'proceed');assert.equal(f.confirmations(),1);
});
test('clicking the same job only focuses it, preserving unsaved inputs',async()=>{
 const f=navigationGuard({dirty:true});assert.equal(await f.handle('detail',{dataset:{key:'current'}}),undefined);assert.equal(f.focuses(),1);assert.equal(f.confirmations(),0);
});
test('a pending detail form save blocks switching jobs or workspace',async()=>{
 const f=navigationGuard({saving:true});for(const action of ['detail','search-detail','queue','mode','search'])assert.equal(await f.handle(action,{dataset:{key:'other'}}),undefined);assert.equal(f.confirmations(),0);
});
test('same key from another source still protects dirty inputs',async()=>{
 const f=navigationGuard({dirty:true,confirm:false});assert.equal(await f.handle('search-detail',{dataset:{key:'current'}}),undefined);assert.equal(f.confirmations(),1);
});
test('cancelling deferred refresh keeps dirty input without issuing a read',async()=>{
 const f=navigationGuard({dirty:true,confirm:false});await f.handle('refresh-detail',{});
 assert.equal(f.refreshes(),0);assert.equal(f.dialog.dataset.dirty,'true');
});
test('explicitly discarding pending input allows a fresh read of the current context',async()=>{
 const f=navigationGuard({dirty:true});assert.equal(await f.handle('refresh-detail',{}),'refreshed');
 assert.equal(f.refreshes(),1);assert.equal(f.dialog.dataset.dirty,undefined);assert.equal(f.confirmations(),1);
});
