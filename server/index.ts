import {loadRuntime} from './runtime.js';
import {createApplication} from './app.js';
import {createHttpServer} from './http-server.js';
const runtime=loadRuntime();
const app=await createApplication(runtime);
const server=createHttpServer({origin:runtime.origin,assetsDir:'dist',handler:app.handler});
server.requestTimeout=30000;server.headersTimeout=15000;server.keepAliveTimeout=5000;
server.listen(runtime.port,runtime.host,()=>console.log(`Gither listening on ${runtime.host}:${runtime.port}; owner setup ${app.initialized()?'complete':'required'}.`));
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>server.close(()=>{runtime.db.close();process.exit(0)}));
