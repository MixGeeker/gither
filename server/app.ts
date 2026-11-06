import type {DatabaseSync} from 'node:sqlite';
import {createAuthService,type AuthService} from './auth.js';
import {createPoolService} from './pool.js';
import {createMcpHandler} from './mcp.js';
import {PoolError,type ProjectCard} from './pool-contracts.js';
import {exampleCandidates} from './examples.js';

export interface ApplicationOptions {db:DatabaseSync;origin:string;secret?:string;allowLocalhost?:boolean}
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
function fail(code:string,status:number):never{throw new PoolError(status,code,code)}
function origin(request:Request,expected:string,required=false){if(new URL(request.url).origin!==expected||request.headers.get('sec-fetch-site')==='cross-site'||(request.headers.has('origin')&&request.headers.get('origin')!==expected)||(required&&!request.headers.has('origin')))fail('INVALID_ORIGIN',403)}
async function body(request:Request,keys:string[]){
 if(request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')fail('JSON_REQUIRED',415);
 const text=await request.text();if(Buffer.byteLength(text)>1024*1024)fail('BODY_TOO_LARGE',413);
 let value:unknown;try{value=JSON.parse(text)}catch{fail('INVALID_JSON',400)}
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))fail('INVALID_FIELDS',400);
 return value as Record<string,unknown>;
}
function toUiProject(p:ProjectCard){const parts=p.canonicalRepository.split('/');return{id:p.id,name:p.title,owner:parts[0]+' / '+parts[1],category:p.tags[0]||'项目',tagline:p.purpose,description:p.description,tags:p.tags,url:p.repositoryUrl,use:p.useCase,points:p.capabilities,art:p.title,symbol:'',bg:'#f6f8fa',ink:'#0969da',card:{capabilities:p.capabilities,useCase:p.useCase},metadata:{repositoryUrl:p.repositoryUrl,ownerLogin:parts[0],...(p.stars===undefined?{}:{stars:p.stars})},evidence:p.evidence};}

export async function createApplication(options:ApplicationOptions){
 const {db}=options;const auth:AuthService|null=options.secret?await createAuthService({db,origin:options.origin,secret:options.secret,...(options.allowLocalhost===undefined?{}:{allowLocalhost:options.allowLocalhost})}):null;
 const pool=createPoolService(db);const mcp=createMcpHandler(pool);
 db.exec('CREATE TABLE IF NOT EXISTS gither_http_limits(bucket TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL)');
 const initialized=()=>!!auth&&!!db.prepare('SELECT 1 FROM gither_owner_bootstrap LIMIT 1').get();
 function rateLimit(keyId:string,write:boolean){const bucket=keyId+':'+(write?'w':'r');const window=Math.floor(Date.now()/60000);db.prepare('DELETE FROM gither_http_limits WHERE window_start < ?').run(window);const row=db.prepare('SELECT count,window_start FROM gither_http_limits WHERE bucket=?').get(bucket) as {count:number}|undefined;if((row?.count||0)>=(write?60:240))fail('RATE_LIMITED',429);db.prepare('INSERT INTO gither_http_limits VALUES (?,?,1) ON CONFLICT(bucket) DO UPDATE SET count=count+1').run(bucket,window);}
 async function handler(request:Request):Promise<Response>{
  const url=new URL(request.url),path=url.pathname,method=request.method;
  try{
   origin(request,options.origin);
   if(path==='/healthz'&&method==='GET')return json({ok:true});
   if(path==='/api/system'&&method==='GET')return json({selfHosted:true,initialized:initialized(),registration:false,socialLogin:false});
   if(!initialized())return json({code:'SETUP_REQUIRED'},503);
   if(path.startsWith('/api/auth/'))return auth!.authHandler(request);
   if(path==='/mcp'){
    if(url.search)fail('MCP_QUERY_NOT_ALLOWED',400);
    const principal=await auth!.verifyKey(request,'mcp',[]);if(!principal)return json({code:'MCP_KEY_REQUIRED'},401);
    rateLimit(principal.keyId,true);return mcp(request,principal);
   }
   if(path.startsWith('/api/v1/')){
    const principal=await auth!.verifyKey(request,'api',[]);if(!principal)return json({code:'API_KEY_REQUIRED'},401);
    rateLimit(principal.keyId,method!=='GET');
    const need=(scope:string)=>{if(!principal.scopes.includes(scope as never))fail('INSUFFICIENT_SCOPE',403)};
    if(path==='/api/v1/projects'&&method==='GET'){need('catalog:read');return json({projects:pool.listCatalog(principal.userId)})}
    if(path==='/api/v1/pool'&&method==='GET'){need('pool:read');return json(pool.getAgentStatus(principal))}
    if(path==='/api/v1/profile'&&method==='GET'){need('profile:read');return json(pool.getProfile(principal.userId))}
    if(path==='/api/v1/feedback'&&method==='GET'){need('candidates:read');return json(pool.getFeedback(principal))}
    if(method==='POST'){
     if(path==='/api/v1/jobs/claim'){need('collection:claim');return json(pool.claimJob(principal,await body(request,['idempotencyKey']) as never))}
     if(path==='/api/v1/jobs/heartbeat'){need('collection:claim');return json(pool.heartbeatJob(principal,await body(request,['jobId','claimToken']) as never))}
     if(path==='/api/v1/jobs/finish'){need('collection:claim');return json(pool.finishJob(principal,await body(request,['jobId','claimToken','outcome','summary']) as never))}
     if(path==='/api/v1/candidates'){need('candidates:write');return json(pool.submitCandidates(principal,await body(request,['jobId','claimToken','idempotencyKey','candidates']) as never))}
     if(path==='/api/v1/subscription-proposals'){need('pool:write');const value=await body(request,['subscriptions']);return json(pool.proposeSubscriptions(principal,value.subscriptions as never))}
    }
    return json({code:'NOT_FOUND'},404);
   }
   if(path==='/api/projects'||path.startsWith('/api/me/')){
    if(request.headers.has('authorization'))fail('SESSION_REQUIRED',401);
    const user=await auth!.session(request);if(!user)fail('SESSION_REQUIRED',401);
    if(user.role!=='owner')fail('OWNER_REQUIRED',403);
    if(method!=='GET')origin(request,options.origin,true);
    if(path==='/api/projects'&&method==='GET'){pool.ensureCollectionJob(user.id);return json({projects:pool.listCatalog(user.id,{includeDecided:true}).map(toUiProject)})}
    if(path==='/api/me/state'&&method==='GET')return json(pool.getDecisions(user.id));
    if(path==='/api/me/decision'&&method==='POST'){const v=await body(request,['projectId','decision']);pool.saveDecision(user.id,v.projectId as string,v.decision as never);pool.ensureCollectionJob(user.id);return json(pool.getDecisions(user.id))}
    if(path==='/api/me/undo'&&method==='POST'){await body(request,[]);pool.undoDecision(user.id);return json(pool.getDecisions(user.id))}
    if(path==='/api/me/status'&&method==='GET'){pool.ensureCollectionJob(user.id);return json(pool.getStatus(user.id))}
    if(path==='/api/me/jobs'&&method==='GET')return json({jobs:pool.getJobs(user.id)});
    if(path==='/api/me/jobs/retry'&&method==='POST'){await body(request,[]);return json(pool.retryFailedJob(user.id))}
    if(path==='/api/me/proposals'&&method==='GET')return json({proposals:pool.getProposals(user.id)});
    if(path==='/api/me/proposals'&&method==='DELETE'){await body(request,[]);return json(pool.clearProposals(user.id))}
    if(path==='/api/me/candidates'&&method==='GET')return json({candidates:pool.getCandidates(user.id)});
    if(path==='/api/me/rules'&&method==='GET')return json(pool.getRules(user.id));
    if(path==='/api/me/rules'&&method==='PUT'){const v=await body(request,['refillThreshold','batchTarget','expectedVersion']);if(v.expectedVersion!==pool.getRules(user.id).version)fail('VERSION_CONFLICT',409);const result=pool.setRules(user.id,{refillThreshold:v.refillThreshold as number,batchTarget:v.batchTarget as number});pool.ensureCollectionJob(user.id);return json(result)}
    if(path==='/api/me/profile'&&method==='GET')return json(pool.getProfile(user.id));
    if(path==='/api/me/profile'&&method==='PUT'){const v=await body(request,['topics','sources','flavors','excludedTopics','expectedVersion']);if(!Number.isInteger(v.expectedVersion))fail('EXPECTED_VERSION_REQUIRED',400);return json(pool.setProfile(user.id,v as never))}
    if(path==='/api/me/subscriptions'&&method==='GET')return json({subscriptions:pool.getSubscriptions(user.id)});
    if(path==='/api/me/subscriptions'&&method==='PUT'){const v=await body(request,['subscriptions']);return json(pool.setSubscriptions(user.id,v.subscriptions as never))}
    if(path==='/api/me/examples'&&method==='POST'){await body(request,[]);return json(pool.seedCandidates(user.id,exampleCandidates()))}
    const review=path.match(/^\/api\/me\/candidates\/([a-zA-Z0-9_-]{1,128})\/review$/);
    if(review&&method==='POST'){const v=await body(request,['decision','note','idempotencyKey']);const result=pool.reviewCandidate(user.id,review[1]!,v.decision as never,v.note as string,v.idempotencyKey as string);pool.ensureCollectionJob(user.id);return json(result)}
    const availability=path.match(/^\/api\/me\/projects\/([a-zA-Z0-9_-]{1,128})\/availability$/);
    if(availability&&method==='PUT'){const v=await body(request,['available']);if(typeof v.available!=='boolean')fail('INVALID_AVAILABILITY',400);pool.setProjectAvailability(user.id,availability[1]!,v.available);return json({ok:true})}
    if(path==='/api/me/keys'&&method==='GET')return json({keys:await auth!.listKeys(user.id)});
    if(path==='/api/me/keys'&&method==='POST'){const v=await body(request,['name','audience','scopes','expiresAt','password']);if(typeof v.password!=='string'||!await auth!.reauthenticate(request,v.password))fail('REAUTHENTICATION_REQUIRED',403);return json(await auth!.createKey(user.id,{name:v.name as string,audience:v.audience as never,scopes:v.scopes as never,expiresAt:v.expiresAt as string}),201)}
    const key=path.match(/^\/api\/me\/keys\/([a-zA-Z0-9_-]{1,128})$/);
    if(key&&method==='DELETE'){const v=await body(request,['password']);if(typeof v.password!=='string'||!await auth!.reauthenticate(request,v.password))fail('REAUTHENTICATION_REQUIRED',403);return json({revoked:await auth!.revokeKey(user.id,key[1]!)})}
    return json({code:'NOT_FOUND'},404);
   }
   return json({code:'NOT_FOUND'},404);
  }catch(error){if(error instanceof PoolError)return json({code:error.code,message:error.message},error.status);return json({code:'REQUEST_FAILED'},400)}
 }
 return{handler,auth,pool,initialized};
}
