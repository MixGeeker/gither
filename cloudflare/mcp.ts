import type {Env} from './contracts';
import {getPublished,searchPublished,publicStatus} from './store';
import {HttpError,json,readJson,strictKeys,verifyOrigin} from './http';
// Deliberately pinned legacy compatibility target; not advertised as latest MCP.
export const MCP_VERSION='2025-11-25';
const annotations={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};
const tools=[
 {name:'search_projects',description:'Search human-reviewed published Gither project snapshots. Does not collect or modify data.',inputSchema:{type:'object',properties:{query:{type:'string',maxLength:120},limit:{type:'integer',minimum:1,maximum:20}},additionalProperties:false},annotations},
 {name:'get_project',description:'Read one published project snapshot by its exact ID. Unreviewed candidates are unavailable.',inputSchema:{type:'object',properties:{id:{type:'string',minLength:1,maxLength:64}},required:['id'],additionalProperties:false},annotations},
 {name:'collection_status',description:'Read sanitized public catalog availability. Does not expose candidates, reviewer identities, user feedback or internal errors.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations},
];
const rpc=(id:string|number|null,result:unknown)=>json({jsonrpc:'2.0',id,result});
const error=(id:string|number|null,code:number,message:string,status=200)=>json({jsonrpc:'2.0',id,error:{code,message}},status);
export async function handleMcp(request:Request,env:Env):Promise<Response>{
 let id:string|number|null=null;
 try{
  verifyOrigin(request,env);
  if(request.method!=='POST')return json({code:'METHOD_NOT_ALLOWED'},405,{Allow:'POST'});
  const accept=request.headers.get('accept')||'';if(!accept.includes('application/json')||!accept.includes('text/event-stream'))return error(null,-32600,'Accept must include application/json and text/event-stream.',406);
  const body=await readJson(request);strictKeys(body,['jsonrpc','id','method','params']);
  if(body.jsonrpc!=='2.0'||typeof body.method!=='string'||('id'in body&&(typeof body.id!=='string'&&!(typeof body.id==='number'&&Number.isSafeInteger(body.id)))))return error(null,-32600,'Invalid JSON-RPC request.',400);
  id=body.id as string|number|undefined??null;
  const version=request.headers.get('mcp-protocol-version');
  if(version!==null&&version!==MCP_VERSION)return error(id,-32600,'Unsupported MCP protocol version; supported: '+MCP_VERSION,400);
  if(body.method!=='initialize'&&version!==MCP_VERSION)return error(id,-32600,'MCP-Protocol-Version is required after initialization.',400);
  const params=body.params===undefined?{}:body.params;if(!params||typeof params!=='object'||Array.isArray(params))return error(id,-32602,'Invalid params.');const p=params as Record<string,unknown>;
  if(!('id'in body)){if(body.method==='notifications/initialized')return new Response(null,{status:202,headers:{'Cache-Control':'no-store'}});return error(null,-32600,'Unsupported notification.',400)}
  if(body.method==='initialize'){
   if(typeof p.protocolVersion!=='string'||!p.capabilities||typeof p.capabilities!=='object'||Array.isArray(p.capabilities)||!p.clientInfo||typeof p.clientInfo!=='object')return error(id,-32602,'Initialization parameters are required.');
   const client=p.clientInfo as Record<string,unknown>;if(Array.isArray(client)||typeof client.name!=='string'||!client.name||client.name.length>128||typeof client.version!=='string'||!client.version||client.version.length>128)return error(id,-32602,'Invalid clientInfo.');
   return rpc(id,{protocolVersion:MCP_VERSION,capabilities:{tools:{}},serverInfo:{name:'gither-readonly-local-prototype',version:'0.1.0'},instructions:'Read-only reviewed project catalog. No collection, publication, user-feedback or account actions are available. Protocol is explicitly pinned to 2025-11-25.'});
  }
  if(body.method==='ping')return rpc(id,{});
  if(body.method==='tools/list'){if(p.cursor!==undefined)return error(id,-32602,'This bounded tool list has no pagination cursor.');return rpc(id,{tools})}
  if(body.method!=='tools/call')return error(id,-32601,'Method not found.');
  if(typeof p.name!=='string'||!tools.some(t=>t.name===p.name))return error(id,-32602,'Unknown tool.');
  const args=p.arguments===undefined?{}:p.arguments;if(!args||typeof args!=='object'||Array.isArray(args))return error(id,-32602,'Tool arguments must be an object.');const a=args as Record<string,unknown>;let result:unknown;
  if(p.name==='search_projects'){
   strictKeys(a,['query','limit']);if((a.query!==undefined&&(typeof a.query!=='string'||a.query.length>120))||(a.limit!==undefined&&(!Number.isInteger(a.limit)||Number(a.limit)<1||Number(a.limit)>20)))return error(id,-32602,'Invalid search arguments.');result={projects:await searchPublished(env.DB,typeof a.query==='string'?a.query:'',typeof a.limit==='number'?a.limit:10)};
  }else if(p.name==='get_project'){
   strictKeys(a,['id']);if(typeof a.id!=='string'||!/^[a-z0-9-]{1,64}$/.test(a.id))return error(id,-32602,'Invalid project ID.');const project=await getPublished(env.DB,a.id);if(!project)return rpc(id,{content:[{type:'text',text:'No published project found.'}],isError:true});result={project};
  }else{strictKeys(a,[]);result={...await publicStatus(env.DB),collectionEnabled:env.COLLECTION_ENABLED==='true',feedbackEnabled:false,authenticationEnabled:false}}
  return rpc(id,{content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result,isError:false});
 }catch(e){if(e instanceof HttpError)return error(id,e.code==='INVALID_JSON'?-32700:e.code==='INVALID_JSON_OBJECT'?-32600:e.status===400?-32602:-32600,e.code,e.status);return error(id,-32603,'Catalog temporarily unavailable.',503)}
}
