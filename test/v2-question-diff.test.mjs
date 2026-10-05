import test from 'node:test';
import assert from 'node:assert/strict';
import {questionDiff} from '../web/v2/question-diff.js';
test('question comparison identifies edits and treats renamed or ambiguous questions conservatively',()=>{
 const q=(label,required=true)=>({section:'main',label,required,fields:[]});
 const result=questionDiff([q('name'),q('old'),q('same')],[q('name',false),q('new'),q('same')]);
 assert.deepEqual(result.added,[q('new')]);assert.deepEqual(result.removed,[q('old')]);assert.equal(result.changed.length,1);
 assert.equal(questionDiff([q('name'),q('name')],[q('name')]).removed.length,2);
 assert.equal(questionDiff([q('name'),q('name')],[q('name')]).added.length,1);
 assert.deepEqual(questionDiff([q('a'),q('b')],[q('b'),q('a')]),{added:[],removed:[],changed:[]});
});
