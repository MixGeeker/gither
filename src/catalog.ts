import type {Project} from './data';
import type metadata from './github-metadata.json';
export type CatalogMetadata=(typeof metadata)[keyof typeof metadata];
export interface CatalogResult {projects:Project[];metadata:Record<string,CatalogMetadata>}
// Runtime validation keeps the API contract explicit and rejects incomplete/unsafe entries.
export function decodeCatalog(value:unknown):CatalogResult{
 if(!value||typeof value!=='object'||!Array.isArray((value as {projects?:unknown}).projects))throw new Error('目录格式无效');
 const rows=(value as {projects:unknown[]}).projects;if(rows.length>50)throw new Error('目录超出限制');
 const projects:Project[]=[],metadata:Record<string,CatalogMetadata>={};const seen=new Set<string>();
 for(const row of rows){
  if(!row||typeof row!=='object')throw new Error('项目格式无效');const r=row as {project?:Project;metadata?:CatalogMetadata},p=r.project,m=r.metadata;
  if(!p||!m||!['dsbot','harness','ombre'].includes(p.id)||seen.has(p.id))throw new Error('项目 ID 无效');
  for(const key of ['id','name','owner','category','tagline','description','url','use','art','symbol','bg','ink'] as const)if(typeof p[key]!=='string'||p[key].length>2000)throw new Error('项目内容无效');
  if(!Array.isArray(p.tags)||p.tags.length>8||p.tags.some(x=>typeof x!=='string'||x.length>80)||!Array.isArray(p.points)||p.points.length>8||p.points.some(x=>typeof x!=='string'||x.length>1000))throw new Error('项目标签无效');
  if(!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(p.url)||m.repositoryUrl!==p.url||!/^\/avatars\/[a-z0-9_-]+\.png$/.test(m.avatar)||!Number.isSafeInteger(m.stars)||m.stars<0||!Number.isSafeInteger(m.forks)||m.forks<0||!Number.isFinite(Date.parse(m.fetchedAt)))throw new Error('来源或统计无效');
  for(const key of ['ownerLogin','ownerType','ownerUrl','avatarUrl','metadataApiSource'] as const)if(typeof m[key]!=='string'||m[key].length>1024)throw new Error('仓库身份无效');
  const expected={dsbot:'QingJ01/DS-Bot-App',harness:'deepseek-ai/deepseek-harness',ombre:'P0luz/Ombre-Brain'}[p.id];
  if(p.url!=='https://github.com/'+expected||m.metadataApiSource!=='https://api.github.com/repos/'+expected||m.ownerUrl!=='https://github.com/'+m.ownerLogin||!/^https:\/\/avatars\.githubusercontent\.com\/u\/\d+(?:\?[^#]*)?$/.test(m.avatarUrl)||!Number.isSafeInteger(m.ownerId)||m.ownerId<1)throw new Error('仓库来源无效');
  seen.add(p.id);projects.push(p);metadata[p.id]=m;
 }
 return{projects,metadata};
}
