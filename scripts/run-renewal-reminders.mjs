import {readFile} from 'node:fs/promises';
try{
 const content=await readFile(new URL('../.dev.vars',import.meta.url),'utf8');
 const secret=content.match(/^WDP_ORDER_ALERT_RETRY_SECRET=([A-Za-z0-9_-]{32,256})\s*$/m)?.[1];if(!secret)throw new Error('configuration');
 const response=await fetch('https://web-design-pros-astro.pages.dev/api/internal/renewals',{method:'POST',headers:{Authorization:`Bearer ${secret}`},redirect:'manual',signal:AbortSignal.timeout(150000)});
 if(!response.ok)throw new Error('configuration');const data=await response.json();
 console.log(`Renewal emails: ${Number(data.queued)||0} queued, ${Number(data.sent)||0} accepted, ${Number(data.pending)||0} awaiting retry.`);
}catch{console.error('Renewal reminder job failed. Check deployment, renewal settings and your saved retry secret. No secrets printed.');process.exitCode=1;}
