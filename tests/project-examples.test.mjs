import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {projectExamples,exampleScenarios} from '../.test-dist/project-examples.js';
import {covers} from '../.test-dist/covers.js';
const metadata=JSON.parse(readFileSync(new URL('../src/github-metadata.json',import.meta.url),'utf8'));
test('local example set contains exactly the three requested official repositories',()=>{
 assert.deepEqual(projectExamples.map(p=>p.url),['https://github.com/QingJ01/DS-Bot-App','https://github.com/deepseek-ai/deepseek-harness','https://github.com/P0luz/Ombre-Brain']);
 assert.equal(new Set(projectExamples.map(p=>p.id)).size,3);
});
test('every example has a cover, dated real metadata, source and local avatar',()=>{
 for(const p of projectExamples){const m=metadata[p.id],s=exampleScenarios[p.id];assert.ok(covers[p.id]);assert.ok(s.source.startsWith(p.url));assert.equal(m.repositoryUrl,p.url);assert.match(m.fetchedAt,/2026-11-06T/);assert.ok(Number.isInteger(m.stars)&&Number.isInteger(m.forks));assert.ok(existsSync(new URL('../public'+m.avatar,import.meta.url)));}
});
test('example cards label illustrations and omit usage barriers and risk blocks',()=>{
 const card=readFileSync(new URL('../src/ProjectCard.tsx',import.meta.url),'utf8');assert.match(card,/场景示意 · 非运行结果/);
 const component=readFileSync(new URL('../src/ScenarioPreview.tsx',import.meta.url),'utf8');assert.doesNotMatch(component,/prerequisite|figcaption|使用门槛|风险/);
 for(const s of Object.values(exampleScenarios))assert.equal('prerequisite' in s,false);
});

test('example titles name concrete capabilities rather than slogans',()=>{
 assert.deepEqual(projectExamples.map(p=>p.tagline),['Bot 团队远程控制','AI Agent 运行环境','Agent 长期情绪记忆']);
 for(const p of projectExamples)assert.equal(covers[p.id].heading,p.tagline);
});
test('use cases are inline content without nested decorative cards',()=>{
 const css=readFileSync(new URL('../src/scenario-preview.css',import.meta.url),'utf8');
 assert.match(css,/\.scenario-preview\{[^}]*border:0;[^}]*background:none/);
 const component=readFileSync(new URL('../src/ScenarioPreview.tsx',import.meta.url),'utf8');assert.doesNotMatch(component,/<svg|scenario-guide|scenario-steps/);
});

test('each example distinguishes source-backed capabilities from illustrative usage',()=>{
 for(const p of projectExamples){const s=exampleScenarios[p.id];assert.equal(s.capabilities.length,2);assert.ok(s.capabilities.every(t=>t.length>=20));assert.ok(s.useCase.length>=55);}
 assert.match(exampleScenarios.dsbot.capabilities.join(' '),/MCP 和 Skills/);
 assert.match(exampleScenarios.harness.capabilities.join(' '),/会话日志/);assert.match(exampleScenarios.harness.capabilities.join(' '),/Creator/);
 assert.match(exampleScenarios.ombre.capabilities.join(' '),/记忆权重更高/);assert.match(exampleScenarios.ombre.capabilities.join(' '),/Markdown/);
 const component=readFileSync(new URL('../src/ScenarioPreview.tsx',import.meta.url),'utf8');
 assert.match(component,/核心能力/);assert.match(component,/场景示例/);assert.match(component,/s.capabilities/);assert.match(component,/s.useCase/);
});
