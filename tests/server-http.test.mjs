import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync,backup} from 'node:sqlite';
import {request as httpRequest} from 'node:http';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../.server-dist/app.js';
import {createHttpServer} from '../.server-dist/http-server.js';
const origin='https://gither.test';
const password='Temporary-Test-Password-913!';
const secret='temporary-test-secret-abcdefghijklmnopqrstuvwxyz-0987654321';
function req(path,method='GET',data,extra={}){return new Request(origin+path,{method,headers:{...(method==='GET'?{}:{origin,'content-type':'application/json'}),...extra},...(data===undefined?{}:{body:JSON.stringify(data)})})}
async function fixture(){const db=new DatabaseSync(':memory:');const app=await createApplication({db,origin,secret});const owner=await app.auth.createOwner({email:'owner@example.test',password,name:'Test owner'});const login=await app.handler(req('/api/auth/sign-in/email','POST',{email:owner.email,password}));assert.equal(login.status,200);const cookie=login.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');return{db,app,owner,cookie,close:()=>db.close()}}
const keyInput=(audience,scopes)=>({name:'Temporary test',audience,scopes,expiresAt:new Date(Date.now()+3600000).toISOString(),password});
const rpc=(name,args={})=>({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}});
const mcpHeaders=(key)=>({authorization:'Bearer '+key,accept:'application/json, text/event-stream','mcp-protocol-version':'2025-11-25'});

test('HTTP app gates every data route and disables account escalation routes',async()=>{const f=await fixture();try{
 for(const path of ['/api/projects','/api/me/keys','/api/me/profile','/api/me/candidates','/api/v1/projects','/mcp'])assert.equal((await f.app.handler(req(path))).status,401,path);
 for(const path of ['/api/auth/sign-up/email','/api/auth/sign-in/social','/api/auth/update-user','/api/auth/change-password'])assert.equal((await f.app.handler(req(path,'POST',{role:'owner'},{cookie:f.cookie}))).status,404);
 assert.equal((await f.app.handler(req('/api/me/rules','PUT',{refillThreshold:30,batchTarget:60,expectedVersion:1},{cookie:f.cookie,origin:'https://evil.test'}))).status,403);
 assert.equal((await f.app.handler(req('/api/me/keys','POST',{...keyInput('mcp',['catalog:read']),userId:'other'},{cookie:f.cookie}))).status,400);
}finally{f.close()}});

test('key endpoints await real results, reauthenticate, hide raw keys and isolate audiences/scopes',async()=>{const f=await fixture();try{
 let r=await f.app.handler(req('/api/me/keys','POST',{...keyInput('mcp',['catalog:read']),password:'wrong'},{cookie:f.cookie}));assert.equal(r.status,403);
 r=await f.app.handler(req('/api/me/keys','POST',keyInput('mcp',['catalog:read']),{cookie:f.cookie}));assert.equal(r.status,201);const key=await r.json();assert.match(key.key,/^gthr_mcp_/);
 const listed=await(await f.app.handler(req('/api/me/keys','GET',undefined,{cookie:f.cookie}))).json();assert.equal(listed.keys.length,1);assert.equal(listed.keys[0].key,undefined);
 assert.equal((await f.app.handler(req('/api/v1/projects','GET',undefined,{authorization:'Bearer '+key.key}))).status,401);
 assert.equal((await f.app.handler(req('/api/me/profile','GET',undefined,{authorization:'Bearer '+key.key}))).status,401);
 r=await f.app.handler(req('/mcp','POST',rpc('discovery_profile'),mcpHeaders(key.key)));assert.equal((await r.json()).result.isError,true);
 r=await f.app.handler(req('/mcp','POST',{jsonrpc:'2.0',id:1,method:'resources/list',params:{}},mcpHeaders(key.key)));assert.equal((await r.json()).result.resources[0].uri,'gither://onboarding');
 r=await f.app.handler(req('/api/me/keys/'+key.id,'DELETE',{password},{cookie:f.cookie}));assert.deepEqual(await r.json(),{revoked:true});
 assert.equal((await f.app.handler(req('/mcp','POST',rpc('list_projects'),mcpHeaders(key.key)))).status,401);
}finally{f.close()}});

test('actual session review, decisions, undo and pool rule snapshots stay separate from agent rights',async()=>{const f=await fixture();try{
 const seed=await f.app.handler(req('/api/me/examples','POST',{},{cookie:f.cookie}));assert.equal(seed.status,200);
 const candidates=(await(await f.app.handler(req('/api/me/candidates','GET',undefined,{cookie:f.cookie}))).json()).candidates;assert.equal(candidates.length,3);
 assert.equal((await(await f.app.handler(req('/api/projects','GET',undefined,{cookie:f.cookie}))).json()).projects.length,0);
 for(const c of candidates){const r=await f.app.handler(req('/api/me/candidates/'+c.id+'/review','POST',{decision:'approved',note:'Verified example',idempotencyKey:'review-'+c.id},{cookie:f.cookie}));assert.equal(r.status,200)}
 const projects=(await(await f.app.handler(req('/api/projects','GET',undefined,{cookie:f.cookie}))).json()).projects;assert.equal(projects.length,3);assert.ok(projects.every(p=>p.card.capabilities.length===2));assert.ok(projects.every(p=>p.metadata.stars===undefined));
 let r=await f.app.handler(req('/api/me/decision','POST',{projectId:projects[0].id,decision:'saved'},{cookie:f.cookie}));assert.deepEqual((await r.json()).saved,[projects[0].id]);
 r=await f.app.handler(req('/api/me/undo','POST',{},{cookie:f.cookie}));assert.deepEqual((await r.json()).saved,[]);
 r=await f.app.handler(req('/api/me/rules','PUT',{refillThreshold:30,batchTarget:60,expectedVersion:999},{cookie:f.cookie}));assert.equal(r.status,409);
 const key=await(await f.app.handler(req('/api/me/keys','POST',keyInput('api',['pool:read']),{cookie:f.cookie}))).json();
 const status=await(await f.app.handler(req('/api/v1/pool','GET',undefined,{authorization:'Bearer '+key.key}))).json();assert.equal(status.availableCount,3);assert.equal(status.activeJob.profileSnapshot,undefined);assert.equal(status.activeJob.batchTarget,60);
 assert.equal((await f.app.handler(req('/api/me/rules','PUT',{refillThreshold:1,batchTarget:1,expectedVersion:1},{authorization:'Bearer '+key.key}))).status,401);
}finally{f.close()}});

test('production HTTP bridge checks Host, body limits, security headers and trusted IP overwrite',async()=>{
 const server=createHttpServer({origin:'http://127.0.0.1',assetsDir:'dist',handler:async r=>Response.json({ip:r.headers.get('x-gither-client-ip'),origin:new URL(r.url).origin})});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
 try{
  const send=(path,headers={},method='GET',payload='')=>new Promise((resolve,reject)=>{const q=httpRequest({hostname:'127.0.0.1',port,path,method,headers:{host:'127.0.0.1',...headers}},r=>{const chunks=[];r.on('data',b=>chunks.push(b));r.on('end',()=>resolve({status:r.statusCode,headers:r.headers,text:Buffer.concat(chunks).toString()}))});q.on('error',reject);q.end(payload)});
  const r=await send('/api/test',{'x-gither-client-ip':'spoofed','x-forwarded-for':'spoofed'});assert.equal(r.status,200);assert.notEqual(JSON.parse(r.text).ip,'spoofed');assert.equal(r.headers['x-frame-options'],'DENY');
  assert.equal((await send('/api/test',{host:'evil.test'})).status,421);
  assert.equal((await send('/.env')).status,404);
  assert.equal((await send('/api/test',{'content-length':String(1024*1024+1)},'POST')).status,413);
 }finally{await new Promise(r=>server.close(r))}
});

test('consistent SQLite backup restores catalog and account; recovery invalidates restored credentials',async()=>{
 const f=await fixture();const dir=await mkdtemp(join(tmpdir(),'gither-backup-test-'));let restored;
 try{
  const key=await f.app.auth.createKey(f.owner.id,{...keyInput('mcp',['catalog:read'])});
  await backup(f.db,join(dir,'backup.db'));restored=new DatabaseSync(join(dir,'backup.db'));const app=await createApplication({db:restored,origin,secret});assert.equal(app.initialized(),true);
  await app.auth.resetOwnerPassword({email:f.owner.email,password:'Temporary-Recovered-Password-44!'});
  assert.equal(await app.auth.session(req('/api/me/state','GET',undefined,{cookie:f.cookie})),null);
  assert.equal(await app.auth.verifyKey(req('/mcp','GET',undefined,{authorization:'Bearer '+key.key}),'mcp',[]),null);
 }finally{restored?.close();f.close();await rm(dir,{recursive:true,force:true})}
});

test('proposal list and clear are isolated human-session operations',async()=>{const f=await fixture();try{
 const key=await f.app.auth.createKey(f.owner.id,{...keyInput('mcp',['pool:write'])});
 const principal=await f.app.auth.verifyKey(req('/mcp','GET',undefined,{authorization:'Bearer '+key.key}),'mcp',[]);
 f.app.pool.proposeCollectionPlan(principal,{rationale:'Read official repositories and verify claims',queries:['agent memory']});
 let r=await f.app.handler(req('/api/me/proposals','GET',undefined,{cookie:f.cookie}));assert.equal(r.status,200);assert.equal((await r.json()).proposals.length,1);
 for(const extra of [{},{authorization:'Bearer '+key.key}])assert.equal((await f.app.handler(req('/api/me/proposals','DELETE',{},extra))).status,401);
 assert.equal((await f.app.handler(req('/api/me/proposals','DELETE',{},{cookie:f.cookie,origin:'https://evil.test'}))).status,403);
 r=await f.app.handler(req('/api/me/proposals','DELETE',{},{cookie:f.cookie}));assert.deepEqual(await r.json(),{deleted:1});
 assert.equal(f.app.pool.getProposals(f.owner.id).length,0);
}finally{f.close()}});

test('runtime cards do not display undated candidate star claims',async()=>{const source=await readFile(new URL('../server/app.ts',import.meta.url),'utf8');assert.doesNotMatch(source,/stars:p\.stars/)});
