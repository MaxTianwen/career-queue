// Driver must observe real visible pages; no inferred URLs or hidden APIs.
export function schoolNavigationBatch(entries,driver){
 if(!Array.isArray(entries)||entries.length>60||new Set(entries.map(x=>x.schoolId)).size!==entries.length)throw Error('Invalid observed entries');
 let paused=true,running=false,next=0,error=null;const results=[];
 return {pause(){paused=true;},snapshot(){return{paused,next,error,results:structuredClone(results)};},async resume(){
  if(running)return this.snapshot();running=true;paused=false;error=null;
  while(!paused&&next<entries.length){const item=entries[next];try{
   const current=await driver.scan();const match=current.entries?.filter(e=>e.schoolId===item.schoolId&&e.title===item.title&&e.company===item.company&&e.term===item.term);
   if(!current.ok||match?.length!==1||match[0].candidateCount!==1)throw Error('TITLE_TARGET_NOT_VERIFIED');
   const opened=await driver.open(item);if(!opened.ok)throw Error('TITLE_NAVIGATION_FAILED');
   const detail=await driver.readDetail();if(detail.schoolId!==item.schoolId||detail.title!==item.title||detail.company!==item.company||detail.term!==item.term||detail.complete!==true)throw Error('DETAIL_IDENTITY_NOT_VERIFIED');
   const returned=await driver.back();if(!returned.ok)throw Error('LIST_RETURN_FAILED');
   const list=await driver.scan();if(!list.ok||!list.entries?.some(e=>e.schoolId===item.schoolId&&e.title===item.title))throw Error('LIST_RETURN_FAILED');
   results.push(detail);next++;if(next<entries.length&&!paused)await driver.delay(2000);
  }catch(e){error=['TITLE_TARGET_NOT_VERIFIED','TITLE_NAVIGATION_FAILED','DETAIL_IDENTITY_NOT_VERIFIED','LIST_RETURN_FAILED'].includes(e.message)?e.message:'PORTAL_READ_FAILED';paused=true;}}
  paused=true;running=false;return this.snapshot();
 }};
}
