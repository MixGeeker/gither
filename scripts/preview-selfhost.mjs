// LOCAL QA ONLY: isolated memory database, synthetic identity, no persistent credentials.
// Not copied into the Docker runtime image. Never use this as a deployment server.
import {DatabaseSync} from 'node:sqlite';
import {createApplication} from '../.server-dist/app.js';
import {createHttpServer} from '../.server-dist/http-server.js';
if(process.env.NODE_ENV==='production')throw new Error('QA fixture cannot run in production mode');
const db=new DatabaseSync(':memory:');
const origin='http://127.0.0.1:4173';
const app=await createApplication({db,origin,allowLocalhost:true,secret:'temporary-preview-fixture-ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789'});
await app.auth.createOwner({email:'qa@gither.example',name:'临时测试账号',password:'Temporary-Preview-Password-42!'});
const server=createHttpServer({origin,assetsDir:'dist',handler:app.handler});
server.listen(4173,'0.0.0.0',()=>console.log('Temporary isolated Gither QA preview on port 4173. All data disappears when stopped.'));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{db.close();process.exit(0)}));
