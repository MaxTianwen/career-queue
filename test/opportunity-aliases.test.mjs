import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {compatibleAlias,projectAliases,readAliases,installAliases,removeAliases} from '../src/v2/opportunity-aliases.mjs';
const a={id:'ext',company:'Autodesk',title:'Intern',location:'Toronto',term:'Summer 2027',requisitionId:'26WD101436',jd:'Real work.',url:'https://example.com/ext',postedAt:'2026-10-01',draftIds:['draft-ext'],schoolSources:[]};
const b={...a,id:'uni',url:'https://example.com/uni',postedAt:'2026-09-01',draftIds:['draft-uni'],schoolSources:[{schoolId:'s1'}],notes:'keep'};
const mapping={canonical_id:'ext',alias_id:'uni',approved_at:'2026-10-14',evidence:'explicit approval'};
test('display merge preserves sources, distinct dates, notes and all draft/school references without mutating input',()=>{
 const input=[a,b],before=structuredClone(input),rows=projectAliases(input,[mapping]);assert.equal(rows.length,1);assert.equal(rows[0].id,'ext');assert.equal(rows[0].postedAt,a.postedAt);assert.equal(rows[0].publicAliases[0].postedAt,b.postedAt);assert.equal(rows[0].publicAliases[0].notes,'keep');assert.deepEqual(rows[0].draftIds,['draft-ext','draft-uni']);assert.equal(rows[0].schoolSources[0].schoolId,'s1');assert.deepEqual(input,before);
});
test('changed identity or JD and absent canonical fail open; unapproved duplicates remain',()=>{
 for(const change of [{location:'Ottawa'},{jd:'Different work.'},{term:'Fall 2027'},{requisitionId:'other'}])assert.equal(projectAliases([a,{...b,...change}],[mapping]).length,2);
 assert.equal(projectAliases([b],[mapping]).length,1);assert.equal(projectAliases([a,b],[]).length,2);
 assert(compatibleAlias(a,{...b,jd:b.jd+' Not quite ready to apply? Join our talent community to stay up to date on new job opportunities and the latest Autodesk news.'}));
});
test('mapping writes are idempotent, transactional and rollback preserves newer notes and catalogue',()=>{
 const db=new DatabaseSync(':memory:');assert.deepEqual(readAliases(db),[]);db.exec("CREATE TABLE notes(value TEXT);INSERT INTO notes VALUES('old');");
 db.exec('BEGIN');installAliases(db,[mapping]);db.exec('ROLLBACK');assert.deepEqual(readAliases(db),[]);
 db.exec('BEGIN');installAliases(db,[mapping]);installAliases(db,[mapping]);db.exec('COMMIT');assert.equal(readAliases(db).length,1);
 assert.throws(()=>installAliases(db,[{...mapping,canonical_id:'wrong'}]));db.exec("UPDATE notes SET value='newer user note'");
 db.exec('BEGIN');removeAliases(db,[mapping]);db.exec('COMMIT');assert.deepEqual(readAliases(db),[]);assert.equal(db.prepare('SELECT value FROM notes').get().value,'newer user note');db.close();
});
