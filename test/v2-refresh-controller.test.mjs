import test from 'node:test';
import assert from 'node:assert/strict';
import {refreshController} from '../web/v2/refresh-controller.js';
import {mountFilters} from '../web/v2/opportunity.js';
test('entry controller returns before source completion, coalesces clicks, updates on completion and stops polling',async()=>{
 let requests=0,updates=0,release,running=true,timer=null;const changes=[];
 const controller=refreshController({request:()=>{requests++;return new Promise(resolve=>release=resolve);},status:async()=>({running}),updated:async()=>{updates++;},changed:data=>changes.push(data),setTimer:fn=>(timer=fn,1),clearTimer:()=>timer=null});
 const first=controller.refresh('open');assert.equal(controller.refresh('manual'),first);assert.equal(requests,1);assert.equal(updates,0);release();await first;assert.ok(timer);running=false;const tick=timer;timer=null;await tick();assert.equal(updates,1);controller.stop();assert.equal(timer,null);
});
test('entry controller logout invalidates late results without clearing cached content or starting another search',async()=>{
 let release,updates=0,timer=null;const changes=[];const c=refreshController({request:()=>new Promise(resolve=>release=resolve),status:async()=>({running:true}),updated:async()=>updates++,changed:v=>changes.push(v),setTimer:fn=>(timer=fn,1),clearTimer:()=>timer=null});
 const p=c.refresh('open');c.stop();release();await p;assert.equal(updates,0);assert.equal(timer,null);assert.equal(changes.length,1);
});
test('entry controller network error preserves old data and permits explicit retry',async()=>{
 let fail=true,updates=0;const changes=[];const c=refreshController({request:async()=>{if(fail)throw Error('Synthetic offline');},status:async()=>({running:false}),updated:async()=>updates++,changed:v=>changes.push(v)});
 await c.refresh('open');assert.equal(updates,0);assert.match(changes.at(-1).error,/offline/);fail=false;await c.refresh('manual');assert.equal(updates,1);c.stop();
});
test('entry controller bounds status polling without inventing completion',async()=>{
 let time=0,timer,updated=0;const states=[];const c=refreshController({request:async()=>{},status:async()=>({running:true}),updated:async()=>updated++,changed:s=>states.push(s),now:()=>time,setTimer:fn=>(timer=fn,1),clearTimer:()=>timer=null});
 await c.refresh('open');time=13*60*1000;const tick=timer;timer=null;await tick();assert.equal(timer,null);assert.equal(updated,0);assert.ok(states.at(-1).error);c.stop();
});
test('editorial secondary filters remain in DOM, accessible to filtering and reset',()=>{
 const oldDoc=globalThis.document,oldOption=globalThis.Option;
 class Node{constructor(tag){this.tag=tag;this.children=[];this.events={};this.value='';}append(...children){this.children.push(...children);}add(child){this.children.push(child);}addEventListener(k,fn){this.events[k]=fn;}querySelectorAll(){return this.children.flatMap(c=>c instanceof Node?[...(['input','select'].includes(c.tag)?[c]:[]),...c.querySelectorAll()]:[]);}}
 globalThis.document={createElement:tag=>new Node(tag)};globalThis.Option=class {constructor(text,value){this.text=text;this.value=value;}};
 try{const root=new Node('div'),read=mountFilters(root,()=>{}),extra=root.children.find(c=>c.tag==='details');assert.ok(extra);assert.equal(extra.children[0].tag,'summary');assert.deepEqual(extra.children.filter(c=>c.tag==='label').flatMap(c=>c.children.filter(x=>x.tag==='select').map(x=>x.name)),['source','platform']);
 const month=root.querySelectorAll().find(c=>c.name==='months');month.value='8';assert.equal(read().months,'8');root.children.find(c=>c.tag==='button').events.click();assert.equal(read().months,'');
 }finally{globalThis.document=oldDoc;globalThis.Option=oldOption;}
});
