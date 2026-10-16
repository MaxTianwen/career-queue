import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {waitForDevToolsPort} from '../scripts/helpers/browser-devtools.mjs';
const setup=async()=>({profile:await mkdtemp(join(tmpdir(),'cq-devtools-')),child:Object.assign(new EventEmitter(),{exitCode:null,signalCode:null})});
test('DevTools discovery works without stderr and waits for complete valid file',async()=>{
 const {profile,child}=await setup();const result=waitForDevToolsPort(profile,child,{timeoutMs:2000,intervalMs:5});
 await writeFile(join(profile,'DevToolsActivePort'),'1234\n');
 setTimeout(()=>writeFile(join(profile,'DevToolsActivePort'),'1234\r\n/devtools/browser/test-id\r\n'),30);
 assert.equal(await result,1234);assert.equal(child.listenerCount('error'),0);
});
test('invalid ports or endpoint paths cannot connect to unrelated services',async()=>{
 for(const text of ['0\n/devtools/browser/x','65536\n/devtools/browser/x','1234x\n/devtools/browser/x','1234\nhttp://external.invalid']){
 const {profile,child}=await setup();await writeFile(join(profile,'DevToolsActivePort'),text);
 await assert.rejects(waitForDevToolsPort(profile,child,{timeoutMs:20,intervalMs:5}),/Timed out/);}
});
test('missing startup file times out and releases listeners',async()=>{
 const {profile,child}=await setup();await assert.rejects(waitForDevToolsPort(profile,child,{timeoutMs:20,intervalMs:5}),/Timed out/);assert.equal(child.listenerCount('error'),0);
});
test('browser exit and launch errors fail clearly without waiting for timeout',async()=>{
 const {profile,child}=await setup();child.exitCode=1;await assert.rejects(waitForDevToolsPort(profile,child),/exited/);
 child.exitCode=null;const result=waitForDevToolsPort(profile,child,{intervalMs:5});child.emit('error',Error('ENOENT'));await assert.rejects(result,/failed to start: ENOENT/);
});
test('discovery reads only the requested fresh profile',async()=>{
 const first=await setup(),second=await setup();await writeFile(join(first.profile,'DevToolsActivePort'),'4321\n/devtools/browser/old');
 await assert.rejects(waitForDevToolsPort(second.profile,second.child,{timeoutMs:20,intervalMs:5}),/Timed out/);
});
test('a successful browser launcher may exit before the browser writes its port',async()=>{
 const {profile,child}=await setup();child.exitCode=0;await writeFile(join(profile,'DevToolsActivePort'),'1234\n/devtools/browser/launched');
 assert.equal(await waitForDevToolsPort(profile,child,{timeoutMs:200}),1234);
});
