// Poll only while an explicitly requested refresh is pending; never start a periodic search.
export function refreshController({request,status,updated,changed,setTimer=setTimeout,clearTimer=clearTimeout,now=Date.now}) {
 let epoch=0,timer=null,pending=null,started=0;
 const cancelTimer=()=>{if(timer!==null)clearTimer(timer);timer=null;};
 async function check(ticket) {
  const data=await status();if(ticket!==epoch)return;
  changed(data);
  if(data.running){
   if(now()-started>12*60*1000){changed({error:'更新耗时较长，现有岗位仍可浏览；点击刷新可重新检查同一任务。'});return;}
   timer=setTimer(()=>{timer=null;check(ticket).catch(error=>{if(ticket===epoch)changed({error:error.message});});},2000);
  } else await updated();
 }
 function refresh(trigger='manual') {
  if(pending)return pending;
  cancelTimer();const ticket=++epoch;started=now();changed({running:true});
  const work=(async()=>{try{await request(trigger);if(ticket===epoch)await check(ticket);}catch(error){if(ticket===epoch)changed({error:error.message});}})();
  pending=work;work.finally(()=>{if(pending===work)pending=null;});return work;
 }
 return {refresh,stop(){epoch++;cancelTimer();pending=null;}};
}
