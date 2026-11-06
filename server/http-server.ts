import {createServer,type IncomingMessage} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
const MAX_BODY=1024*1024;
const contentTypes:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon','.woff2':'font/woff2'};
export function createHttpServer(options:{origin:string;assetsDir:string;handler:(request:Request)=>Promise<Response>}){
 const expected=new URL(options.origin);const root=resolve(options.assetsDir);
 return createServer(async(req,res)=>{
  try{
   if(req.headers.host!==expected.host){res.writeHead(421,{'content-type':'application/json'}).end('{"code":"INVALID_HOST"}');return}
   const method=req.method||'GET';const path=req.url||'/';if(!path.startsWith('/')||path.startsWith('//')){res.writeHead(400).end();return}
   const url=new URL(path,options.origin);if(url.origin!==options.origin){res.writeHead(400).end();return}
   const declared=Number(req.headers['content-length']||0);if(!Number.isFinite(declared)||declared<0||declared>MAX_BODY){res.writeHead(413).end();return}
   const chunks:Buffer[]=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>MAX_BODY){res.writeHead(413).end();req.destroy();return}chunks.push(Buffer.from(chunk));}
   const headers=new Headers();for(const[k,v]of Object.entries(req.headers)){if(v!==undefined)headers.set(k,Array.isArray(v)?v.join(','):v)}
   // No forwarded client-IP headers are trusted. Proxy deployments share the proxy-IP bucket.
   headers.delete('forwarded');headers.delete('x-forwarded-for');headers.delete('cf-connecting-ip');headers.set('x-gither-client-ip',req.socket.remoteAddress||'unknown');
   const bytes=Buffer.concat(chunks);const request=new Request(url,{method,headers,...(method==='GET'||method==='HEAD'?{}:{body:bytes})});
   let response:Response;
   if(url.pathname.startsWith('/api/')||url.pathname==='/mcp'||url.pathname==='/healthz')response=await options.handler(request);
   else{
    if(method!=='GET'&&method!=='HEAD'){res.writeHead(405).end();return}
    let pathname:string;try{pathname=decodeURIComponent(url.pathname)}catch{res.writeHead(400).end();return}
    if(pathname.includes('\\')||pathname.split('/').some(p=>p.startsWith('.'))){res.writeHead(404).end();return}
    const candidate=resolve(root,'.'+pathname);if(candidate!==root&&!candidate.startsWith(root+sep)){res.writeHead(404).end();return}
    let file=candidate;try{if(!(await stat(file)).isFile())file=resolve(root,'index.html')}catch{file=extname(pathname)?'':resolve(root,'index.html')}
    if(!file){res.writeHead(404).end();return}
    try{const data=await readFile(file);response=new Response(method==='HEAD'?null:data,{headers:{'content-type':contentTypes[extname(file)]||'application/octet-stream','cache-control':extname(file)==='.html'||file.endsWith('/sw.js')?'no-cache':'private, max-age=3600'}})}catch{response=Response.json({code:'ASSETS_UNAVAILABLE'},{status:503})}
   }
   response.headers.set('X-Content-Type-Options','nosniff');response.headers.set('Referrer-Policy','no-referrer');response.headers.set('X-Frame-Options','DENY');response.headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
   response.headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://avatars.githubusercontent.com; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
   if(expected.protocol==='https:')response.headers.set('Strict-Transport-Security','max-age=31536000');
   res.statusCode=response.status;for(const[k,v]of response.headers){if(k!=='set-cookie')res.setHeader(k,v)}const cookies=response.headers.getSetCookie();if(cookies.length)res.setHeader('set-cookie',cookies);res.end(Buffer.from(await response.arrayBuffer()));
  }catch{if(!res.headersSent)res.writeHead(500,{'content-type':'application/json','cache-control':'no-store'});res.end('{"code":"INTERNAL_ERROR"}')}
 });
}
