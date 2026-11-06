import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,existsSync,readFileSync,chmodSync,statSync} from 'node:fs';
import {resolve} from 'node:path';
export function runtimeConfig(env:NodeJS.ProcessEnv=process.env){
 const origin=env.APP_ORIGIN||'http://127.0.0.1:3000';const url=new URL(origin);
 if(url.origin!==origin||url.username||url.password||(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname))))throw new Error('APP_ORIGIN must be an exact HTTPS origin, or HTTP loopback for local use.');
 const dataDir=resolve(env.GITHER_DATA_DIR||'data');const port=Number(env.PORT||3000);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid PORT');
 return{origin,port,dataDir,dbPath:resolve(dataDir,'gither.db'),secretPath:resolve(dataDir,'auth-secret'),host:env.HOST||'127.0.0.1',allowLocalhost:url.protocol==='http:'};
}
export function openDatabase(path:string){
 const db=new DatabaseSync(path);db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;');return db;
}
export function loadRuntime(env:NodeJS.ProcessEnv=process.env){
 const config=runtimeConfig(env);mkdirSync(config.dataDir,{recursive:true,mode:0o700});chmodSync(config.dataDir,0o700);
 let secret:string|undefined;if(existsSync(config.secretPath)){if((statSync(config.secretPath).mode&0o077)!==0)throw new Error('auth-secret must not be group/world-readable');secret=readFileSync(config.secretPath,'utf8').trim();}
 const db=openDatabase(config.dbPath);chmodSync(config.dbPath,0o600);return{...config,db,...(secret===undefined?{}:{secret})};
}
