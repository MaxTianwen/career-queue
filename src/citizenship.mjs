export function citizenshipFacts(job={}){
 const text=[job.jd,job.applicationInstructions,job.eligibilityText].filter(Boolean).join('\n');const evidence=[],uncertain=[];
 for(const line of text.split(/\n|(?<=[.!?])\s+/).map(s=>s.trim()).filter(Boolean)){
  if(!/canadian citizen|citizenship.{0,15}canad|加拿大公民/i.test(line))continue;
  if(/permanent resident|永久居民/i.test(line)&&/\bor\b|\band\b|或|以及/i.test(line))continue;
  if(/may not apply|cannot apply|not eligible|not required|not mandatory|no.{0,20}citizenship requirement|need not|preferred|preference|无需|不要求|优先/i.test(line)){uncertain.push(line);continue;}
  if(/only\s+(?:only\s+)?canadian citizens?\b|canadian citizens?\s+only|canadian citizenship\s+(?:is\s+)?(?:mandatory|required|necessary)|(?:must|shall|need to)\s+be\s+(?:a\s+)?canadian citizen|canadian citizen\s+(?:is\s+)?required|仅限加拿大公民/i.test(line))evidence.push(line);else uncertain.push(line);
 }
 return {restricted:evidence.length>0,evidence,uncertain,reason:evidence.length?'明确仅限加拿大公民；当前账号为永久居民':uncertain.length?'资格待核实':''};
}
