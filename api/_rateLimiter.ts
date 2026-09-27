import crypto from 'node:crypto';
import {isIP} from 'node:net';
import {supabase} from './_supabaseClient.js';

export interface RateLimitResult {
 allowed:boolean; remaining:number; retryAfterSeconds:number; limit:number;
 isDistributed?:boolean; isDegraded?:boolean;
}
export type RateLimitTier='admin'|'admin_login'|'auth_exchange'|'auth_poll'|'ai_parse'|'general';
const limits:Record<RateLimitTier,number>={admin:120,admin_login:20,auth_exchange:30,auth_poll:90,ai_parse:30,general:120};
// Retained for old test imports; production never downgrades to per-instance limits.
export const DEGRADED_CONSERVATIVE_CONFIGS=Object.fromEntries(Object.entries(limits).map(([k,v])=>[k,{maxRequests:v,windowMs:60000}]));

function normalizeIp(value:unknown):string|null {
 if(typeof value!=='string')return null;
 let ip=value.trim();
 if(ip.startsWith('::ffff:') && isIP(ip.slice(7))===4)ip=ip.slice(7);
 if(!isIP(ip))return null;
 if(isIP(ip)===6){
   // URL serialization normalizes equivalent IPv6 spelling. Group by /64 so
   // rotating a host address cannot create a fresh bucket for every request.
   const normalized=new URL('http://['+ip+']/').hostname.slice(1,-1);
   const [left,right]=normalized.split('::');
   const a=left?left.split(':'):[];const b=right?right.split(':'):[];
   const full=right!==undefined?[...a,...Array(8-a.length-b.length).fill('0'),...b]:a;
   return full.slice(0,4).map(x=>parseInt(x,16).toString(16)).join(':')+'::/64';
 }
 return ip;
}
export function getClientIp(req:any):string {
 // Vercel overwrites this header. Raw Express deployments must use the socket;
 // arbitrary client-supplied forwarding headers are not a trusted proxy chain.
 if(process.env.VERCEL==='1'){
   return normalizeIp(req.headers?.['x-forwarded-for']) || 'unknown-vercel';
 }
 return normalizeIp(req.socket?.remoteAddress || req.connection?.remoteAddress) || 'unknown-peer';
}
const buckets=new Map<string,{hits:number[];expiry:number}>();
export function checkRateLimit(identifier:string,maxRequests:number,windowMs=60000):RateLimitResult {
 const now=Date.now();
 if(buckets.size>=10000){for(const [key,b] of buckets)if(b.expiry<=now)buckets.delete(key);}
 if(!buckets.has(identifier)&&buckets.size>=10000)return {allowed:false,remaining:0,retryAfterSeconds:60,limit:maxRequests};
 const hits=(buckets.get(identifier)?.hits||[]).filter(t=>t>now-windowMs);
 if(hits.length>=maxRequests)return {allowed:false,remaining:0,retryAfterSeconds:Math.max(1,Math.ceil((hits[0]+windowMs-now)/1000)),limit:maxRequests};
 hits.push(now);buckets.set(identifier,{hits,expiry:now+windowMs});
 return {allowed:true,remaining:maxRequests-hits.length,retryAfterSeconds:0,limit:maxRequests};
}
const LUA=`
local tm=redis.call('TIME')
local now=tonumber(tm[1])*1000+math.floor(tonumber(tm[2])/1000)
local win=tonumber(ARGV[1])
local lim=tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',now-win)
local n=redis.call('ZCARD',KEYS[1])
if n>=lim then
 local oldest=redis.call('ZRANGE',KEYS[1],0,0,'WITHSCORES')
 return {0,0,math.max(1,math.ceil((tonumber(oldest[2])+win-now)/1000))}
end
redis.call('ZADD',KEYS[1],now,ARGV[3])
redis.call('PEXPIRE',KEYS[1],win)
return {1,lim-n-1,0}`;
function validResult(r:any,limit:number):r is RateLimitResult {
 return r && typeof r.allowed==='boolean' && r.limit===limit && Number.isInteger(r.remaining) && r.remaining>=0 && r.remaining<=limit && Number.isInteger(r.retryAfterSeconds) && r.retryAfterSeconds>=0 && (r.allowed?r.retryAfterSeconds===0:r.remaining===0&&r.retryAfterSeconds>0);
}
function bucketKey(identifier:string){return crypto.createHash('sha256').update(identifier).digest('hex');}
export async function checkDistributedRateLimit(identifier:string,maxRequests:number,windowMs=60000):Promise<RateLimitResult|null>{
 const url=process.env.UPSTASH_REDIS_REST_URL;const token=process.env.UPSTASH_REDIS_REST_TOKEN;
 if(!url||!token)return null;
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),2500);
 try {
   const endpoint=new URL(url);if(endpoint.protocol!=='https:' || endpoint.username || endpoint.password)return null;
   const response=await fetch(endpoint,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},signal:controller.signal,
     body:JSON.stringify(['EVAL',LUA,'1','moliya:rate:'+bucketKey(identifier),String(windowMs),String(maxRequests),crypto.randomUUID()])});
   if(!response.ok)return null;
   const data=await response.json();const tuple=data?.result;
   if(data?.error || !Array.isArray(tuple)||tuple.length!==3 || ![0,1].includes(tuple[0]))return null;
   const r={allowed:tuple[0]===1,remaining:tuple[1],retryAfterSeconds:tuple[2],limit:maxRequests};
   return validResult(r,maxRequests)?r:null;
 }catch{return null;}finally{clearTimeout(timer);}
}
async function databaseLimit(identifier:string,maxRequests:number):Promise<RateLimitResult|null>{
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),2500);
 try {
   const {data,error}=await supabase.rpc('moliya_rate_limit',{p_bucket:bucketKey(identifier),p_limit:maxRequests,p_window_ms:60000}).abortSignal(controller.signal);
   return !error&&validResult(data,maxRequests)?data:null;
 }catch{return null;}finally{clearTimeout(timer);}
}
export async function applyRateLimit(req:any,res:any,tier:RateLimitTier='general',customKeySuffix=''):Promise<boolean>{
 const maximum=limits[tier];const identifier=tier+':'+getClientIp(req)+(customKeySuffix?':'+customKeySuffix:'');
 const configured=Boolean(process.env.UPSTASH_REDIS_REST_URL || process.env.UPSTASH_REDIS_REST_TOKEN);
 const production=process.env.NODE_ENV==='production'||process.env.VERCEL==='1';
 let result:RateLimitResult|null;
 if(configured){result=await checkDistributedRateLimit(identifier,maximum);res.setHeader('X-RateLimit-Mode','redis');}
 else if(production){result=await databaseLimit(identifier,maximum);res.setHeader('X-RateLimit-Mode','database');}
 else{result=checkRateLimit(identifier,maximum);res.setHeader('X-RateLimit-Mode','development_memory');}
 if(!result){res.setHeader('Retry-After','3');res.status(503).json({error:'RATE_LIMIT_STORE_UNAVAILABLE',message:'Himoya xizmati vaqtincha javob bermayapti. Qayta urinib ko‘ring.'});return false;}
 res.setHeader('X-RateLimit-Limit',String(maximum));res.setHeader('X-RateLimit-Remaining',String(result.remaining));res.setHeader('X-RateLimit-Tier',tier);
 if(!result.allowed){res.setHeader('Retry-After',String(result.retryAfterSeconds));res.status(429).json({error:'Too Many Requests',retryAfter:result.retryAfterSeconds});return false;}
 return true;
}
