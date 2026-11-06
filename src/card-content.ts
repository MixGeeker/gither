import type {Project,ProjectMetadata} from './data';
export interface ScenarioContent {capabilities:string[];useCase:string}
// Runtime cards use every reviewed capability and the complete concrete scenario.
// Even a legacy card without card fields stays text-only, using its reviewed points/use.
export function runtimeScenario(project:Project):ScenarioContent{
  return {capabilities:project.card?.capabilities.length?project.card.capabilities:project.points,useCase:project.card?.useCase||project.use};
}
function repositoryIdentity(value:string):string|undefined{
  try{const url=new URL(value);if(url.protocol!=='https:'||url.hostname!=='github.com'||url.username||url.password)return undefined;const path=url.pathname.replace(/\/+$/,'').replace(/\.git$/i,'');return /^\/[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(path)?path.toLowerCase():undefined}catch{return undefined}
}
function safeAvatar(value:string|undefined):string|undefined{
  if(!value)return undefined;
  if(/^\/avatars\/[a-zA-Z0-9_.-]+$/.test(value))return value;
  try{const url=new URL(value);return url.protocol==='https:'&&url.hostname==='avatars.githubusercontent.com'&&!url.username&&!url.password?url.href:undefined}catch{return undefined}
}
// Map by the verified repository URL, never by a generated database ID or a guessed avatar.
// Only the avatar is reused; static star/fork snapshots must not become live metadata.
export function ownerAvatar(project:Project,known:Record<string,ProjectMetadata>):string|undefined{
  const identity=repositoryIdentity(project.url);if(!identity)return undefined;
  if(project.metadata&&repositoryIdentity(project.metadata.repositoryUrl)===identity){const provided=safeAvatar(project.metadata.avatar);if(provided)return provided}
  const source=Object.values(known).find(metadata=>repositoryIdentity(metadata.repositoryUrl)===identity);
  return safeAvatar(source?.avatar);
}
