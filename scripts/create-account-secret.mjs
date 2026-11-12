import {randomBytes} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const path=fileURLToPath(new URL('../.dev.vars',import.meta.url));
let content='';
try{content=await readFile(path,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
if(/^\s*AUTH_SECRET=/m.test(content)){console.log('AUTH_SECRET already exists in .dev.vars; it was not replaced.');}
else{await writeFile(path,content.replace(/\s*$/,'')+'\nAUTH_SECRET='+randomBytes(48).toString('base64url')+'\n',{mode:0o600});console.log('AUTH_SECRET generated and saved to ignored .dev.vars. Its value was not printed.');}
