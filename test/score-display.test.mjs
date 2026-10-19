import test from 'node:test';
import assert from 'node:assert/strict';
import {displayScore} from '../web/v2/opportunity.js';
test('score display clamps only finite numeric scores and preserves unknown',()=>{
 for(const value of [undefined,null,'',false,'86',NaN,Infinity,-Infinity])assert.equal(displayScore(value),null);
 for(const [value,expected] of [[0,0],[-12,0],[18,18],[54,54],[85.6,86],[100,100],[145,100]])assert.equal(displayScore(value),expected);
});
