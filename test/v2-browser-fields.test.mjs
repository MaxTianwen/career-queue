import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {pageFields} from '../browser-extension/page-fields.js';

function fixture() {
  class Input {
    constructor(label,type='text') {this.labels=[{textContent:label}];this.type=type;this.id='first_name';this.isConnected=true;this.disabled=false;this.readOnly=false;this.stored='';this.role=null;this.events=[];}
    get value(){return this.stored;} set value(v){this.stored=v;}
    getClientRects(){return this.hidden?[]:[{}];} getAttribute(){return this.role;}
    dispatchEvent(e){this.events.push(e.type);this.onEvent?.(e);}
  }
  const input=new Input('First Name*'),inputs=[input],frames=[];
  const context={location:{href:'https://job-boards.greenhouse.io/test/jobs/123'},URL,HTMLInputElement:Input,Event,
    getComputedStyle:()=>({visibility:'visible'}),document:{querySelectorAll:selector=>selector==='input'?inputs:selector==='iframe'?frames:inputs.filter(i=>i.type==='password')}};
  const fields=[{index:0,label:'First Name',answer:'Synthetic'}];
  const call=(mode,expected)=>runInNewContext(`(${pageFields.toString()})(mode,url,fields,expected)`,{...context,mode,url:context.location.href,fields,expected});
  return {input,inputs,Input,context,fields,call};
}
test('browser page adapter fills only matching blank text and emits input/change, never submission',()=>{
  const f=fixture(),p=f.call('preview');assert.equal(f.input.value,'');
  assert.equal(f.call('fill',p.bindings).filled,1);assert.equal(f.input.value,'Synthetic');assert.deepEqual(f.input.events,['input','change']);
  assert.throws(()=>f.call('fill',p.bindings),/已有内容/);
});
test('browser page adapter pauses on ambiguity, complex widgets, authentication and stale structure',()=>{
  for(const mutate of [f=>f.inputs.push(new f.Input('First Name*')),f=>f.input.role='combobox',f=>f.input.type='file',f=>f.input.hidden=true,f=>f.input.readOnly=true,f=>f.input.value='Keep',f=>f.inputs.push(new f.Input('Password','password'))]){
    const f=fixture();mutate(f);assert.throws(()=>f.call('preview'));assert.equal(f.input.events.length,0);
  }
  const f=fixture(),p=f.call('preview');f.input.id='changed';assert.throws(()=>f.call('fill',p.bindings),/结构已变化/);assert.equal(f.input.value,'');
});
test('browser page adapter reports partial progress instead of overwriting a dynamically changed next field',()=>{
  const f=fixture(),last=new f.Input('Last Name');last.id='last_name';f.inputs.push(last);f.fields.push({index:1,label:'Last Name',answer:'Second'});
  const p=f.call('preview');f.input.onEvent=()=>{last.value='Inserted by page';};
  assert.throws(()=>f.call('fill',p.bindings),/已填写 1 项/);assert.equal(last.value,'Inserted by page');
});
test('browser page adapter stops when a previous input changes the next control identity or role',()=>{
  for(const mutate of [e=>e.role='combobox',e=>e.type='password',e=>e.id='replacement',e=>e.labels[0].textContent='Work authorization']) {
    const f=fixture(),last=new f.Input('Last Name');last.id='last_name';f.inputs.push(last);f.fields.push({index:1,label:'Last Name',answer:'Second'});
    const p=f.call('preview');f.input.onEvent=()=>mutate(last);
    assert.throws(()=>f.call('fill',p.bindings),/已填写 1 项/);assert.equal(last.value,'');
  }
});
test('browser page adapter stops after navigation or a new duplicate field during filling',()=>{
  for(const mutate of [f=>f.context.location.href='https://job-boards.greenhouse.io/test/jobs/999',f=>f.inputs.push(new f.Input('Last Name'))]) {
    const f=fixture(),last=new f.Input('Last Name');last.id='last_name';f.inputs.push(last);f.fields.push({index:1,label:'Last Name',answer:'Second'});
    const p=f.call('preview');f.input.onEvent=()=>mutate(f);
    assert.throws(()=>f.call('fill',p.bindings),/已填写 1 项/);assert.equal(last.value,'');
  }
});
