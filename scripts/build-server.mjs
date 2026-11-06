import {build} from 'esbuild';
import {readdir,mkdir,rm} from 'node:fs/promises';
await rm('.server-dist',{recursive:true,force:true});
await mkdir('.server-dist',{recursive:true});
const entries=(await readdir('server')).filter(f=>f.endsWith('.ts')).map(f=>'server/'+f);
await build({entryPoints:entries,outdir:'.server-dist',bundle:true,splitting:true,platform:'node',target:'node24',format:'esm',packages:'external',sourcemap:false,logLevel:'info'});
