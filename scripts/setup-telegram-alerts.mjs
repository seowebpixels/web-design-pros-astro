import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {createInterface} from 'node:readline/promises';
import {waitForPrivateChat} from './lib/telegram-connection.mjs';

const path=fileURLToPath(new URL('../.dev.vars',import.meta.url));
async function hiddenPrompt(){
  if(!process.stdin.isTTY)throw new Error('Run in your own interactive terminal.');
  process.stdout.write('Telegram bot token (hidden): ');process.stdin.setRawMode(true);process.stdin.resume();process.stdin.setEncoding('utf8');
  return new Promise((resolve,reject)=>{
    let value='';const finish=()=>{process.stdin.off('data',onData);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');};
    const onData=chunk=>{for(const char of chunk){if(char==='\u0003'){finish();reject(new Error('Cancelled.'));return;}if(char==='\r'||char==='\n'){finish();resolve(value.trim());return;}if(char==='\u007f'||char==='\b')value=value.slice(0,-1);else if(char>=' ')value+=char;}};
    process.stdin.on('data',onData);
  });
}
try{
  const token=await hiddenPrompt();if(!/^\d+:[A-Za-z0-9_-]+$/.test(token))throw new Error('That does not look like a bot token.');
  async function api(method,body={}){
    const response=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error(response.status===409?'Telegram connection failed: this bot has another active connection. Use a new dedicated bot, or stop its other integration first.':`Telegram connection failed (HTTP ${response.status}).`);
    const result=await response.json();if(result.ok!==true)throw new Error('Telegram did not accept the request.');return result;
  }
  const me=await api('getMe');
  if(!/^[A-Za-z0-9_]+$/.test(me.result?.username??''))throw new Error('Telegram did not return a bot username.');
  console.log(`Token verified for @${me.result.username}. Open https://t.me/${me.result.username} and press Start.`);
  const webhook=await api('getWebhookInfo');
  if(webhook.result?.url)throw new Error('Telegram connection failed: this bot already has a webhook. Use a new dedicated bot; its other integration has not been changed.');
  let content='';try{content=await readFile(path,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
  const code='wdp-connect-'+randomBytes(4).toString('hex');
  console.log(`In your own private chat with your new bot, send exactly: ${code}`);
  const prompt=createInterface({input:process.stdin,output:process.stdout});await prompt.question('After sending it in Telegram, press Enter here. ');prompt.close();
  console.log('Waiting up to 30 seconds for your private-chat message...');
  const chatId=await waitForPrivateChat(api,code);
  const values={WDP_TELEGRAM_BOT_TOKEN:token,WDP_TELEGRAM_CHAT_ID:chatId};
  if(!/^WDP_ORDER_ALERT_RETRY_SECRET=/m.test(content))values.WDP_ORDER_ALERT_RETRY_SECRET=randomBytes(32).toString('hex');
  for(const [name,value] of Object.entries(values)){
    const pattern=new RegExp(`^${name}=.*$`,'m');content=pattern.test(content)?content.replace(pattern,`${name}=${value}`):content.trimEnd()+`\n${name}=${value}\n`;
  }
  await writeFile(path,content,{mode:0o600});
  const sent=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chatId,text:'WDP Telegram connection confirmed. This is a setup message, not a paid order.',protect_content:true}),signal:AbortSignal.timeout(10000)});
  if(!sent.ok||(await sent.json()).ok!==true)throw new Error('Settings saved, but the setup message failed. Check the bot is not blocked.');
  console.log('Telegram setup message sent. Settings saved in ignored .dev.vars; no secrets printed. Copy the three WDP Telegram/retry values to Cloudflare as secrets, then follow docs/order-alerts.md.');
}catch(error){
  // Fetch errors may contain a credential-bearing URL: never print them.
  const message=error instanceof Error?error.message:'';
  console.error(/^(Run |Cancelled|That does|Telegram connection failed|Telegram did|Could not identify|Settings saved)/.test(message)?message:'Telegram setup failed. Check your connection and try again. No credentials were printed.');process.exitCode=1;
}
