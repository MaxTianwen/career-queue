import test from 'node:test';
import assert from 'node:assert/strict';
import { readGreenhouseForm } from '../src/v2/greenhouse-form.mjs';
const url = 'https://job-boards.greenhouse.io/example/jobs/123';
const data = {id:123,title:'Intern',questions:[{label:'Resume',required:true,fields:[{type:'input_file'},{type:'textarea'}]},{label:'Choice',required:false,fields:[{type:'multi_value_single_select',values:[{label:'Yes'},{label:'No'}]}]}]};
test('Greenhouse application questions use only public GET and preserve grouped requirements', async () => {
  let calls=0;
  const result=await readGreenhouseForm(url+'?tracking=private',async (source,options)=>{calls++;assert.equal(source,'https://boards-api.greenhouse.io/v1/boards/example/jobs/123?questions=true');assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.body,undefined);return Response.json(data);});
  assert.equal(calls,1);assert.equal(result.questions[0].fields.length,2);assert.equal(result.questions[0].required,true);assert.equal(result.questions[1].required,false);assert.deepEqual(result.questions[1].fields[0].options,['Yes','No']);
});
test('Greenhouse form rejects unsafe URLs before network and rejects missing or mismatched questions', async () => {
  for(const value of ['http://job-boards.greenhouse.io/example/jobs/123','https://job-boards.greenhouse.io.evil.test/example/jobs/123','https://user:secret@job-boards.greenhouse.io/example/jobs/123','https://job-boards.greenhouse.io:444/example/jobs/123','https://127.0.0.1/example/jobs/123']) await assert.rejects(readGreenhouseForm(value,()=>{throw Error('must not fetch');}),/本期仅支持/);
  for(const value of [{...data,id:456},{...data,questions:[]},{...data,questions:[{required:true,fields:[]}]}]) await assert.rejects(readGreenhouseForm(url,async()=>Response.json(value)));
  await assert.rejects(readGreenhouseForm(url,async()=>new Response('',{status:404})),/404/);
  await assert.rejects(readGreenhouseForm(url,async()=>new Response('x'.repeat(2000001))),/过大/);
});
