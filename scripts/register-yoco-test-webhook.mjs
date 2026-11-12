import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../',import.meta.url));
const path = resolve(root,'.dev.vars');
const target = 'https://web-design-pros-astro.pages.dev/api/payments/webhook';
async function secretPrompt() {
  if (!process.stdin.isTTY) throw new Error('Run this helper in an interactive terminal.');
  process.stdout.write('Yoco TEST secret key (hidden; never paste a live key): ');
  process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8');
  return new Promise((resolve,reject)=>{
    let value='';
    const finish=()=>{process.stdin.off('data',onData);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');};
    const onData=chunk=>{
      for (const char of chunk) {
        if (char==='\u0003') {finish();reject(new Error('Cancelled.'));return;}
        if (char==='\r' || char==='\n') {finish();resolve(value.trim());return;}
        if (char==='\u007f' || char==='\b') value=value.slice(0,-1);
        else if (char>=' ') value+=char;
      }
    };
    process.stdin.on('data',onData);
  });
}
try {
  const key = await secretPrompt();
  if (!key.startsWith('sk_test_')) throw new Error('Only a sk_test_ key is accepted.');
  const headers = {Authorization:`Bearer ${key}`,'Content-Type':'application/json'};
  const list = await fetch('https://payments.yoco.com/api/webhooks',{headers,signal:AbortSignal.timeout(15000)});
  if (!list.ok) throw new Error(`Unable to inspect existing webhooks (HTTP ${list.status}).`);
  const existing = await list.json();
  const items=Array.isArray(existing)?existing:existing.subscriptions || existing.webhooks || existing.data;
  if (!Array.isArray(items)) throw new Error('Unexpected webhook-list response. Check existing hooks in Yoco before creating one.');
  if (items.some(item=>item.url===target)) throw new Error('This webhook already exists. Reuse its existing signing secret; no duplicate was created.');
  let content='';
  try {content=await readFile(path,'utf8');} catch(error) {if(error.code!=='ENOENT') throw error;}
  // Check local file access before creating a remote webhook whose secret is returned once.
  await writeFile(path,content,{mode:0o600});
  const response=await fetch('https://payments.yoco.com/api/webhooks',{method:'POST',headers,signal:AbortSignal.timeout(15000),body:JSON.stringify({name:'WDP test payments',url:target,events:['payment.succeeded']})});
  if (!response.ok) throw new Error(`Webhook registration failed (HTTP ${response.status}).`);
  const hook=await response.json();
  if (hook.mode!=='test' || !hook.secret?.startsWith('whsec_')) throw new Error('Unexpected test webhook response. Inspect your Yoco account before retrying.');
  const values={YOCO_TEST_SECRET_KEY:key,YOCO_TEST_WEBHOOK_SECRET:hook.secret,WDP_PAYMENT_TEST_ENABLED:'true'};
  for (const [name,value] of Object.entries(values)) {
    const pattern=new RegExp(`^\\s*${name}=.*$`,'m');
    content=pattern.test(content)?content.replace(pattern,`${name}=${value}`):content.replace(/\s*$/,'')+`\n${name}=${value}\n`;
  }
  await writeFile(path,content,{mode:0o600});
  console.log('Test webhook registered. Secrets saved to ignored .dev.vars; none printed. Add these secrets to Cloudflare and redeploy.');
} catch(error) {console.error(error instanceof Error?error.message:'Setup failed.');process.exitCode=1;}
