import {randomBytes} from 'node:crypto';
import {mkdirSync,existsSync,writeFileSync,copyFileSync,chmodSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createInterface} from 'node:readline/promises';
import {emitKeypressEvents} from 'node:readline';
import {backup} from 'node:sqlite';
import {runtimeConfig,loadRuntime} from './runtime.js';
import {createAuthService} from './auth.js';
async function question(label:string){const rl=createInterface({input:process.stdin,output:process.stdout});try{return(await rl.question(label)).trim()}finally{rl.close()}}
async function password(label:string):Promise<string>{
 if(!process.stdin.isTTY)throw new Error('Use an interactive terminal. Passwords are not accepted in arguments or environment variables.');
 process.stdout.write(label);emitKeypressEvents(process.stdin);process.stdin.setRawMode(true);process.stdin.resume();
 return new Promise((resolve,reject)=>{let value='';const cleanup=()=>{process.stdin.off('keypress',onKey);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n')};const onKey=(str:string,key:{name?:string;ctrl?:boolean})=>{if(key.ctrl&&key.name==='c'){cleanup();reject(new Error('Cancelled'))}else if(key.name==='return'||key.name==='enter'){cleanup();resolve(value)}else if(key.name==='backspace'){value=value.slice(0,-1)}else if(str&&!key.ctrl&&![...str].some(c=>c.charCodeAt(0)<32)&&value.length+str.length<=128){value+=str}};process.stdin.on('keypress',onKey)});
}
const command=process.argv[2]||'setup';
try{
 if(!['setup','reset-owner','backup'].includes(command))throw new Error('Commands: setup, reset-owner, backup [local-directory]');
 const config=runtimeConfig();
 if(command==='setup'){
  if(!process.stdin.isTTY)throw new Error('Run setup with an interactive terminal (-it).');
  mkdirSync(config.dataDir,{recursive:true,mode:0o700});
  if(!existsSync(config.secretPath))writeFileSync(config.secretPath,randomBytes(48).toString('base64url')+'\n',{flag:'wx',mode:0o600});
 }
 const runtime=loadRuntime();if(!runtime.secret)throw new Error('Run setup first.');
 const auth=await createAuthService({...runtime,secret:runtime.secret});
 if(command==='backup'){
  const destination=resolve(process.argv[3]||resolve(config.dataDir,'backups',new Date().toISOString().replace(/[:.]/g,'-')));
  mkdirSync(dirname(destination),{recursive:true,mode:0o700});mkdirSync(destination,{recursive:false,mode:0o700});await backup(runtime.db,resolve(destination,'gither.db'));copyFileSync(config.secretPath,resolve(destination,'auth-secret'));chmodSync(resolve(destination,'gither.db'),0o600);chmodSync(resolve(destination,'auth-secret'),0o600);
  console.log('Local backup created. It contains account data and the authentication secret; keep it private. After restoring, reset-owner before exposing the app.');
 }else{
  if(command==='setup'&&auth.hasOwner()){if(process.argv.includes('--if-needed')){console.log('Owner already initialized; leaving credentials unchanged.');runtime.db.close();process.exit(0)}throw new Error('Owner already initialized. Use reset-owner for local recovery.');}
  const email=await question('Owner email (login identifier; not verified by email): ');
  const name=command==='setup'?await question('Display name: '):'';
  const pass=await password('Password (12–128 characters; hidden): ');const confirm=await password('Repeat password: ');if(pass!==confirm)throw new Error('Passwords do not match.');
  if(command==='setup'){await auth.createOwner({email,password:pass,name});console.log('Owner created. Start or restart the app, then sign in. No API/MCP keys were created.');}
  else{await auth.resetOwnerPassword({email,password:pass});console.log('Owner password reset. All old sessions and API/MCP keys were revoked.');}
 }
 runtime.db.close();
}catch(error){console.error(error instanceof Error?error.message:'Setup failed');process.exitCode=1;}
