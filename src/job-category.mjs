import {classifyResume} from './resume-track.mjs';
// Category is independent of the user's resume-template selection.
export function jobCategory(job={}) {
 const title=String(job.title||'');
 const explicit=title.match(/\b(?:firmware|embedded\s+(?:software|systems?|engineer\w*|develop\w*)|BSP|RTOS|(?:device|kernel)\s+driver\w*)\b|固件|嵌入式|板级支持|设备驱动/iu);
 const jd=job.fullJd===false?'':String(job.jd||'');
 const duty=jd.split(/\n|(?<=[.!?])\s+/).filter(line=>!/^\s*(?:we|our company)\b|\b(?:collaborat\w*|work(?:ing)?)\s+(?:closely\s+)?with|\b(?:degree|familiarity|knowledge|experience with)\b/i.test(line)).map(line=>line.match(/\b(?:design|develop|implement|debug|test|maintain|build|port|integrate)(?:ing|s)?\s+(?:[\w,/-]+\s+){0,6}(?:firmware|embedded\s+(?:software|systems?)|BSP|board support packages?|RTOS|(?:device|kernel)\s+drivers?)\b|(?:开发|设计|调试|维护|测试).{0,16}(?:固件|嵌入式软件|设备驱动|板级支持)/iu)?.[0]).find(Boolean);
 if(explicit||duty)return {primary:'embedded',label:'Firmware / Embedded',evidence:[explicit?.[0]||duty]};
 const track=job.classification?.track||classifyResume(job).track;
 return {primary:track,label:{cs:'CS / Software',data:'数据 / 分析',mixed:'CS / Data 交叉',unknown:'类别待确认'}[track]||'类别待确认',evidence:[]};
}
