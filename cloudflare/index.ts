import type {Env} from './contracts';
import {collectRepositories} from './collector';
import {getPublished,listCandidates,reviewCandidate,searchPublished,publicStatus} from './store';
import {seedCatalog} from './seeds';
import {handleMcp} from './mcp';
import {authorize,HttpError,json,readJson,strictKeys,verifyOrigin} from './http';
export async function handleRequest(request:Request,env:Env):Promise<Response>{
 const url=new URL(request.url);
 if(url.pathname==='/mcp')return handleMcp(request,env);
 if(!url.pathname.startsWith('/api/'))return env.ASSETS?env.ASSETS.fetch(request):json({code:'ASSETS_UNCONFIGURED'},503);
 try{
  verifyOrigin(request,env);
  if(url.pathname==='/api/health'&&request.method==='GET')return json({status:'ok',...await publicStatus(env.DB),authEnabled:false,feedbackEnabled:false,mode:'reviewed-catalog-prototype'});
  if(url.pathname==='/api/projects'&&request.method==='GET'){
   const q=url.searchParams.get('q')||'',limit=Number(url.searchParams.get('limit')||20);if(q.length>120||!Number.isInteger(limit)||limit<1||limit>50)throw new HttpError(400,'INVALID_QUERY');
   return json({projects:await searchPublished(env.DB,q,limit),source:'reviewed_catalog',personalized:false});
  }
  const projectMatch=url.pathname.match(/^\/api\/projects\/([a-z0-9-]{1,64})$/);
  if(projectMatch&&request.method==='GET'){const project=await getPublished(env.DB,projectMatch[1]!);return project?json({project}):json({code:'NOT_FOUND'},404)}
  // Real human feedback is intentionally unavailable until session + CSRF + ownership are implemented.
  if(['/api/feedback','/api/favorites'].includes(url.pathname))return json({code:'VERIFIED_USER_SESSION_REQUIRED',enabled:false},503);
  if(url.pathname.startsWith('/api/auth/'))return json({code:'AUTH_DISABLED',enabled:false},503);
  if(url.pathname==='/api/admin/candidates'&&request.method==='GET'){await authorize(request,env,'reviewer');return json({candidates:await listCandidates(env.DB)})}
  if(url.pathname.startsWith('/api/admin/')&&request.method==='POST'){
   verifyOrigin(request,env,true);
   if(url.pathname==='/api/admin/seed'){await authorize(request,env,'collector');const body=await readJson(request);strictKeys(body,[]);return json(await seedCatalog(env.DB))}
   if(url.pathname==='/api/admin/collect'){await authorize(request,env,'collector');const body=await readJson(request);strictKeys(body,[]);if(env.COLLECTION_ENABLED!=='true')throw new HttpError(409,'COLLECTION_DISABLED');return json(await collectRepositories(env))}
   if(url.pathname==='/api/admin/review'){
    const principal=await authorize(request,env,'reviewer');const body=await readJson(request);strictKeys(body,['id','revision','decision','note']);
    if(typeof body.id!=='string'||!/^[a-z0-9-]{1,64}$/.test(body.id)||!Number.isInteger(body.revision)||Number(body.revision)<1||(body.decision!=='publish'&&body.decision!=='reject')||typeof body.note!=='string'||body.note.length<1||body.note.length>1000)throw new HttpError(400,'INVALID_REVIEW');
    const changed=await reviewCandidate(env.DB,body.id,Number(body.revision),body.decision,body.note,principal.id);return changed?json({reviewed:true}):json({code:'REVISION_CONFLICT'},409);
   }
  }
  return json({code:'NOT_FOUND'},404);
 }catch(e){return e instanceof HttpError?json({code:e.code},e.status):json({code:'SERVICE_UNAVAILABLE'},503)}
}
export default{
 fetch:handleRequest,
 async scheduled(_event:ScheduledController,env:Env,ctx:ExecutionContext){if(env.COLLECTION_ENABLED==='true')ctx.waitUntil(collectRepositories(env).then(()=>undefined));},
} satisfies ExportedHandler<Env>;
