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


test('additional Greenhouse sections preserve requirement flags but omit hidden fields and flag consent', async () => {
  const result=await readGreenhouseForm(url,async()=>Response.json({...data,
    location_questions:[{label:'Location',required:true,fields:[{type:'input_text'}]},{label:'Latitude',required:true,fields:[{type:'input_hidden'}]}],
    compliance:[{label:'Disclosure',required:false,fields:[{type:'multi_value_single_select',values:[{label:'Decline'}]}]}],
    demographic_questions:{questions:[{label:'Self description',required:false,type:'multi_value_single_select',answer_options:[{label:'Other',free_form:true}]}]},
    data_compliance:[{requires_consent:true}]}));
  assert.equal(result.questions.length,5);assert.equal(result.questions[2].section,'地址信息');
  assert.equal(result.questions[3].required,false);assert.match(result.questions[4].fields[0].options[0],/可补充文字/);
  assert.equal(result.questions.some(q=>q.label==='Latitude'),false);assert.equal(result.warnings.length,2);
});
test('malformed optional sections keep main questions and visibly report missing coverage', async () => {
  const result=await readGreenhouseForm(url,async()=>Response.json({...data,location_questions:{},compliance:[null],demographic_questions:{questions:[{label:'Unknown'}]}}));
  assert.equal(result.questions.length,2);assert.equal(result.warnings.length,3);
});


test('actual nested compliance groups are flattened without changing optional flags', async () => {
  const result=await readGreenhouseForm(url,async()=>Response.json({...data,compliance:[{type:'eeoc',description:'Read on official site',questions:[{label:'VeteranStatus',required:false,fields:[{type:'multi_value_single_select',values:[{label:'Decline'}]}]}]}]}));
  assert.equal(result.questions.at(-1).section,'合规披露');assert.equal(result.questions.at(-1).required,false);assert.deepEqual(result.warnings,[]);
});
