import {spawnSync} from 'node:child_process';import{resolve}from'node:path';
const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','deploy','--config','wrangler.auth.jsonc','--dry-run','--outdir','.auth-dist/bundle'],{stdio:'inherit',env:{...process.env,WRANGLER_SEND_METRICS:'false',XDG_CONFIG_HOME:resolve('.wrangler/config')}});process.exit(result.status??1);
