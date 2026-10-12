import {createHash} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {readFileSync} from 'node:fs';
import {schoolDiagnostic} from '../browser-extension/school-diagnostic.js';
import {readSchoolDiagnostic,diagnosticFailure} from '../browser-extension/school-diagnostic-client.js';
const node=(value,tagName='TD')=>({value,tagName,getClientRects:()=>[{}],closest:()=>null,querySelectorAll:()=>[]});
function run({headings=[],rows=[],sections=[],frames=[],auth=[]}={},kind='list',fn=schoolDiagnostic){
 const document={querySelectorAll:s=>s.startsWith('input[')?auth:s.includes('legend')?headings:s==='tr,[role=row]'?rows:s==='iframe'?frames:s==='h1,h2,h3,h4,dt'?sections:[],createTreeWalker:e=>{let done=false;return{nextNode:()=>done?null:(done=true,{parentElement:e,textContent:e.value})}}};
 Object.defineProperty(document,'cookie',{get(){throw Error('Forbidden cookie read')}});
 return runInNewContext('('+fn.toString()+')('+JSON.stringify(kind)+')',{document,location:{protocol:'https:',origin:'https://portal.example',href:'https://portal.example/jobs?session=secret'},NodeFilter:{SHOW_TEXT:4},getComputedStyle:()=>({visibility:'visible'}),URL,Date});
}
test('serialized injected function accepts a job table with no semantic heading (0.1.3 regression)',()=>{
 const packet=run({rows:[node('123456 Software Intern Example Work Term Summer 2027')]});
 assert.equal(packet.schema,'career-queue-school-diagnostic-v1');assert.equal(packet.rows.length,1);
 assert.doesNotMatch(JSON.stringify(packet),/secret/);
});
test('detail h4 and dt sections work without h1-h3',()=>{
 const h=node('Job Description','DT');h.nextElementSibling=node('Build software tools','DD');
 const packet=run({sections:[h]},'detail');assert.equal(packet.sections[0].text,'Build software tools');
});
test('empty top frame, iframe-only content, visible auth and DOM failure return safe distinct codes',()=>{
 assert.equal(run().code,'NO_JOB_STRUCTURE');assert.equal(run({frames:[node('')]}).code,'FRAME_CONTENT_UNREAD');
 assert.equal(run({auth:[node('')]}).code,'VISIBLE_AUTH_CHALLENGE');
 const h=node('Job Postings');h.getClientRects=()=>{throw Error('secret account token')};
 assert.equal(run({headings:[h]}).code,'DOM_READ_FAILED');
});
const packet=()=>run({rows:[node('123456 Software Intern Work Term Summer 2027')]});
function api(execute){return{tabs:{query:async()=>[{id:7,url:'https://portal.example/jobs'}]},scripting:{executeScript:execute}};}
test('extension API uses serialized function, isolated main frame and validated result',async()=>{
 const result=await readSchoolDiagnostic(api(async options=>{assert.equal(options.world,'ISOLATED');assert.deepEqual(options.target,{tabId:7});assert.deepEqual(options.args,['list']);return[{frameId:0,result:packet()}];}),schoolDiagnostic,'list');assert.equal(result.rows.length,1);
});
test('browser denial, rejected injection, missing frame, execution error and invalid packet stay distinct and redact raw errors',async()=>{
 for(const [execute,code]of [
  [async()=>{throw Error('Cannot access contents https://private.example/?token=secret')},'INJECTION_DENIED'],
  [async()=>{throw Error('Unknown secret')},'INJECTION_FAILED'],
  [async()=>[],'NO_FRAME_RESULT'],[async()=>[{frameId:0,error:'secret'}],'EXECUTION_FAILED'],
  [async()=>[{frameId:0,result:{schema:'wrong',secret:'private'}}],'INVALID_RESULT'],
  [async()=>[{frameId:0,result:run({frames:[node('')]})}],'FRAME_CONTENT_UNREAD']]){
   await assert.rejects(readSchoolDiagnostic(api(execute),schoolDiagnostic,'list'),e=>{assert.equal(e.code,code);assert.doesNotMatch(diagnosticFailure(e),/secret|private\.example/);return true;});
 }
});
test('tab query, HTTPS preflight and download failures never claim the user logged out',async()=>{
 const a=api(()=>{});a.tabs.query=async()=>{throw Error('secret')};await assert.rejects(readSchoolDiagnostic(a,schoolDiagnostic,'list'),{code:'TAB_QUERY_FAILED'});
 a.tabs.query=async()=>[{id:7,url:'brave://extensions'}];await assert.rejects(readSchoolDiagnostic(a,schoolDiagnostic,'list'),{code:'HTTPS_REQUIRED'});
 assert.match(diagnosticFailure(Error('secret')),/DOWNLOAD_FAILED/);assert.doesNotMatch(diagnosticFailure(Error('secret')),/secret/);
});
test('popup download remains local, and Greenhouse workflow is preserved',()=>{
 const popup=readFileSync('browser-extension/popup.js','utf8');assert.match(popup,/new Blob/);assert.match(popup,/download\.click\(\)/);assert.match(popup,/JSON.stringify\(packet,null,2\)/);

 const start=s=>s.slice(s.indexOf("import {pageFields}"),s.indexOf('let diagnosticBusy'));
 assert.equal(createHash('sha256').update(start(popup).replaceAll('\r\n','\n')).digest('hex'),'79e25adc3149f358d4c7adb524c59aa30d6e28ecf5ad7a294bc02e6427e482fd');
});

test('popup click writes only a validated packet to a local Blob and retains a fallback link',async()=>{
 const nodes=new Map();let clicked=0,blob=null;
 const get=id=>{if(!nodes.has(id))nodes.set(id,{hidden:true,events:{},addEventListener(k,fn){this.events[k]=fn;},click(){clicked++;}});return nodes.get(id);};
 const source=readFileSync('browser-extension/popup.js','utf8').replace(/^import .*;\r?\n/gm,'');
 const chrome=api(async()=>[{frameId:0,result:packet()}]);
 runInNewContext(source,{document:{getElementById:get},chrome,schoolDiagnostic,schoolVisibleNavigation:()=>{},readSchoolDiagnostic,diagnosticFailure,pageFields(){},Blob,URL:{createObjectURL(value){blob=value;return 'blob:local-fixture';},revokeObjectURL(){}}});
 await get('school-list').events.click();
 assert.equal(clicked,1);assert.equal(get('school-download').hidden,false);assert.equal(get('school-download').download,'career-queue-school-list-diagnostic.json');
 assert.equal(JSON.parse(await blob.text()).schema,'career-queue-school-diagnostic-v1');
 chrome.scripting.executeScript=async()=>[{frameId:0,result:{schema:'wrong'}}];
 await get('school-detail').events.click();assert.equal(clicked,1);assert.equal(get('school-download').hidden,true);assert.match(get('school-diagnostic-status').textContent,/INVALID_RESULT/);
});
