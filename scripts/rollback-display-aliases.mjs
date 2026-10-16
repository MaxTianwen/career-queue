// Default is read-only preview. Removes only the exact approved display mappings.
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {readAliases,removeAliases} from '../src/v2/opportunity-aliases.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const [manifest,action]=process.argv.slice(2);
if(!manifest||![undefined,'--apply'].includes(action)||process.argv.length>4)throw Error('Usage: node scripts/rollback-display-aliases.mjs <approved-mappings.json> [--apply]');
const mappings=JSON.parse(readFileSync(resolve(manifest),'utf8'));
if(!Array.isArray(mappings)||!mappings.every(m=>m.alias_id&&m.canonical_id&&m.evidence))throw Error('Invalid mapping manifest');
const db=new DatabaseSync(resolve(root,'private/v2-local/workspaces.sqlite'),{readOnly:action!=='--apply'});
try{
 if(action==='--apply'){
  db.exec('BEGIN IMMEDIATE');try{removeAliases(db,mappings);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
 }
 console.log(JSON.stringify({mode:action==='--apply'?'removed exact matching mappings':'read-only preview',remaining:readAliases(db),preserved:'catalogue, publication dates, notes, materials, submissions and all other rows'}));
}finally{db.close()}
