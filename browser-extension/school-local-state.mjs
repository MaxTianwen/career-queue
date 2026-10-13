// Extension-owned state only; old trial/batch databases remain untouched.
export function schoolLocalState(indexedDB=globalThis.indexedDB){
 let db;const open=()=>db??=new Promise((resolve,reject)=>{const r=indexedDB.open('career-queue-current-page',1);r.onupgradeneeded=()=>r.result.createObjectStore('state');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(Error('LOCAL_STATE_UNAVAILABLE'));});
 async function run(mode,key,value){const d=await open();return new Promise((resolve,reject)=>{const tx=d.transaction('state',mode),s=tx.objectStore('state');let valueOut;const r=mode==='readonly'?s.get(key):s.put(value,key);r.onsuccess=()=>valueOut=r.result;tx.oncomplete=()=>resolve(valueOut);tx.onerror=tx.onabort=()=>reject(Error('LOCAL_STATE_UNAVAILABLE'));});}
 return {load:key=>run('readonly',key),save:(key,value)=>run('readwrite',key,structuredClone(value))};
}
