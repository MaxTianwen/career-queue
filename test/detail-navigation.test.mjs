import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
const app=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
const controller=app.slice(app.indexOf('async function detail(key)'),app.indexOf('const select ='));
function fixture(){
  const pending=[], dialog={dataset:{},inert:false}, body={innerHTML:''}; let shown=0;
  const helpers=Object.fromEntries(['directionBadge','jobHighlights','skillHighlights','sourceLinks','fieldEvidenceView','assessmentPanel','scoreDetails','resumeControls','portalPanel','jobDescription','fileLinks','materialForm','freshnessReview'].map(name=>[name,()=> '']));
  const api=()=>new Promise((resolve,reject)=>pending.push({resolve,reject}));
  const f=runInNewContext(`let detailRequest=0,view='queue',mode='live',selected,detailContext;${controller};({detail,invalidate:()=>detailRequest++,navigate:()=>view='resumes',switchMode:()=>mode='demo',selected:()=>selected})`,{
    ...helpers,api,esc:String,safeUrl:String,publicationText:()=>'',modeText:()=>'',showDetailSurface:()=>{shown++;dialog.inert=false;},$:s=>s==='#detail'?dialog:body
  });
  return {...f,pending,dialog,body,shown:()=>shown};
}
const job=key=>({key,company:'Example',title:key,term:'Summer 2027',status:'Queue',url:'https://example.com',localFiles:[],reasons:[]});
test('split detail keeps the newest job when responses arrive out of order',async()=>{
 const f=fixture(),a=f.detail('first'),b=f.detail('second');
 f.pending[1].resolve(job('second'));await b;f.pending[0].resolve(job('first'));await a;
 assert.equal(f.selected().key,'second');assert.equal(f.shown(),1);assert.equal(f.dialog.inert,false);
});
for(const action of ['navigate','switchMode','invalidate'])test(`detail response cannot reopen after ${action}`,async()=>{
 const f=fixture(),loading=f.detail('old');f[action]();f.pending[0].resolve(job('old'));
 assert.equal(await loading,false);assert.equal(f.shown(),0);assert.equal(f.selected(),undefined);
});
test('a failed detail read releases its temporary interaction lock',async()=>{
 const f=fixture(),loading=f.detail('missing');assert.equal(f.dialog.inert,true);
 f.pending[0].reject(new Error('offline'));await assert.rejects(loading,/offline/);assert.equal(f.dialog.inert,false);
});
test('an older failed request cannot unlock the newer detail still loading',async()=>{
 const f=fixture(),a=f.detail('first'),b=f.detail('second');
 f.pending[0].reject(new Error('offline'));await assert.rejects(a,/offline/);assert.equal(f.dialog.inert,true);
 f.pending[1].resolve(job('second'));await b;assert.equal(f.dialog.inert,false);
});
// The navigation guard is exercised before any API or DOM replacement.
const guard=app.slice(app.indexOf('async function handle(action, button)'),app.indexOf("  if (action === 'recheck-availability')"))+"return 'proceed';}";
function navigationGuard({dirty=false,saving=false,confirm=true}={}){
 let confirmations=0,focuses=0;
 const dialog={open:true,dataset:{...(dirty?{dirty:'true'}:{}),...(saving?{saving:'true'}:{})}};
 const handle=runInNewContext(`let detailContext={key:'current',source:'queue'},detailRequest=0,detailOpener;${guard};handle`,{
  $:s=>s==='#detail'?dialog:{focus:()=>focuses++},confirm:()=>{confirmations++;return confirm;}
 });
 return{handle,confirmations:()=>confirmations,focuses:()=>focuses};
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
