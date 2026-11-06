import type {Project, ProjectMetadata} from './data';

export interface SessionUser {id:string;email:string;name:string;role:'owner'|'member'}
export interface UserState {saved:string[];dismissed:string[];canUndo?:boolean;history?:unknown[]}
export class ApiError extends Error {
  status:number;code:string;
  constructor(message:string,status=0,code='NETWORK_ERROR'){super(message);this.name='ApiError';this.status=status;this.code=code}
}
const errorMessages:Record<string,string>={
  INVALID_EMAIL_OR_PASSWORD:'邮箱或密码不正确。',UNAUTHORIZED:'登录已过期，请重新登录。',FORBIDDEN:'当前账号没有执行此操作的权限。',
  VERSION_CONFLICT:'设置已在其他页面更新。请重新载入后再编辑。',CONFLICT:'数据已经改变，请刷新后重试。',
  REAUTHENTICATION_REQUIRED:'当前密码验证失败，请检查密码后再试。',SESSION_REQUIRED:'登录已过期，请重新登录。',OWNER_REQUIRED:'只有实例管理员可以执行此操作。',
  INVALID_PASSWORD:'当前密码不正确。',RATE_LIMITED:'请求过于频繁，请稍后重试。',TOO_MANY_REQUESTS:'请求过于频繁，请稍后重试。',
};
export async function api<T>(path:string,options:{method?:'GET'|'POST'|'PUT'|'DELETE';body?:unknown;signal?:AbortSignal;sessionCheck?:boolean}={}):Promise<T>{
  let response:Response;
  try{response=await fetch(path,{method:options.method||'GET',credentials:'same-origin',cache:'no-store',signal:options.signal,headers:{Accept:'application/json',...(options.body===undefined?{}:{'Content-Type':'application/json'})},...(options.body===undefined?{}:{body:JSON.stringify(options.body)})})}
  catch(error){if(error instanceof DOMException&&error.name==='AbortError')throw error;throw new ApiError('无法连接服务器，请检查网络后重试。')}
  const isJson=response.headers.get('content-type')?.includes('application/json');
  let data:unknown=null;
  if(isJson){try{data=await response.json()}catch{throw new ApiError('服务器返回的数据无法读取。',response.status,'INVALID_RESPONSE')}}
  if(!response.ok){
    if(response.status===401&&!options.sessionCheck)window.dispatchEvent(new Event('gither:session-expired'));
    const value=data&&typeof data==='object'?data as {code?:string;error?:string|{code?:string;message?:string};message?:string}:{};
    const code=value.code||(typeof value.error==='object'?value.error?.code:typeof value.error==='string'?value.error:undefined)||'REQUEST_FAILED';
    const message=response.status===409?'数据已更新或操作已完成，请刷新后重试。':errorMessages[code]||(response.status===401?'请重新登录或检查当前密码。':response.status===429?'请求过于频繁，请稍后重试。':value.message||(typeof value.error==='object'?value.error?.message:undefined)||`请求失败（${response.status}），请重试。`);
    throw new ApiError(message,response.status,code);
  }
  if(!isJson)throw new ApiError('未连接到 Gither API。请检查服务器配置。',response.status,'NOT_JSON');
  return data as T;
}
export const errorText=(error:unknown)=>error instanceof Error?error.message:'操作未完成，请重试。';
export const safeLink=(value:unknown):string|undefined=>{
  if(typeof value!=='string'||value.length>2048)return undefined;
  try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.href:undefined}catch{return undefined}
};
const strings=(value:unknown,max=50):string[]=>Array.isArray(value)?value.filter((x):x is string=>typeof x==='string'&&x.length<=2000).slice(0,max):[];
// User-owned server catalog: no bundled fallback, hard-coded ID allowlist or invented metrics.
export function decodeProjects(value:unknown):Project[]{
  if(!value||typeof value!=='object'||!Array.isArray((value as {projects?:unknown}).projects))throw new Error('项目目录格式无效。');
  const seen=new Set<string>();
  return (value as {projects:unknown[]}).projects.map(raw=>{
    if(!raw||typeof raw!=='object')throw new Error('项目目录包含无效数据。');
    const p=raw as Record<string,unknown>;
    if(typeof p.id!=='string'||!p.id||seen.has(p.id)||typeof p.name!=='string'||!safeLink(p.url))throw new Error('项目身份或链接无效。');
    seen.add(p.id);
    const text=(key:string,fallback='')=>typeof p[key]==='string'?(p[key] as string).slice(0,10000):fallback;
    let metadata:ProjectMetadata|undefined;
    if(p.metadata&&typeof p.metadata==='object'){
      const m=p.metadata as Record<string,unknown>;
      metadata={repositoryUrl:safeLink(m.repositoryUrl)||String(p.url),ownerLogin:typeof m.ownerLogin==='string'?m.ownerLogin:text('owner'),
        avatar:typeof m.avatar==='string'&&/^\/avatars\/[a-zA-Z0-9_.-]+$/.test(m.avatar)?m.avatar:safeLink(m.avatar),
        stars:Number.isSafeInteger(m.stars)&&Number(m.stars)>=0?Number(m.stars):undefined,
        forks:Number.isSafeInteger(m.forks)&&Number(m.forks)>=0?Number(m.forks):undefined,
        fetchedAt:typeof m.fetchedAt==='string'&&Number.isFinite(Date.parse(m.fetchedAt))?m.fetchedAt:undefined,
        metadataApiSource:safeLink(m.metadataApiSource)};
    }
    const card=p.card&&typeof p.card==='object'?p.card as Record<string,unknown>:undefined;
    return {id:p.id,name:p.name,owner:text('owner'),url:safeLink(p.url)!,category:text('category','项目'),tagline:text('tagline',p.name),description:text('description'),tags:strings(p.tags),use:text('use'),points:strings(p.points),art:text('art'),symbol:text('symbol','↗'),bg:text('bg','#ddf4ff'),ink:text('ink','#0969da'),metadata,...(card?{card:{capabilities:strings(card.capabilities),useCase:typeof card.useCase==='string'?card.useCase:''}}:{})};
  });
}
export function decodeUserState(value:unknown):UserState{
  if(!value||typeof value!=='object')throw new Error('个人状态格式无效。');
  const state=value as Record<string,unknown>;
  if(!Array.isArray(state.saved)||!Array.isArray(state.dismissed)||[...state.saved,...state.dismissed].some(x=>typeof x!=='string'))throw new Error('个人状态格式无效。');
  return {saved:[...new Set(state.saved)] as string[],dismissed:[...new Set(state.dismissed)] as string[],canUndo:typeof state.canUndo==='boolean'?state.canUndo:undefined,history:Array.isArray(state.history)?state.history:undefined};
}
