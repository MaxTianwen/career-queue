import test from 'node:test';
import assert from 'node:assert/strict';
import { rehearsalFields } from '../src/v2/fill-rehearsal.mjs';

test('rehearsal allows only selected unique contact text; never guesses sensitive answers', () => {
  const question = (label, type='input_text', section='申请问题') => ({label,section,required:true,fields:[{type,options:[]}]});
  const questions=[question('First Name'),question('Email'),question('Work authorization'),question('Gender','input_text','自我披露'),question('Resume','input_file'),question('Phone'),question('Phone'),question('Website'),question('Last Name')];
  const answers=questions.map(()=>({selected:true,answer:'Synthetic'}));answers[7].selected=false;answers[8].answer='';
  const plan=rehearsalFields({form:{questions},answers});
  assert.deepEqual(plan.fields.map(f=>f.label),['First Name','Email']);
  assert.equal(plan.manual.length,7);
  assert.equal(JSON.stringify(plan.manual).includes('Synthetic'),false);
});
