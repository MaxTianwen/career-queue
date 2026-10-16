// Only explicit HTTP 429 is retryable here. Access/security refusals never expire implicitly.
export function isRateLimit(job={}) {
 const message=String(job.detailError||'');
 return !/HTTP (?:401|403)\b|access refusal|security refusal|禁止重试/i.test(message) && (job.detailRateLimit?.status===429 || /HTTP 429\b/.test(message));
}
export function accessDenied(job={}) {return /HTTP (?:401|403)\b/.test(job.detailError||'') || Boolean(job.detailAccessDenied&&!isRateLimit(job));}
export function rateState(job={}) {
 if(!isRateLimit(job))return null;
 return job.detailRateLimit || {status:429,attempts:1,nextRetryAt:Number(job.detailRetryAt)||0,lastAttemptAt:0,retryAfter:null};
}
export function nextRateLimit(error,previous,now) {
 // Relative Retry-After starts when the response arrives, not when a long catalogue run began.
 now=Math.max(now,Number.isFinite(error.receivedAt)?error.receivedAt:now);
 const attempts=Math.min(8,Math.max(0,Number(previous?.attempts)||0)+1);
 const backoff=Math.min(6*3600000,300000*2**(attempts-1));
 const raw=typeof error.retryAfter==='string'?error.retryAfter.trim():'';
 const parsed=/^\d+$/.test(raw)?now+Number(raw)*1000:/^[A-Za-z]{3},/.test(raw)?Date.parse(raw):NaN;
 const serverTime=Number.isFinite(parsed)&&parsed<=8640000000000000?parsed:0;
 return {status:429,attempts,lastAttemptAt:now,nextRetryAt:Math.max(now+backoff,serverTime),retryAfter:raw||null};
}
