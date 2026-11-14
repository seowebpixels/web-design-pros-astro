import {readFile} from 'node:fs/promises';
import {checkTelegramConnection} from '../src/lib/orders/telegram-check.mjs';

const labels={ok:'OK',timeout:'Timed out after 20 seconds',interrupted:'Request interrupted',connection_failed:'Connection failed',unreadable_response:'Response could not be read',not_confirmed:'Telegram did not confirm the check',unexpected_bot:'Unexpected bot response',unexpected_chat:'Configured chat is not the expected private chat',missing_or_invalid:'Local bot settings are missing or invalid'};
function show(source,checks){
  for(const item of Array.isArray(checks)?checks:[]){
    if(!['configuration','bot','private_chat'].includes(item.check))continue;
    const label=labels[item.status]??(/^http_\d{3}$/.test(item.status)?'HTTP '+item.status.slice(5):'Check failed');
    const elapsed=Number.isFinite(item.elapsedMs)?` (${Math.round(item.elapsedMs/1000)}s)`:'';
    console.log(`${source} | ${item.check} | ${label}${elapsed}`);
  }
}
try{
  const content=await readFile(new URL('../.dev.vars',import.meta.url),'utf8');
  const value=name=>content.match(new RegExp(`^${name}=([^\\r\\n]+)\\s*$`,'m'))?.[1]?.trim();
  const secret=value('WDP_ORDER_ALERT_RETRY_SECRET');
  console.log('Checking connections only. No messages are sent and no alerts are retried.');
  await Promise.all([
    checkTelegramConnection(value('WDP_TELEGRAM_BOT_TOKEN'),value('WDP_TELEGRAM_CHAT_ID')).then(checks=>show('Your computer',checks)),
    (async()=>{
      if(!/^[A-Za-z0-9_-]{32,256}$/.test(secret??'')){console.log('Cloudflare | Retry secret is missing locally.');return;}
      try{
        const response=await fetch('https://web-design-pros-astro.pages.dev/api/internal/telegram-check',{method:'POST',headers:{Authorization:`Bearer ${secret}`},signal:AbortSignal.timeout(30000),redirect:'error'});
        if(!response.ok){console.log(`Cloudflare | Connection check unavailable (HTTP ${response.status}); confirm the new code is deployed.`);return;}
        const result=await response.json();
        if(!Array.isArray(result.checks)){console.log('Cloudflare | Connection check is not deployed yet.');return;}
        show('Cloudflare',result.checks);
      }catch{console.log('Cloudflare | Could not complete the private connection check.');}
    })()
  ]);
  console.log('No credentials or private chat details are printed. Local and Cloudflare settings are checked separately.');
}catch{console.error('Could not load local Telegram settings from .dev.vars. No secrets printed.');process.exitCode=1;}
