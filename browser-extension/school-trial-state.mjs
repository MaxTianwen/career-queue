// One local extension-owned checkpoint. Never reads portal storage or credentials.
export function schoolTrialState(indexedDB=globalThis.indexedDB,dbName='career-queue-school-trial'){
 let db;
 const open=()=>db??=new Promise((resolve,reject)=>{const r=indexedDB.open(dbName,1);r.onupgradeneeded=()=>r.result.createObjectStore('trial');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(Error('LOCAL_STATE_UNAVAILABLE'));});
 async function transaction(mode,value){const d=await open();return new Promise((resolve,reject)=>{const tx=d.transaction('trial',mode),s=tx.objectStore('trial');let result;const r=mode==='readonly'?s.get('current'):s.put(value,'current');r.onsuccess=()=>{result=r.result;};tx.oncomplete=()=>resolve(result);tx.onerror=tx.onabort=()=>reject(Error('LOCAL_STATE_UNAVAILABLE'));});}
 return{load:()=>transaction('readonly'),save:value=>transaction('readwrite',structuredClone(value))};
}
