import { inQueue, schoolMaterialsForm } from '../web/school-materials-view.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
const app=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
const source=app.slice(app.indexOf('async function refreshAssessmentDetail('),app.indexOf('function showModal('));
function fixture({dirty=false,sourceName='queue'}={}){
 const dialog={open:true,dataset:{...(dirty?{dirty:'true'}:{})}},pending=[];
 let reads=0,renders=0;
 const state=runInNewContext(`let detailContext={key:'job',source:sourceName},selected={key:'job'},jobs=[],searchState={report:{results:[{key:'job'}]}};${source};({refreshAssessmentDetail,leave:()=>detailContext={key:'other',source:sourceName}})`,{
  sourceName,$:()=>dialog,
  deferDetailRefresh:()=>{if(!dialog.dataset.dirty)return false;dialog.dataset.refreshPending='true';return true;},
  detail:async()=>{reads++;return true;},render:()=>renders++,renderSearch:()=>renders++,searchDetail:()=>renders++,
  api:()=>{reads++;return new Promise(resolve=>pending.push(resolve));}
 });
 return{...state,dialog,pending,reads:()=>reads,renders:()=>renders};
}
for(const sourceName of ['queue','discovery'])test(`${sourceName} background refresh preserves dirty forms without reading or rendering`,async()=>{
 const f=fixture({sourceName,dirty:true});assert.equal(await f.refreshAssessmentDetail(),false);
 assert.equal(f.reads(),0);assert.equal(f.renders(),0);assert.equal(f.dialog.dataset.refreshPending,'true');
});
test('discovery input entered during a read prevents the arriving response from replacing it',async()=>{
 const f=fixture({sourceName:'discovery'}),read=f.refreshAssessmentDetail();
 f.dialog.dataset.dirty='true';f.pending[0]({key:'job'});assert.equal(await read,false);assert.equal(f.renders(),0);
});
test('clean deferred discovery refresh clears the pending flag and renders latest data',async()=>{
 const f=fixture({sourceName:'discovery'});f.dialog.dataset.refreshPending='true';const read=f.refreshAssessmentDetail();
 f.pending[0]({key:'job'});assert.equal(await read,true);assert.equal(f.dialog.dataset.refreshPending,undefined);assert.equal(f.renders(),2);
});
const syncSource=app.slice(app.indexOf('async function syncGeneratedMaterials('),app.indexOf('async function detail(key)'));
function materialFixture({dirty=false,fails=false,school=false}={}){
 const panel={innerHTML:'existing upload inputs'},form={dataset:{...(dirty?{dirty:'true'}:{})}},dialog={dataset:{}},selected={key:'job',generatedMaterial:{version:'old'}};
 const run=runInNewContext(`${syncSource};syncGeneratedMaterials`,{
  selected,schoolMaterialsForm,$:s=>s==='#material-panel'?panel:s===(school?'#school-materials-form':'#materials-form')?form:dialog,
  api:async()=>{if(fails)throw Error('offline');return{generatedMaterial:{version:'new'}};},
  deferDetailRefresh:()=>{dialog.dataset.refreshPending='true';return true;},materialForm:()=> 'new material form',esc:String
 });
 return{panel,selected,dialog,run:()=>run('job')};
}
for(const fails of [false,true])test(`material ${fails?'failed':'successful'} refresh preserves a dirty upload form`,async()=>{
 const f=materialFixture({dirty:true,fails});await f.run();
 assert.equal(f.panel.innerHTML,'existing upload inputs');assert.equal(f.selected.generatedMaterial.version,'old');assert.equal(f.dialog.dataset.refreshPending,'true');
});
test('material refresh updates an unedited form normally',async()=>{
 const f=materialFixture({});await f.run();assert.equal(f.panel.innerHTML,'new material form');assert.equal(f.selected.generatedMaterial.version,'new');
});

for(const fails of [false,true])test(`school material ${fails?'failed':'successful'} refresh preserves its unsaved review`,async()=>{
 const f=materialFixture({dirty:true,fails,school:true});await f.run();
 assert.equal(f.panel.innerHTML,'existing upload inputs');assert.equal(f.selected.generatedMaterial.version,'old');assert.equal(f.dialog.dataset.refreshPending,'true');
});
