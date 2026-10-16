// Poll only while an explicitly requested refresh is pending; never start a periodic search.
export function refreshController({request,status,updated,changed,setTimer=setTimeout,clearTimer=clearTimeout,now=Date.now}) {
 let epoch=0,timer=null,pending=null,started=0,tracking=false;
 const cancelTimer=()=>{if(timer!==null)clearTimer(timer);timer=null;};
 async function check(ticket) {
  const data=await status();if(ticket!==epoch)return;
  changed(data);
  if(data.running){
   tracking=true;
   if(now()-started>12*60*1000){changed({error:'更新耗时较长，现有岗位仍可浏览；点击刷新可重新检查同一任务。'});return;}
   timer=setTimer(()=>{timer=null;return run(ticket);},2000);
  } else {
   await updated();
   if(ticket===epoch)tracking=false;
  }
 }
 function run(ticket,start=false,trigger='manual') {
  const work=(async()=>{try{
   if(start){await request(trigger);if(ticket!==epoch)return;tracking=true;}
   await check(ticket);
  }catch(error){if(ticket===epoch)changed({error:error.message});}})();
  pending=work;work.finally(()=>{if(pending===work)pending=null;});return work;
 }
 function refresh(trigger='manual') {
  if(pending)return pending;
  cancelTimer();const ticket=++epoch;started=now();changed({running:true});
  // Progress checks and failed result reads belong to the already requested task.
  return run(ticket,!tracking,trigger);
 }
 function inspect() {if(pending)return pending;cancelTimer();const ticket=++epoch;started=now();return run(ticket);}
 return {refresh,inspect,stop(){epoch++;cancelTimer();pending=null;tracking=false;}};
}
