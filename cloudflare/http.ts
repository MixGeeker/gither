import type {Env,Principal} from './contracts';
export class HttpError extends Error {constructor(public status:number,public code:string){super(code)}}
export function json(value:unknown,status=200,extra:Record<string,string>={}){return Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra}})}
export function configuredOrigin(env:Env):string|null{
 try{const u=new URL(env.APP_ORIGIN||'');if(u.origin!==(env.APP_ORIGIN||'')||u.username||u.password)return null;if(u.protocol==='https:'||(u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))return u.origin;return null}catch{return null}
}
export function verifyOrigin(request:Request,env:Env,required=false){const origin=configuredOrigin(env);if(!origin)throw new HttpError(503,'ORIGIN_UNCONFIGURED');const supplied=request.headers.get('origin');if(new URL(request.url).origin!==origin||(supplied!==null&&supplied!==origin)||(required&&supplied===null))throw new HttpError(403,'INVALID_ORIGIN')}
export async function readJson(request:Request,maxBytes=16384):Promise<Record<string,unknown>>{
 if(request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')throw new HttpError(415,'JSON_REQUIRED');
 const declared=Number(request.headers.get('content-length'));if(Number.isFinite(declared)&&declared>maxBytes)throw new HttpError(413,'BODY_TOO_LARGE');
 if(!request.body)throw new HttpError(400,'INVALID_JSON');const reader=request.body.getReader();let size=0;const chunks:Uint8Array[]=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw new HttpError(413,'BODY_TOO_LARGE')}chunks.push(value)}}finally{reader.releaseLock()}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length}
 let value:unknown;try{value=JSON.parse(new TextDecoder().decode(bytes))}catch{throw new HttpError(400,'INVALID_JSON')}
 if(!value||typeof value!=='object'||Array.isArray(value))throw new HttpError(400,'INVALID_JSON_OBJECT');return value as Record<string,unknown>;
}
export function strictKeys(body:Record<string,unknown>,keys:string[]){if(Object.keys(body).some(k=>!keys.includes(k)))throw new HttpError(400,'UNSUPPORTED_FIELD')}
export async function authorize(request:Request,env:Env,role:Principal['role']):Promise<Principal>{
 if(!env.ADMIN_AUTH)throw new HttpError(503,'ADMIN_AUTH_UNCONFIGURED');
 // This binding is a trusted authorization service, not a client-supplied role.
 // No service or credentials are created/configured by this prototype.
 const headers=new Headers({'content-type':'application/json'});for(const h of ['authorization','cookie']){const v=request.headers.get(h);if(v)headers.set(h,v)}
 const result=await env.ADMIN_AUTH.fetch(new Request('https://authorization.internal/verify',{method:'POST',headers,body:JSON.stringify({role,path:new URL(request.url).pathname,method:request.method})}));
 if(!result.ok)throw new HttpError(403,'FORBIDDEN');
 const value=await result.json() as {authenticated?:boolean;principal?:{id?:unknown;role?:unknown}};
 const p=value.principal;if(value.authenticated!==true||!p||typeof p.id!=='string'||!p.id||p.id.length>128||p.role!==role)throw new HttpError(403,'FORBIDDEN');return{id:p.id,role};
}
