import {classifyResume} from './resume-track.mjs';
// Category is independent of the user's resume-template selection.
export function jobCategory(job={}) {
 const title=String(job.title||'');
 const explicit=title.match(/\b(?:firmware|embedded\s+(?:software|systems?|engineer\w*|develop\w*)|BSP|RTOS|(?:device|kernel)\s+driver\w*)\b|固件|嵌入式|板级支持|设备驱动/iu);
 const jd=job.fullJd===false?'':String(job.jd||'');
 const duty=jd.split(/\n|(?<=[.!?])\s+/).filter(line=>!/^\s*(?:we|our company)\b|\b(?:collaborat\w*|work(?:ing)?)\s+(?:closely\s+)?with|\b(?:degree|familiarity|knowledge|experience with)\b/i.test(line)).map(line=>line.match(/\b(?:design|develop|implement|debug|test|maintain|build|port|integrate)(?:ing|s)?\s+(?:[\w,/-]+\s+){0,6}(?:firmware|embedded\s+(?:software|systems?)|BSP|board support packages?|RTOS|(?:device|kernel)\s+drivers?)\b|(?:开发|设计|调试|维护|测试).{0,16}(?:固件|嵌入式软件|设备驱动|板级支持)/iu)?.[0]).find(Boolean);
 if(explicit||duty)return {primary:'embedded',label:'Firmware / Embedded',evidence:[explicit?.[0]||duty]};
 const track=job.classification?.track||classifyResume(job).track;
 if(track==='unknown'){const family=titleFamily(title);if(family)return {...family,evidence:[family.evidence]};}
 return {primary:track,label:{cs:'CS / Software',data:'数据 / 分析',mixed:'CS / Data 交叉',unknown:'类别待确认'}[track]||'类别待确认',evidence:[]};
}
// Title-only families for roles the CS/Data resume tracks do not name. Mechanical, sales
// ("business development"), accounting and generic "Intern" titles stay unknown on purpose.
const families=[
 ['mixed','AI / ML',/\b(?:machine learning|deep learning|artificial intelligence|computer vision|(?:AI|ML|GenAI|LLM|NLP)(?:\s*\/\s*(?:AI|ML))?|applied scientist)\b/i],
 ['hardware','硬件 / 芯片',/\b(?:hardware|HW|ASIC|FPGA|silicon|analog|mixed[ -]signal|electrical|electronics?|circuit|PCBA?|(?:digital|analog)\s+IC|IC\s+design|VLSI|SoC|semiconductor|signal integrity|(?:design|silicon|hardware)\s+verification|validation engineer\w*|silicon validation|layout engineer|RF|optical|photonics?|(?:display|camera)\s+(?:systems?|design))\b/i],
 ['data','数据 / 分析',/\b(?:data\s+insights?|insights?\s+analyst|performance analysis|geographic information systems|GIS)\b/i],
 ['cs','CS / Software',/\b(?:developer|(?:application|game|graphics|rendering|tools?)\s+engineer\w*|automation|(?:technical|IT)\s+(?:helpdesk|support))\b/i],
 ['business','商业 / 产品分析',/\b(?:business\s+(?:analyst|analysis|analytics|intelligence|systems|operations)|operations analyst|product\s+(?:manag\w*|strategy|owner|analyst|intern)|(?:payments?|technical)\s+product|(?:credit\s+)?risk(?:\s+(?:analyst|intern|co[ -]?op))|portfolio analyst|investment analyst|financial analyst|strategy\s+(?:analyst|intern|co[ -]?op)|analyst)\b/i]
];
export function titleFamily(title=''){
 for(const [primary,label,re] of families){const m=String(title).match(re);if(m)return {primary,label,evidence:m[0]};}
 return null;
}
