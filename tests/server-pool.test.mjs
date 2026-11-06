import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createPoolService, canonicalRepository, allocateFlavorTargets } from '../.server-dist/pool.js';
import { createMcpHandler, MCP_PROTOCOL_VERSION, ONBOARDING_URI } from '../.server-dist/mcp.js';

const scopes=['catalog:read','pool:read','pool:write','candidates:read','candidates:write','profile:read','collection:claim'];
const principal=(userId='alice',keyId='key-a',selected=scopes)=>({userId,keyId,scopes:selected});
const draft=(i=1,overrides={})=>({repositoryUrl:`https://github.com/example/repo-${i}`,title:`Repository ${i}`,purpose:'A practical project discovery example',description:'Useful software described without executing third-party code.',capabilities:['Organizes a concrete workflow','Exports a useful result'],useCase:'A small team can organize a task and export its result.',tags:['tool'],evidence:[{url:`https://github.com/example/repo-${i}#readme`,claim:'The README documents the workflow and export capability.'}],...overrides});
function fixture(options={}){let time=1_000_000;const db=new DatabaseSync(':memory:');const service=createPoolService(db,{now:()=>time,leaseMs:1000,baseBackoffMs:100,collectionCooldownMs:1000,...options});return{db,s:service,tick:(amount)=>time+=amount};}
function published(f,count,user='alice') {for(let i=0;i<count;i++){const d=draft(i);f.db.prepare('INSERT INTO catalog_projects(id,user_id,candidate_id,canonical_repository,snapshot_json,published_at) VALUES (?,?,?,?,?,?)').run(`p-${user}-${i}`,user,`c-${user}-${i}`,`example/repo-${i}`,JSON.stringify(d),100);}}
const claim=(s,p=principal(),key='claim-1')=>{const c=s.claimJob(p,{idempotencyKey:key});assert.ok(c);return c;};
const bound=c=>({jobId:c.job.id,claimToken:c.claimToken});
const rejects=(fn,code)=>assert.throws(fn,e=>e?.code===code);

test('threshold exactly 30 does not queue; 29 queues target 60, not refill-to-30',()=>{
 const at30=fixture();published(at30,30);assert.equal(at30.s.getStatus('alice').activeJob,null);assert.equal(at30.s.getStatus('alice').availableCount,30);
 const at29=fixture();published(at29,29);const status=at29.s.getStatus('alice');assert.equal(status.activeJob.batchTarget,60);assert.equal(status.activeJob.assessedCount,0);assert.equal(status.availableCount,29);assert.equal(at29.s.getJobs('alice').length,1);
});
test('available excludes owner saved, dismissed and unpublished, not another user decisions',()=>{
 const f=fixture();published(f,34);published(f,1,'bob');f.s.saveDecision('alice','p-alice-0','saved');f.s.saveDecision('alice','p-alice-1','dismissed');f.s.setProjectAvailability('alice','p-alice-2',false);assert.equal(f.s.getStatus('alice').availableCount,31);
 f.s.saveDecision('bob','p-bob-0','saved');assert.equal(f.s.getStatus('alice').availableCount,31);f.s.saveDecision('alice','p-alice-3','dismissed');assert.equal(f.s.getStatus('alice').activeJob,null);f.s.saveDecision('alice','p-alice-4','dismissed');assert.equal(f.s.getStatus('alice').activeJob.batchTarget,60);
 rejects(()=>f.s.saveDecision('bob','p-alice-0','saved'),'NOT_FOUND');
});
test('available catalog has no 30-project cap',()=>{const f=fixture();published(f,65);assert.equal(f.s.listCatalog('alice').length,65);assert.equal(f.s.getStatus('alice').availableCount,65);});
test('competing claimers get one atomic lease and identical live idempotent replay',async()=>{
 const f=fixture(),second=createPoolService(f.db,{now:()=>1_000_000,leaseMs:1000,baseBackoffMs:100});
 const results=await Promise.all([Promise.resolve().then(()=>f.s.claimJob(principal(),{idempotencyKey:'same'})),Promise.resolve().then(()=>second.claimJob(principal('alice','key-b'),{idempotencyKey:'other'}))]);
 assert.equal(results.filter(Boolean).length,1);const first=results[0];assert.deepEqual(f.s.claimJob(principal(),{idempotencyKey:'same'}),first);assert.equal(f.s.getJobs('alice').length,1);assert.ok(!('claimToken'in f.s.getJobs('alice')[0]));
});
test('lease expiry rejects old writes, backs off, and permits only a new bound claim',()=>{
 const f=fixture(),c=claim(f.s);f.tick(1001);rejects(()=>f.s.submitCandidates(principal(),{...bound(c),idempotencyKey:'s1',candidates:[draft()]}),'LEASE_EXPIRED');assert.equal(f.s.claimJob(principal(),{idempotencyKey:'new'}),null);assert.equal(f.s.getJobs('alice')[0].status,'backoff');
 f.tick(100);const next=claim(f.s,principal(),'next');assert.equal(next.job.attempt,2);assert.notEqual(next.claimToken,c.claimToken);rejects(()=>f.s.heartbeatJob(principal(),bound(c)),'CLAIM_MISMATCH');rejects(()=>f.s.claimJob(principal(),{idempotencyKey:'claim-1'}),'CLAIM_REPLAY_EXPIRED');
});
test('failed attempts use exponential backoff and stop after bounded retries until human retry',()=>{
 const f=fixture();for(let attempt=1;attempt<=3;attempt++){const c=claim(f.s,principal(),`claim-${attempt}`);const result=f.s.finishJob(principal(),{...bound(c),outcome:'failed',summary:'Search source unavailable'});assert.equal(result.status,attempt===3?'failed':'backoff');if(attempt<3){assert.equal(f.s.claimJob(principal(),{idempotencyKey:`early-${attempt}`}),null);f.tick(100*2**(attempt-1));}}
 f.tick(1_000_000);assert.equal(f.s.claimJob(principal(),{idempotencyKey:'automatic-fourth'}),null);assert.equal(f.s.getStatus('alice').activeJob,null);const retry=f.s.retryFailedJob('alice');assert.equal(retry.status,'queued');assert.equal(retry.attempt,0);assert.equal(f.s.getJobs('alice').length,2);
});
test('wrong scope, owner, API key and claim token cannot submit or mutate leases',()=>{
 const f=fixture(),c=claim(f.s);const input={...bound(c),idempotencyKey:'submission',candidates:[draft()]};
 rejects(()=>f.s.submitCandidates(principal('alice','key-a',['pool:read']),input),'INSUFFICIENT_SCOPE');rejects(()=>f.s.submitCandidates(principal('bob','key-a'),input),'NOT_FOUND');rejects(()=>f.s.submitCandidates(principal('alice','key-b'),input),'CLAIM_MISMATCH');rejects(()=>f.s.submitCandidates(principal(),{...input,claimToken:'wrong'}),'CLAIM_MISMATCH');rejects(()=>f.s.claimJob(principal('bob','key-b',['collection:claim']),{idempotencyKey:'no-profile'}),'INSUFFICIENT_SCOPE');
 assert.equal(f.s.getCandidates('alice').length,0);assert.equal(f.s.getCandidates('bob').length,0);
});
test('submission idempotency, canonical deduplication and pending review do not inflate pool availability',()=>{
 const f=fixture(),c=claim(f.s),input={...bound(c),idempotencyKey:'s1',candidates:[draft()]};const first=f.s.submitCandidates(principal(),input);assert.equal(first.assessedCount,1);assert.equal(first.results[0].outcome,'pending');assert.deepEqual(f.s.submitCandidates(principal(),input),first);assert.equal(f.s.getCandidates('alice').length,1);assert.equal(f.s.getStatus('alice').availableCount,0);assert.equal(f.s.getStatus('alice').pendingCount,1);
 rejects(()=>f.s.submitCandidates(principal(),{...input,candidates:[draft(2)]}),'IDEMPOTENCY_CONFLICT');
 const dupe=f.s.submitCandidates(principal(),{...input,idempotencyKey:'s2',candidates:[draft(1,{repositoryUrl:'https://github.com/EXAMPLE/REPO-1.git/'})]});assert.equal(dupe.assessedCount,1);assert.equal(dupe.results[0].outcome,'duplicate');assert.equal(canonicalRepository('https://github.com/EXAMPLE/REPO-1.git/'),'example/repo-1');
 rejects(()=>f.s.submitCandidates(principal(),{...input,idempotencyKey:'s3',candidates:[draft(),draft(1,{repositoryUrl:'https://github.com/Example/Repo-1.git'})]}),'DUPLICATE_IN_BATCH');
});
test('candidate budget is 60 independent of approval, batches max60, completion cannot be faked',()=>{
 const f=fixture(),c=claim(f.s);rejects(()=>f.s.finishJob(principal(),{...bound(c),outcome:'completed'}),'CANDIDATE_TARGET_INCOMPLETE');
 rejects(()=>f.s.submitCandidates(principal(),{...bound(c),idempotencyKey:'too-large',candidates:Array.from({length:61},(_,i)=>draft(i))}),'INVALID_BATCH');
 const first=f.s.submitCandidates(principal(),{...bound(c),idempotencyKey:'sixty',candidates:Array.from({length:60},(_,i)=>draft(i))});assert.equal(first.assessedCount,60);assert.equal(first.remaining,0);assert.equal(f.s.getStatus('alice').availableCount,0);assert.equal(f.s.getStatus('alice').pendingCount,60);
 rejects(()=>f.s.submitCandidates(principal(),{...bound(c),idempotencyKey:'over',candidates:[draft(61)]}),'CANDIDATE_BUDGET_EXCEEDED');
 const complete=f.s.finishJob(principal(),{...bound(c),outcome:'completed',summary:'60 repository candidates submitted for human review.'});assert.equal(complete.status,'completed');assert.deepEqual(f.s.finishJob(principal(),{...bound(c),outcome:'completed',summary:complete.summary}),complete);rejects(()=>f.s.finishJob(principal('alice','key-b'),{...bound(c),outcome:'completed',summary:complete.summary}),'CLAIM_MISMATCH');assert.equal(f.s.getStatus('alice').activeJob,null);f.tick(1001);assert.equal(f.s.getStatus('alice').activeJob.batchTarget,60);
});
test('known canonical repositories deduplicate across jobs even after saved or dismissed, similarity never merges',()=>{
 const f=fixture();const seeds=f.s.seedCandidates('alice',[draft(1),draft(2)]);const p1=f.s.reviewCandidate('alice',seeds[0].id,'approved').project;const p2=f.s.reviewCandidate('alice',seeds[1].id,'approved').project;f.s.saveDecision('alice',p1.id,'saved');f.s.saveDecision('alice',p2.id,'dismissed');const c=claim(f.s);
 const result=f.s.submitCandidates(principal(),{...bound(c),idempotencyKey:'known',candidates:[draft(1),draft(2),draft('1-fork')]});assert.equal(result.assessedCount,3);assert.deepEqual(result.results.map(r=>r.outcome),['duplicate','duplicate','pending']);assert.equal(f.s.getCandidates('alice').length,3);assert.equal(f.s.getStatus('alice').availableCount,0);
});
test('owner review is idempotent, append-only and publishes immutable snapshot; unpublishing excludes availability',()=>{
 const f=fixture(),c=f.s.seedCandidates('alice',[draft()])[0];assert.equal(c.status,'pending');assert.equal(f.s.listCatalog('alice').length,0);rejects(()=>f.s.reviewCandidate('bob',c.id,'approved'),'NOT_FOUND');
 const approved=f.s.reviewCandidate('alice',c.id,'approved','Reviewed source','review1');assert.ok(approved.project);assert.deepEqual(f.s.reviewCandidate('alice',c.id,'approved','Reviewed source','review1'),approved);assert.equal(f.db.prepare('SELECT count(*) n FROM catalog_reviews').get().n,1);
 rejects(()=>f.s.reviewCandidate('alice',c.id,'rejected','Changed','review1'),'IDEMPOTENCY_CONFLICT');rejects(()=>f.s.reviewCandidate('alice',c.id,'rejected','','review2'),'ALREADY_REVIEWED');assert.throws(()=>f.db.exec("UPDATE catalog_reviews SET note='erase'"),/append-only/);assert.throws(()=>f.db.exec('DELETE FROM catalog_reviews'),/append-only/);
 f.s.setProjectAvailability('alice',approved.project.id,false);assert.equal(f.s.getStatus('alice').availableCount,0);assert.equal(f.s.listCatalog('alice').length,0);f.s.setProjectAvailability('alice',approved.project.id,true);assert.equal(f.s.listCatalog('alice')[0].purpose,draft().purpose);
});
test('profile versions validate ratios and exploration, freeze per job, and remain user-isolated',()=>{
 const f=fixture();const before=f.s.getProfile('alice'),c=claim(f.s);const changed=f.s.setProfile('alice',{topics:['databases'],sources:['github:topics'],flavors:[{id:'relevance',label:'Focus',weight:75},{id:'exploration',label:'Explore',weight:25}],excludedTopics:['gambling'],expectedVersion:before.version});assert.equal(changed.version,2);assert.deepEqual(f.s.getJobs('alice')[0].profileSnapshot,before);assert.equal(f.s.getProfile('bob').version,1);
 rejects(()=>f.s.setProfile('alice',{...changed,version:undefined,expectedVersion:1}),'INVALID_INPUT');const {version,...valid}=changed;rejects(()=>f.s.setProfile('alice',{...valid,expectedVersion:1}),'VERSION_CONFLICT');rejects(()=>f.s.setProfile('alice',{...valid,flavors:[{id:'exploration',label:'Explore',weight:99}]}),'INVALID_PROFILE');rejects(()=>f.s.setProfile('alice',{...valid,flavors:[{id:'relevance',label:'Focus',weight:100},{id:'exploration',label:'Explore',weight:0}]}),'INVALID_PROFILE');
 f.s.setRules('alice',{refillThreshold:20,batchTarget:42});assert.equal(f.s.getJobs('alice')[0].batchTarget,60);assert.equal(f.s.getJobs('alice')[0].rulesSnapshot.version,1);assert.equal(c.job.profileSnapshot.version,1);
});
test('new job uses new profile/rules; changing preferences does not rewrite in-flight job',()=>{
 const f=fixture({maxAttempts:1});const c=claim(f.s);f.s.setProfile('alice',{topics:['graphics'],sources:['github'],flavors:[{id:'exploration',label:'Explore',weight:100}],excludedTopics:[],expectedVersion:1});f.s.setRules('alice',{refillThreshold:40,batchTarget:10});f.s.finishJob(principal(),{...bound(c),outcome:'failed',summary:'Cannot continue'});const next=f.s.retryFailedJob('alice');assert.equal(next.batchTarget,10);assert.equal(next.profileSnapshot.version,2);assert.deepEqual(next.profileSnapshot.topics,['graphics']);assert.equal(next.rulesSnapshot.refillThreshold,40);
});
test('durable undo restores prior decision and a single dismissal never edits explicit preferences',()=>{
 const f=fixture();published(f,30);const before=f.s.getProfile('alice');f.s.saveDecision('alice','p-alice-0','saved');f.s.saveDecision('alice','p-alice-0','dismissed');assert.deepEqual(f.s.getProfile('alice'),before);assert.deepEqual(f.s.getFeedback(principal()).suggestions,[]);
 const reloaded=createPoolService(f.db);assert.equal(reloaded.undoDecision('alice').decision,'saved');assert.deepEqual(reloaded.getDecisions('alice'),{saved:['p-alice-0'],dismissed:[]});assert.equal(reloaded.undoDecision('alice').decision,'none');assert.deepEqual(reloaded.getDecisions('alice'),{saved:[],dismissed:[]});assert.equal(reloaded.undoDecision('alice').undone,false);assert.equal(reloaded.undoDecision('bob').undone,false);
});
test('agent proposals never rewrite human rules, subscriptions or discovery profile',()=>{
 const f=fixture();const before={profile:f.s.getProfile('alice'),rules:f.s.getRules('alice')};f.s.proposeSubscriptions(principal(),[{id:'graphics',label:'Graphics',query:'graphics language:rust',enabled:true}]);f.s.proposeCollectionPlan(principal(),{rationale:'Broaden relevant candidates',queries:['topic:graphics']});assert.deepEqual(f.s.getSubscriptions('alice'),[]);assert.deepEqual(f.s.getProfile('alice'),before.profile);assert.deepEqual(f.s.getRules('alice'),before.rules);assert.equal(f.s.getProposals('alice').length,2);assert.equal(f.s.getProposals('bob').length,0);
});
test('evidence only accepts same-repository bounded GitHub HTTPS URLs and no fabricated stats are required',()=>{
 const f=fixture(),c=claim(f.s);for(const url of ['http://github.com/example/repo-1','https://github.com.evil.test/example/repo-1','https://user:pass@github.com/example/repo-1','https://github.com/other/repo-1','https://github.com/example/repo-1?token=private','https://github.com/example/repo-1/%2e%2e/secrets'])assert.throws(()=>f.s.submitCandidates(principal(),{...bound(c),idempotencyKey:'invalid-url',candidates:[draft(1,{evidence:[{url,claim:'Test'}]})]}));
 const result=f.s.submitCandidates(principal(),{...bound(c),idempotencyKey:'safe',candidates:[draft()]});assert.equal(result.results[0].outcome,'pending');assert.equal(f.s.getCandidates('alice')[0].stars,undefined);assert.equal(f.s.getCandidates('alice')[0].language,undefined);
});
async function mcpCall(handler,method,params={},p=principal(),extra={}){const request=new Request('http://localhost/mcp',{method:'POST',headers:{'content-type':'application/json','accept':'application/json, text/event-stream','mcp-protocol-version':MCP_PROTOCOL_VERSION,...extra.headers},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});const response=await handler(request,p);return {status:response.status,body:await response.json()};}
test('MCP pinned protocol initializes with discoverable onboarding resource, prompt and schema tools',async()=>{
 const f=fixture(),handler=createMcpHandler(f.s);const init=await mcpCall(handler,'initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test-client',version:'1'}});assert.equal(init.body.result.protocolVersion,MCP_PROTOCOL_VERSION);assert.ok(init.body.result.capabilities.resources);assert.ok(init.body.result.capabilities.prompts);
 const resources=(await mcpCall(handler,'resources/list')).body.result.resources;assert.equal(resources[0].uri,ONBOARDING_URI);const resource=(await mcpCall(handler,'resources/read',{uri:ONBOARDING_URI})).body.result.contents[0].text;assert.match(resource,/UNTRUSTED DATA/);assert.match(resource,/NOT sixty approvals/);assert.match(resource,/exploration/);
 const prompt=(await mcpCall(handler,'prompts/get',{name:'gither_collector_onboarding'})).body.result;assert.equal(prompt.messages[0].content.text,resource);
 const list=(await mcpCall(handler,'tools/list')).body.result.tools;assert.ok(list.some(t=>t.name==='submit_candidates'));assert.ok(!list.some(t=>/save|dismiss|review_candidate|set_rules|set_profile/.test(t.name)));assert.equal(list.find(t=>t.name==='submit_candidates').inputSchema.properties.candidates.maxItems,60);assert.equal(list.find(t=>t.name==='pool_status').annotations.readOnlyHint,false);
});
test('MCP scoped keys cannot bypass profile/catalog/feedback scopes or mutate human authority',async()=>{
 const f=fixture(),handler=createMcpHandler(f.s),limited=principal('alice','limited',['pool:read']);
 for(const name of ['discovery_profile','pool_subscriptions','list_projects','candidate_feedback']){const result=await mcpCall(handler,'tools/call',{name,arguments:{}},limited);assert.equal(result.body.result.isError,true);assert.match(result.body.result.content[0].text,/INSUFFICIENT_SCOPE/);}
 const status=(await mcpCall(handler,'tools/call',{name:'pool_status',arguments:{}},limited)).body.result.structuredContent;assert.equal(status.activeJob.profileSnapshot,undefined);assert.equal(status.activeJob.subscriptionsSnapshot,undefined);assert.equal(status.activeJob.profileSnapshotRedacted,true);
 for(const name of ['set_rules','set_profile','save_decision','review_candidate'])assert.equal((await mcpCall(handler,'tools/call',{name,arguments:{}})).body.error.code,-32602);
 assert.equal((await mcpCall(handler,'tools/call',{name:'pool_rules',arguments:{refillThreshold:1}})).body.error.code,-32602);
 const noProfile=await mcpCall(handler,'tools/call',{name:'claim_collection_job',arguments:{idempotencyKey:'x'}},principal('alice','c',['collection:claim']));assert.equal(noProfile.body.result.isError,true);
});
test('MCP rejects malformed envelopes, wrong protocol, unsupported transport and oversize bodies',async()=>{
 const f=fixture(),handler=createMcpHandler(f.s);const wrong=await mcpCall(handler,'ping',{},principal(),{headers:{'mcp-protocol-version':'2099-01-01'}});assert.equal(wrong.status,400);
 const req=(body,headers={})=>new Request('http://localhost/mcp',{method:'POST',headers:{'content-type':'application/json','accept':'application/json, text/event-stream','mcp-protocol-version':MCP_PROTOCOL_VERSION,...headers},body});
 assert.equal((await handler(req('{}'),principal())).status,400);assert.equal((await handler(req('{'),principal())).status,400);assert.equal((await handler(req(JSON.stringify([{jsonrpc:'2.0',id:1,method:'ping'}])),principal())).status,400);assert.equal((await handler(req('x'.repeat(1024*1024+1)),principal())).status,413);assert.equal((await handler(req('{}',{'accept':'application/json'}),principal())).status,406);assert.equal((await handler(new Request('http://localhost/mcp'),principal())).status,405);assert.equal((await handler(req('{}'),null)).status,401);
 const notification=await handler(req(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})),principal());assert.equal(notification.status,202);assert.equal(await notification.text(),'');
});


test('aggregate feedback requires repeated decisions, stays explainable and undo removes its contribution',()=>{
 const f=fixture();published(f,30);const original=f.s.getProfile('alice');f.s.saveDecision('alice','p-alice-0','dismissed');let feedback=f.s.getFeedback(principal());assert.equal(feedback.signals[0].score,-0.5);assert.equal(feedback.signals[0].evidence,'insufficient');assert.equal(feedback.suggestions.length,0);
 f.s.saveDecision('alice','p-alice-1','dismissed');f.s.saveDecision('alice','p-alice-2','dismissed');feedback=f.s.getFeedback(principal());assert.equal(feedback.signals[0].score,-1.5);assert.equal(feedback.suggestions[0].direction,'less');assert.equal(feedback.suggestions[0].requiresHumanApproval,true);assert.match(feedback.suggestions[0].explanation,/not to ban/);assert.deepEqual(f.s.getProfile('alice'),original);
 f.s.undoDecision('alice');feedback=f.s.getFeedback(principal());assert.equal(feedback.signals[0].samples,2);assert.equal(feedback.suggestions.length,0);
 f.s.saveDecision('alice','p-alice-3','saved');f.s.saveDecision('alice','p-alice-4','saved');f.s.saveDecision('alice','p-alice-5','saved');feedback=f.s.getFeedback(principal());assert.equal(feedback.signals[0].score,5);assert.equal(feedback.suggestions[0].direction,'more');assert.equal(f.s.getFeedback(principal('bob')).signals.length,0);
 const {version,...profile}=original;f.s.setProfile('alice',{...profile,excludedTopics:['tool'],expectedVersion:version});assert.equal(f.s.getFeedback(principal()).suggestions.length,0);
});
test('jobs freeze aggregate feedback and integer flavor allocation preserves total and exploration',()=>{
 const f=fixture();published(f,34);for(let i=0;i<5;i++)f.s.saveDecision('alice',`p-alice-${i}`,'saved');const job=f.s.getJobs('alice')[0];assert.equal(job.feedbackSnapshot.signals[0].saved,5);assert.deepEqual(job.flavorTargets.map(x=>x.candidateTarget),[54,6]);assert.equal(job.flavorTargets.reduce((sum,x)=>sum+x.candidateTarget,0),60);f.s.undoDecision('alice');assert.equal(f.s.getFeedback(principal()).signals[0].saved,4);assert.equal(f.s.getJobs('alice')[0].feedbackSnapshot.signals[0].saved,5);
 const profile={version:1,topics:[],sources:[],excludedTopics:[],flavors:[{id:'focus',label:'Focus',weight:95},{id:'exploration',label:'Explore',weight:5}]};assert.deepEqual(allocateFlavorTargets(profile,7).map(x=>x.candidateTarget),[6,1]);assert.deepEqual(allocateFlavorTargets(profile,1).map(x=>x.candidateTarget),[0,1]);
 const status=f.s.getAgentStatus(principal('alice','limited',['pool:read']));assert.equal(status.activeJob.feedbackSnapshot,undefined);assert.equal(status.activeJob.flavorTargets,undefined);
});


test('MCP wire-level collection lifecycle submits pending candidates, supports request metadata and cannot publish',async()=>{
 const f=fixture();f.s.setRules('alice',{refillThreshold:1,batchTarget:2});const handler=createMcpHandler(f.s);
 const negotiated=await mcpCall(handler,'initialize',{protocolVersion:'2099-01-01',capabilities:{},clientInfo:{name:'future-client',version:'1'},_meta:{progressToken:'init'}});assert.equal(negotiated.body.result.protocolVersion,MCP_PROTOCOL_VERSION);
 assert.deepEqual((await mcpCall(handler,'resources/templates/list',{_meta:{}})).body.result.resourceTemplates,[]);
 const claimed=(await mcpCall(handler,'tools/call',{name:'claim_collection_job',arguments:{idempotencyKey:'wire-claim'},_meta:{progressToken:'collect'}})).body.result.structuredContent.claim;assert.equal(claimed.job.batchTarget,2);
 const args={...bound(claimed),idempotencyKey:'wire-submit',candidates:[draft(101),draft(102)]};const result=await mcpCall(handler,'tools/call',{name:'submit_candidates',arguments:args});assert.equal(result.body.result.isError,false);assert.equal(result.body.result.structuredContent.assessedCount,2);assert.deepEqual((await mcpCall(handler,'tools/call',{name:'submit_candidates',arguments:args})).body.result.structuredContent,result.body.result.structuredContent);
 const finished=(await mcpCall(handler,'tools/call',{name:'finish_collection_job',arguments:{...bound(claimed),outcome:'completed',summary:'Two sourced candidates; awaiting human review.'}})).body.result.structuredContent;assert.equal(finished.status,'completed');assert.equal(f.s.getStatus('alice').availableCount,0);assert.equal(f.s.getStatus('alice').pendingCount,2);assert.equal(f.s.getCandidates('alice')[0].status,'pending');
});


test('proposal storage is atomically capped per owner and only human service may clear it',async()=>{
 const f=fixture();for(let i=0;i<100;i++)f.s.proposeCollectionPlan(principal(),{rationale:`Plan ${i}`,queries:[`topic:idea-${i}`]});assert.equal(f.s.getProposals('alice').length,100);
 rejects(()=>f.s.proposeSubscriptions(principal(),[{id:'overflow',label:'Overflow',query:'extra query',enabled:true}]),'PROPOSAL_LIMIT_REACHED');assert.equal(f.s.getProposals('alice').length,100);
 f.s.proposeCollectionPlan(principal('bob','key-b'),{rationale:'Other owner',queries:['topic:separate']});assert.equal(f.s.getProposals('bob').length,1);assert.deepEqual(f.s.clearProposals('alice'),{deleted:100});assert.equal(f.s.getProposals('bob').length,1);
 f.s.proposeCollectionPlan(principal(),{rationale:'New plan after human review',queries:['topic:next']});assert.equal(f.s.getProposals('alice').length,1);
 assert.equal((await mcpCall(createMcpHandler(f.s),'tools/call',{name:'clear_proposals',arguments:{}})).body.error.code,-32602);
});
