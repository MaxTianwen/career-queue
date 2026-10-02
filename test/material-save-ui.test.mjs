import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

const app=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
const editorSource=app.slice(app.indexOf('async function saveResumeEditor('),app.indexOf("$('#resume-review').addEventListener('change'"));
const reviewSource=app.slice(app.indexOf("$('#resume-review').addEventListener('submit'"),app.indexOf('function clearViewFilters('));
function fixture(kind,{previewFails=false}={}) {
 const pending=[],writes=[],alerts=[],status={textContent:''},button={disabled:false};
 const fields=[{dataset:{paragraph:'1',reviewGroup:'group'},value:kind==='editor'?'edited sentence':'apply',disabled:false}];
 const confirmed={checked:true,disabled:false};
 const form={id:`resume-${kind==='editor'?'edit':'review'}-form`,inert:false,elements:{confirmed},querySelector:()=>button,querySelectorAll:s=>s.includes('input,')?[...fields,button,confirmed]:fields};
 let handler,closed=0,previews=0,syncs=0;
 const dialog={dataset:{dirty:'true'},close:()=>closed++,addEventListener:(_,fn)=>handler=fn};
 const context={key:'job',version:'original',sourceHash:'hash'};
 const save=runInNewContext(kind==='editor'?`${editorSource};saveResumeEditor`:`${reviewSource};()=>handler`,{
  $:s=>['#resume-editor','#resume-review'].includes(s)?dialog:s==='#generate-result'?null:status,
  resumeEdit:context,resumeProposal:{key:'job'},detailContext:{key:'job'},
  api:(_,body)=>{writes.push(body);return new Promise((resolve,reject)=>pending.push({resolve,reject}));},
  syncGeneratedMaterials:async()=>syncs++,previewFile:async()=>{previews++;if(previewFails)throw Error('preview unavailable');},
  fileLinks:()=>'',alert:message=>alerts.push(message)
 });
 return{pending,writes,alerts,status,button,form,fields,dialog,closed:()=>closed,previews:()=>previews,syncs:()=>syncs,
  save:()=>kind==='editor'?save(form):handler({target:form,preventDefault(){},stopPropagation(){}})};
}
const result={validation:{pages:1},version:'new',files:[{name:'resume.pdf',url:'/api/file'}]};
for(const kind of ['editor','review']) {
 test(`${kind} saving locks its inputs and ignores duplicate saves`,async()=>{
  const f=fixture(kind),saving=f.save();
  assert.equal(f.fields[0].disabled,true,'inputs must not change after the submitted snapshot');
  assert.equal(f.form.elements.confirmed.disabled,true);assert.equal(f.button.disabled,true);
  await f.save();assert.equal(f.writes.length,1);
  f.pending[0].resolve(result);await saving;
  assert.equal(f.closed(),1);assert.equal(f.dialog.dataset.dirty,undefined);assert.equal(f.fields[0].disabled,false);
 });
 test(`${kind} failed save preserves choices and restores editing for retry`,async()=>{
  const f=fixture(kind),value=f.fields[0].value,saving=f.save();f.pending[0].reject(Error('offline'));await saving;
  assert.equal(f.closed(),0);assert.equal(f.dialog.dataset.dirty,'true');assert.equal(f.form.inert,false);assert.equal(f.fields[0].value,value);
  assert.equal(f.fields[0].disabled,false);assert.equal(f.button.disabled,false);
  const retry=f.save();assert.equal(f.fields[0].disabled,true);f.pending[1].resolve(result);await retry;
  assert.equal(f.writes.length,2);assert.equal(f.closed(),1);
 });
 test(`${kind} published material is not reported as a failed write when preview fails`,async()=>{
  const f=fixture(kind,{previewFails:true}),saving=f.save();f.pending[0].resolve(result);await saving;
  assert.equal(f.closed(),1);assert.equal(f.dialog.dataset.dirty,undefined);assert.equal(f.writes.length,1);
  assert.equal(f.alerts.length,1);assert.match(f.alerts[0],/已.*(保存|生成)/);assert.doesNotMatch(f.status.textContent,/未发布/);
 });
}
