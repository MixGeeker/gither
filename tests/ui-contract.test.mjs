import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const source=name=>readFileSync(new URL('../src/'+name,import.meta.url),'utf8');
const compiled=stripTypeScriptTypes(source('api.ts'),{mode:'strip'});
const {decodeProjects,decodeUserState,safeLink,api,ApiError}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const project=(id)=>({id,name:'Example '+id,url:'https://github.com/owner/repo-'+id,tagline:'A real purpose',points:['feature'],tags:['typescript']});
test('server catalog accepts arbitrary IDs, empty results and more than three projects',()=>{
 assert.equal(decodeProjects({projects:Array.from({length:75},(_,i)=>project('dynamic-'+i))}).length,75);
 assert.deepEqual(decodeProjects({projects:[]}),[]);
 const entry=decodeProjects({projects:[project('not-a-bundled-id')]})[0];assert.equal(entry.name,'Example not-a-bundled-id');assert.equal(entry.metadata,undefined);
});
test('server catalog rejects duplicate IDs, malformed data and unsafe project links',()=>{
 for(const data of [null,{}, {projects:[project('x'),project('x')]},{projects:[{...project('x'),url:'javascript:alert(1)'}]},{projects:[{...project('x'),id:null}]}])assert.throws(()=>decodeProjects(data));
});
test('unknown avatar and statistics remain unknown without invented identity',()=>{
 const [entry]=decodeProjects({projects:[{...project('x'),metadata:{ownerLogin:'owner',repositoryUrl:'https://github.com/owner/repo-x',stars:-1,forks:'100',avatar:'javascript:alert(1)',fetchedAt:'invalid'}}]});
 assert.equal(entry.metadata.stars,undefined);assert.equal(entry.metadata.forks,undefined);assert.equal(entry.metadata.avatar,undefined);assert.equal(entry.metadata.fetchedAt,undefined);
 const [valid]=decodeProjects({projects:[{...project('x'),metadata:{ownerLogin:'owner',stars:0,forks:10,avatar:'/avatars/owner.png',fetchedAt:'2026-11-06T10:00:00Z'}}]});assert.equal(valid.metadata.stars,0);assert.equal(valid.metadata.forks,10);
});
test('evidence links allow only http(s) without embedded credentials',()=>{
 assert.equal(safeLink('javascript:alert(1)'),undefined);assert.equal(safeLink('https://name:secret@example.com'),undefined);assert.equal(safeLink('data:text/html,<h1>x</h1>'),undefined);assert.equal(safeLink('https://github.com/owner/repo'),'https://github.com/owner/repo');
});
test('personal decision state validates arrays and does not filter to bundled IDs',()=>{
 assert.deepEqual(decodeUserState({saved:['new-project','new-project'],dismissed:['other']}),{saved:['new-project'],dismissed:['other'],canUndo:undefined,history:undefined});
 assert.throws(()=>decodeUserState({saved:[1],dismissed:[]}));assert.throws(()=>decodeUserState({saved:[]}));
});
test('API calls use same-origin session, no-store, and fail instead of treating HTML as data',async()=>{
 const oldFetch=globalThis.fetch;try{globalThis.fetch=async(path,options)=>{assert.equal(path,'/api/projects');assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store');return new Response('<html/>',{headers:{'Content-Type':'text/html'}})};await assert.rejects(api('/api/projects'),error=>error instanceof ApiError&&error.code==='NOT_JSON')}finally{globalThis.fetch=oldFetch}
});
test('expired sessions clear the authenticated shell; failed sign-in does not emit expiry',async()=>{
 const oldFetch=globalThis.fetch,oldWindow=globalThis.window;const events=[];try{globalThis.window={dispatchEvent:e=>events.push(e.type)};globalThis.fetch=async()=>Response.json({code:'SESSION_REQUIRED'},{status:401});await assert.rejects(api('/api/me/state'));assert.deepEqual(events,['gither:session-expired']);await assert.rejects(api('/api/auth/sign-in/email',{method:'POST',body:{email:'test@example.invalid',password:'test-only'},sessionCheck:true}));assert.equal(events.length,1)}finally{globalThis.fetch=oldFetch;globalThis.window=oldWindow}
});
test('production gate only permits demo fallback outside required self-hosted mode',()=>{
 const root=source('Root.tsx');assert.match(root,/VITE_SELF_HOSTED==='true'/);assert.match(root,/!requiredSelfHosted&&error instanceof ApiError/);assert.match(root,/system.selfHosted!==true/);assert.match(root,/session\?\.user\?\{kind:'ready'/);assert.doesNotMatch(source('AuthPanel.tsx'),/sign-in\/social|localStorage|sign-up/);
});
test('authenticated UI stores only user-specific theme, never favorites, password or raw keys',()=>{
 const app=source('SelfHostedApp.tsx');const writes=app.match(/localStorage\.setItem\([^;]+/g)||[];assert.equal(writes.length,1);assert.match(writes[0],/gither-theme:/);assert.doesNotMatch(app,/defaultProjects|projectExamples/);
 for(const name of ['KeysPanel.tsx','ProfilePanel.tsx','AuthPanel.tsx','PoolPanel.tsx'])assert.doesNotMatch(source(name),/localStorage|sessionStorage|console\./);
 assert.match(source('KeysPanel.tsx'),/setPassword\(''\)/);assert.match(source('KeysPanel.tsx'),/setRevokePassword\(''\)/);assert.match(source('KeysPanel.tsx'),/setCreated\(null\)/);
});
test('settings preserve human-only approval, optimistic versioning and exploration allocation',()=>{
 assert.match(source('ProfilePanel.tsx'),/expectedVersion:profile.version/);assert.match(source('ProfilePanel.tsx'),/total===100/);assert.match(source('ProfilePanel.tsx'),/exploration.weight>0/);assert.match(source('PoolPanel.tsx'),/expectedVersion:rules.version/);assert.match(source('PoolPanel.tsx'),/idempotencyKey/);assert.match(source('PoolPanel.tsx'),/排队不代表已自动采集/);assert.match(source('ProjectCard.tsx'),/const meta=live\?p.metadata:/);assert.match(source('ProjectCard.tsx'),/const scenario=live\?runtimeScenario\(p\):/);
});
test('self-hosted sharing resolves only session catalog IDs and preserves PWA privacy warning',()=>{
 const app=source('SelfHostedApp.tsx');assert.match(app,/parseSharedSelection\(window.location.search,next.map\(p=>p.id\)\)/);assert.match(app,/ShareDialog privateCatalog/);assert.match(source('ShareDialog.tsx'),/必须登录同一账号/);assert.match(source('InstallPanel.tsx'),/不缓存账号、密钥、私人项目或收藏 API/);assert.match(source('InstallPanel.tsx'),/registerPwa/);
});
test('agent proposals are read-only suggestions with explicit human clear confirmation',()=>{
 const pool=source('PoolPanel.tsx');assert.match(pool,/api<\{proposals:PoolProposal\[\]\}>\('\/api\/me\/proposals'/);assert.match(pool,/method:'DELETE',body:\{\}/);assert.match(pool,/if\(locked.current\|\|!confirmClear\)return/);assert.match(pool,/确认清空所有建议/);assert.match(pool,/setConfirmClear\(false\).*取消/);assert.match(pool,/不会自动应用/);assert.doesNotMatch(pool,/method:'PUT'.*\/api\/me\/subscriptions/);assert.match(source('AccountPanel.tsx'),/首次创建管理员账号或重置密码/);assert.doesNotMatch(source('AccountPanel.tsx'),/新增账号/);
});

test('authenticated runtime cards render full text scenarios and verified avatars without diagrams or invented metrics',async()=>{
 const {build}=await import('esbuild');const {createRequire}=await import('node:module');const {runInNewContext}=await import('node:vm');const require=createRequire(import.meta.url);
 const result=await build({entryPoints:[new URL('../src/ProjectCard.tsx',import.meta.url).pathname],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',jsx:'automatic',logLevel:'silent'});
 const module={exports:{}};runInNewContext(result.outputFiles[0].text,{module,exports:module.exports,require,URL,window:{innerWidth:440}});
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
 const fixture={...project('generated-backend-id'),owner:'qingj01 / ds-bot-app',url:'https://github.com/qingj01/ds-bot-app',category:'效率',description:'Reviewed description',use:'Legacy scenario',points:['Legacy capability'],card:{capabilities:['Full capability one','Full capability two','Full capability three','Full capability four'],useCase:'Concrete scenario that must remain completely visible in the text content.'},metadata:{repositoryUrl:'https://github.com/qingj01/ds-bot-app',ownerLogin:'qingj01'}};
 const render=p=>renderToStaticMarkup(React.createElement(module.exports.default,{p,live:true,remaining:1,onAction:()=>{},onDetail:()=>{},busy:false}));
 const html=render(fixture);assert.match(html,/has-scenario/);assert.match(html,/核心能力/);assert.match(html,/场景示例/);for(const text of [...fixture.card.capabilities,fixture.card.useCase])assert.ok(html.includes(text));assert.doesNotMatch(html,/cover-diagram|diagram-step|功能示意/);assert.match(html,/src="\/avatars\/dsbot.png"/);assert.doesNotMatch(html,/189 stars|13 forks/);assert.match(html,/star 统计不可用/);assert.match(html,/fork 统计不可用/);
 const legacy=render({...fixture,card:undefined,url:'https://github.com/unknown-owner/unknown-repo',metadata:undefined});assert.match(legacy,/Legacy capability/);assert.match(legacy,/Legacy scenario/);assert.doesNotMatch(legacy,/cover-diagram|diagram-step|src="\/avatars/);
});
