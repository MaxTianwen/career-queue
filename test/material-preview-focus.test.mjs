import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
const app=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
const source=app.slice(app.indexOf('async function previewFile('),app.indexOf('async function loadPreviewPage('));
function fixture({open=true,focused=false}={}) {
 let focuses=0,shows=0,renders=0;
 const close={focus:()=>focuses++},dialog={open,showModal:()=>shows++,querySelector:()=>close};
 const run=runInNewContext(`let previewSource,previewPage,previewPages,mode='live';${source};previewFile`,{
  URL,location:{origin:'http://localhost'},esc:String,loadPreviewPage:async()=>renders++,
  document:{activeElement:{closest:()=>focused?dialog:null}},
  $:s=>s==='#preview'?dialog:s==='#preview .close'?close:{}
 });
 return{run:()=>run({name:'resume.pdf',url:'/api/file?name=resume.pdf&version=resume-1-aaaaaaaa'}),counts:()=>({focuses,shows,renders})};
}
test('new version preview restores keyboard focus when replacing the editor opener',async()=>{
 const f=fixture();await f.run();assert.deepEqual(f.counts(),{focuses:1,shows:0,renders:1});
});
test('preview refresh preserves focus already within its surviving controls',async()=>{
 const f=fixture({focused:true});await f.run();assert.deepEqual(f.counts(),{focuses:0,shows:0,renders:1});
});
test('first preview keeps native modal opening focus behavior',async()=>{
 const f=fixture({open:false});await f.run();assert.deepEqual(f.counts(),{focuses:0,shows:1,renders:1});
});
