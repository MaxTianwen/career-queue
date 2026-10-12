import test from 'node:test';
import assert from 'node:assert/strict';
import {viewLoader} from '../web/v2/page-stability.js';
test('session views coalesce inflight, reuse fresh DOM and refresh after expiry or force',async()=>{
 let now=0,calls=0,release;const cache=viewLoader({now:()=>now,maxAge:100});const load=()=>{calls++;return new Promise(r=>release=r)};
 const first=cache.run('jobs',load);await Promise.resolve();assert.equal(cache.run('jobs',load),first);release();await first;await cache.run('jobs',load);assert.equal(calls,1);
 now=101;const stale=cache.run('jobs',load);await Promise.resolve();assert.equal(calls,2);release();await stale;const forced=cache.run('jobs',load,{force:true});await Promise.resolve();assert.equal(calls,3);release();await forced;
});
test('writes/logout invalidate late reads and a prior request cannot overwrite a new account view',async()=>{
 const cache=viewLoader();let oldDone,newDone,shown='';const old=cache.run('jobs',async current=>{await new Promise(r=>oldDone=r);if(current())shown='old account'});await Promise.resolve();cache.invalidate();const fresh=cache.run('jobs',async current=>{await new Promise(r=>newDone=r);if(current())shown='new account'});await Promise.resolve();newDone();await fresh;oldDone();await old;assert.equal(shown,'new account');
});
test('failed background reads preserve existing DOM state and can retry immediately',async()=>{
 const cache=viewLoader();let shown='existing',calls=0;await assert.rejects(cache.run('jobs',async()=>{calls++;throw Error('offline')}));assert.equal(shown,'existing');await cache.run('jobs',async current=>{calls++;if(current())shown='updated'});assert.equal(shown,'updated');assert.equal(calls,2);
});
test('targeted discovery completion invalidates discovery only',async()=>{const cache=viewLoader();let a=0,b=0;await cache.run('discovery',async()=>a++);await cache.run('school',async()=>b++);cache.invalidate('discovery');await cache.run('discovery',async()=>a++);await cache.run('school',async()=>b++);assert.equal(a,2);assert.equal(b,1);});
