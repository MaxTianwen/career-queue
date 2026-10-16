import {currentPacket,listChoices} from './school-current-client.mjs';
export const MAX_BATCH=5;
const fail=code=>{throw Error(code)},identity=e=>JSON.stringify([e.schoolId,e.title,e.company,e.term]);
export function validatePlan(entries){if(!Array.isArray(entries)||!entries.length||entries.length>MAX_BATCH)fail('BATCH_LIMIT');return listChoices({ok:true,entries});}
export function batchPacket(packets){if(!Array.isArray(packets)||!packets.length||packets.length>MAX_BATCH)fail('BATCH_LIMIT');const ids=new Set();for(const p of packets){currentPacket(p.detail);if(ids.has(p.entry.schoolId)||identity(p.entry)!==identity(p.detail.expected))fail('INVALID_RESULT');ids.add(p.entry.schoolId);}const result={schema:'career-queue-school-current-page-batch-v1',packets};if(JSON.stringify(result).length>800000)fail('VISIBLE_FIELD_TOO_LARGE');return result;}
// No implicit recovery: after interruption the user returns to the list and rechecks.
export function selectedBatch(adapter,onChange=()=>{}){
 let state=null,busy=false,cancelled=false;
 const publish=async()=>{state.revision++;state.updatedAt=Date.now();await adapter.save(structuredClone(state));onChange(structuredClone(state));};
 async function prepare(entries,previous=null){
  if(busy)fail('BUSY');const plan=validatePlan(entries),scan=await adapter.inspect(plan);
  if(scan.length!==plan.length||scan.some((r,i)=>identity(r.entry)!==identity(plan[i])))fail('PAGE_CHANGED');
  const packets=previous?.packets||[];if(packets.length){batchPacket(packets);if(packets.some(p=>!plan.some(e=>identity(e)===identity(p.entry))))fail('PAGE_CHANGED');}
  state={version:1,id:crypto.randomUUID(),revision:0,plan,packets:structuredClone(packets),routes:scan,phase:scan.every(r=>r.supported)?'ready':'blocked',code:scan.every(r=>r.supported)?null:'ROUTE_EVIDENCE_REQUIRED',next:0,updatedAt:Date.now()};await publish();return structuredClone(state);
 }
 async function run(){
  if(busy||state?.phase!=='ready')fail('BATCH_NOT_READY');busy=true;cancelled=false;
  try{for(let i=0;i<state.plan.length;i++){
   const entry=state.plan[i];if(state.packets.some(p=>identity(p.entry)===identity(entry)))continue;
   if(cancelled)fail('CANCELLED');state.next=i;
   const fresh=await adapter.inspect([entry]);if(fresh.length!==1||!fresh[0].supported||identity(fresh[0].entry)!==identity(entry)||fresh[0].url!==state.routes[i].url)fail('PAGE_CHANGED');
   state.phase='opening';await publish();if(cancelled)fail('CANCELLED');await adapter.open(fresh[0]);
   if(cancelled)fail('CANCELLED');state.phase='reading';await publish();
   const packet=await adapter.read(entry,()=>cancelled);if(cancelled)fail('CANCELLED');currentPacket(packet.detail);if(identity(packet.entry)!==identity(entry))fail('DETAIL_IDENTITY_MISMATCH');batchPacket([...state.packets,packet]);
   state.packets.push(packet);state.phase='saved';await publish();if(cancelled)fail('CANCELLED');
   await adapter.back();if(cancelled)fail('CANCELLED');
  }state.phase='complete';state.code=null;await publish();}
  catch(error){state.phase=cancelled?'cancelled':'stopped';state.code=cancelled?'CANCELLED':/^[A-Z][A-Z0-9_]{1,60}$/.test(error.message)?error.message:'BATCH_READ_FAILED';await publish();}
  finally{busy=false;}return structuredClone(state);
 }
 return {prepare,run,cancel(){cancelled=true;},get state(){return structuredClone(state)},get busy(){return busy}};
}
