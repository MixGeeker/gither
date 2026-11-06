// Ephemeral local workerd + D1 integration test. No cloud API/provider requests.
// All role assertions and GitHub responses below are synthetic test fixtures.
import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFileSync} from 'node:fs';
const origin='https://gither.test';
const meta=JSON.parse(readFileSync('src/github-metadata.json','utf8'));
let githubCalls=0;
const services={
 ADMIN_AUTH:async request=>{const role=request.headers.get('authorization')==='Bearer fixture-collector'?'collector':request.headers.get('authorization')==='Bearer fixture-reviewer'?'reviewer':null;return Response.json(role?{authenticated:true,principal:{id:'synthetic-'+role,role}}:{authenticated:false},{status:role?200:403})},
 GITHUB_FETCH:async request=>{githubCalls++;const u=new URL(request.url);const m=['dsbot','harness','ombre'].map(id=>meta[id]).find(x=>x.metadataApiSource===u.toString());assert.ok(m,'collector only contacts one of the three exact GitHub metadata URLs');return Response.json({full_name:new URL(m.repositoryUrl).pathname.slice(1),html_url:m.repositoryUrl,private:false,owner:{login:m.ownerLogin,id:m.ownerId,type:m.ownerType,html_url:m.ownerUrl,avatar_url:m.avatarUrl},stargazers_count:m.stars+1,forks_count:m.forks})},
 ASSETS:async ()=>new Response(readFileSync('dist/index.html'),{headers:{'content-type':'text/html'}}),
};
const mf=new Miniflare(convertV4MiniflareOptions({name:'gither-catalog-smoke',modules:true,scriptPath:'.catalog-dist/bundle/index.js',compatibilityDate:'2026-11-06',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{APP_ORIGIN:origin,COLLECTION_ENABLED:'true'},serviceBindings:services}));
const mfClosed=new Miniflare(convertV4MiniflareOptions({name:'gither-catalog-closed',modules:true,scriptPath:'.catalog-dist/bundle/index.js',compatibilityDate:'2026-11-06',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{APP_ORIGIN:origin,COLLECTION_ENABLED:'false'}}));
const results=[];
const ok=(label)=>{results.push(label);console.log('PASS',label)};
async function call(path,{method='GET',role,body,headers={}}={}){return mf.dispatchFetch(origin+path,{method,headers:{...(body===undefined?{}:{'content-type':'application/json',origin}),...(role?{authorization:'Bearer fixture-'+role}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})})}
const mcp=(body,headers={})=>call('/mcp',{method:'POST',body,headers:{accept:'application/json, text/event-stream','mcp-protocol-version':'2025-11-25',...headers}});
try{
 const db=await mf.getD1Database('DB');await db.exec(readFileSync('cloudflare/migrations/0001_catalog.sql','utf8').replace(/^--.*$/gm,'').replace(/\n/g,' '));
 assert.match(await (await call('/')).text(),/<div id="root">/);ok('Worker dispatch serves the built static frontend');
 let response=await call('/api/projects');assert.deepEqual((await response.json()).projects,[]);ok('empty public catalog does not fabricate sample/live results');
 response=await mfClosed.dispatchFetch(origin+'/api/admin/seed',{method:'POST',headers:{origin,'content-type':'application/json','x-role':'reviewer'},body:'{}'});assert.equal(response.status,503);ok('unconfigured admin auth fails closed before touching D1');
 response=await call('/api/admin/seed',{method:'POST',body:{},headers:{'x-role':'collector'}});assert.equal(response.status,403);assert.equal((await db.prepare('SELECT count(*) AS n FROM candidates').first()).n,0);ok('forged caller role cannot seed or write');
 response=await call('/api/admin/seed',{method:'POST',role:'collector',body:{}});assert.equal(response.status,200);assert.equal((await response.json()).changed,3);
 response=await call('/api/admin/seed',{method:'POST',role:'collector',body:{}});assert.equal((await response.json()).changed,0);ok('source-backed seeds insert once, pending review');
 assert.deepEqual((await (await call('/api/projects')).json()).projects,[]);
 let candidates=(await (await call('/api/admin/candidates',{role:'reviewer'})).json()).candidates;assert.equal(candidates.length,3);assert.ok(candidates.every(x=>x.status==='pending_review'&&x.provenance==='seed'));
 const first=candidates.find(x=>x.id==='dsbot');assert.ok(first);
 response=await call('/api/admin/review',{method:'POST',role:'collector',body:{id:first.id,revision:first.revision,decision:'publish',note:'fixture review'}});assert.equal(response.status,403);ok('collector cannot publish');
 response=await call('/api/admin/review',{method:'POST',role:'reviewer',body:{id:first.id,revision:first.revision,decision:'publish',note:'Synthetic test review, not a human production decision'}});assert.equal(response.status,200);
 response=await call('/api/admin/review',{method:'POST',role:'reviewer',body:{id:first.id,revision:first.revision,decision:'publish',note:'Duplicate'}});assert.equal(response.status,409);ok('review atomically publishes exact revision and rejects duplicate/stale decisions');
 let published=(await (await call('/api/projects')).json()).projects;assert.equal(published.length,1);assert.equal(published[0].id,'dsbot');const originalStars=published[0].metadata.stars;
 response=await call('/api/admin/collect',{method:'POST',role:'collector',body:{}});assert.equal(response.status,200);assert.deepEqual(await response.json(),{checked:3,changed:3,failed:0});assert.equal(githubCalls,3);
 candidates=(await (await call('/api/admin/candidates',{role:'reviewer'})).json()).candidates;const changed=candidates.find(x=>x.id==='dsbot');assert.equal(changed.status,'pending_review');assert.equal(changed.revision,first.revision+1);
 published=(await (await call('/api/projects')).json()).projects;assert.equal(published[0].metadata.stars,originalStars);ok('metadata refresh creates pending revision without overwriting publication');
 response=await call('/api/admin/collect',{method:'POST',role:'collector',body:{}});assert.equal((await response.json()).changed,0);ok('identical refresh is deduplicated');
 response=await call('/api/admin/review',{method:'POST',role:'reviewer',body:{id:changed.id,revision:changed.revision,decision:'reject',note:'Synthetic rejection'}});assert.equal(response.status,200);assert.equal((await (await call('/api/projects')).json()).projects[0].metadata.stars,originalStars);ok('rejecting new candidate preserves previously published snapshot');
 let rpc=await (await mcp({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'local-smoke',version:'1'}}})).json();assert.equal(rpc.result.protocolVersion,'2025-11-25');
 response=await mcp({jsonrpc:'2.0',method:'notifications/initialized'});assert.equal(response.status,202);
 rpc=await (await mcp({jsonrpc:'2.0',id:2,method:'tools/list'})).json();assert.equal(rpc.result.tools.length,3);assert.ok(rpc.result.tools.every(x=>x.annotations.readOnlyHint));
 rpc=await (await mcp({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'search_projects',arguments:{query:'Bot',limit:5}}})).json();assert.equal(rpc.result.structuredContent.projects.length,1);
 rpc=await (await mcp({jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'get_project',arguments:{id:'ombre'}}})).json();assert.equal(rpc.result.isError,true);ok('actual MCP initialize/list/call roundtrip sees only published project');
 rpc=await (await mcp({jsonrpc:'2.0',id:5,method:'tools/call',params:{name:'collection_status',arguments:{}}})).json();assert.deepEqual(Object.keys(rpc.result.structuredContent).sort(),['authenticationEnabled','collectionEnabled','feedbackEnabled','published']);
 rpc=await (await mcp({jsonrpc:'2.0',id:6,method:'tools/call',params:{name:'submit_user_feedback',arguments:{userId:'fake',rating:5}}})).json();assert.ok(rpc.error);ok('MCP has no publication or fabricated-user-feedback tool');
 for(const path of ['/api/feedback','/api/favorites','/api/auth/sign-in/social']){response=await call(path,{method:'POST',role:'collector',body:{userId:'fake'}});assert.equal(response.status,503)}
 assert.equal((await db.prepare('SELECT count(*) AS n FROM human_feedback').first()).n,0);ok('real human feedback remains empty and unavailable');
 response=await mcp({jsonrpc:'2.0',id:7,method:'tools/list'},{origin:'https://attacker.test'});assert.equal(response.status,403);
 response=await mcp({jsonrpc:'2.0',id:8,method:'tools/list'},{'mcp-protocol-version':'1900-01-01'});assert.equal(response.status,400);
 response=await mcp({jsonrpc:'2.0',id:9,method:'tools/list'},{accept:'text/html'});assert.equal(response.status,406);
 response=await mcp({jsonrpc:'2.0',id:10,method:'tools/call',params:{name:'search_projects',arguments:{query:'x'.repeat(121)}}});assert.equal((await response.json()).error.code,-32602);
 response=await call('/api/admin/review',{method:'POST',role:'reviewer',body:{id:'dsbot',revision:1,decision:'publish',note:'x'.repeat(20000)}});assert.equal(response.status,413);ok('origin, protocol, content negotiation, schema and body limits enforced');
 response=await call('/mcp',{method:'POST',body:{jsonrpc:'2.0',id:11,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'no-header-client',version:'1'}}},headers:{accept:'application/json, text/event-stream'}});assert.equal((await response.json()).result.protocolVersion,'2025-11-25');
 for(const method of ['GET','DELETE'])assert.equal((await call('/mcp',{method})).status,405);
 response=await mf.dispatchFetch(origin+'/mcp',{method:'POST',headers:{origin,accept:'application/json, text/event-stream','content-type':'application/json','mcp-protocol-version':'2025-11-25'},body:'{'});assert.equal((await response.json()).error.code,-32700);
 response=await mf.dispatchFetch(origin+'/mcp',{method:'POST',headers:{origin,accept:'application/json, text/event-stream','content-type':'application/json','mcp-protocol-version':'2025-11-25'},body:'[]'});assert.equal((await response.json()).error.code,-32600);ok('MCP negotiation without header, method rejection, parse errors and batch rejection verified');
 for(const supplied of [null,'null']){response=await mf.dispatchFetch(origin+'/api/admin/seed',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer fixture-collector',...(supplied===null?{}:{origin:supplied})},body:'{}'});assert.equal(response.status,403)}ok('admin missing or null Origin rejected even with synthetic valid role');
 assert.equal((await db.prepare('SELECT count(*) AS n FROM human_feedback').first()).n,0);
 console.log(JSON.stringify({passed:results.length,scope:'isolated local workerd/D1; synthetic auth and GitHub fixtures; zero cloud resources or real user signals'},null,2));
}finally{await Promise.all([mf.dispose(),mfClosed.dispose()])}
