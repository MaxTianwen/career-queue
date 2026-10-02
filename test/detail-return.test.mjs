import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

const app=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
const close=app.slice(app.indexOf("$('#detail').addEventListener('close'"),app.indexOf("document.addEventListener('keydown'"));
function fixture({oldConnected=false,rowVisible=true,reopened=false}={}){
 const focused=[];let handler;
 const button=(name,key,visible=true)=>({dataset:{key},getClientRects:()=>visible?[{}]:[],focus:()=>focused.push(name)});
 const old={...button('old','job'),isConnected:oldConnected};
 const other=button('other','other');
 const replacement=button('replacement','job',rowVisible);
 const dialog={open:reopened,dataset:{},addEventListener:(_,fn)=>{handler=fn;}};
 runInNewContext(`let detailRequest=0,detailContext={key:'job'},detailOpener=old,view='queue',detailReturnView='queue',detailReturnY=123;${close}`,{
  old,document:{querySelectorAll:()=>[other,replacement]},syncDetailSelection(){},matchMedia:()=>({matches:false}),
  $:s=>s==='#detail'?dialog:s==='#browse-list'?{focus:()=>focused.push('list')}:{hidden:false,classList:{remove(){}}}
 });
 return{close:()=>handler(),focused};
}
test('return restores the same visible job after a save rebuilt its list button',()=>{
 const f=fixture();f.close();assert.deepEqual(f.focused,['replacement']);
});
test('return keeps the original button when it is still connected',()=>{
 const f=fixture({oldConnected:true});f.close();assert.deepEqual(f.focused,['old']);
});
test('filtered-out or paged-out job falls back to the list, not a different job',()=>{
 const f=fixture({rowVisible:false});f.close();assert.deepEqual(f.focused,['list']);
});
test('a late close event does not steal focus from a newly opened detail',()=>{
 const f=fixture({reopened:true});f.close();assert.deepEqual(f.focused,[]);
});
