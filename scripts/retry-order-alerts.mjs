import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
try{
  const content=await readFile(fileURLToPath(new URL('../.dev.vars',import.meta.url)),'utf8');
  const secret=content.match(/^WDP_ORDER_ALERT_RETRY_SECRET=([A-Za-z0-9_-]{32,256})\s*$/m)?.[1];
  if(!secret)throw new Error('missing');
  const response=await fetch('https://web-design-pros-astro.pages.dev/api/internal/order-alerts',{method:'POST',headers:{Authorization:`Bearer ${secret}`},signal:AbortSignal.timeout(30000)});
  if(!response.ok){console.error(`Order alert retry failed (HTTP ${response.status}). Check configuration and deployment.`);process.exitCode=1;}
  else{const result=await response.json();console.log(result.allDueDelivered?'All deliveries due in this batch were accepted. Check the delivery table for remaining or held alerts.':'Some deliveries need another retry. Check the delivery table.');}
}catch{console.error('Could not retry order alerts. Check the saved retry secret in .dev.vars and your connection. No secrets printed.');process.exitCode=1;}
