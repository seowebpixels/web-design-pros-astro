import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
try{
  const content=await readFile(fileURLToPath(new URL('../.dev.vars',import.meta.url)),'utf8');
  const secret=content.match(/^WDP_ORDER_ALERT_RETRY_SECRET=([A-Za-z0-9_-]{32,256})\s*$/m)?.[1];
  if(!secret)throw new Error('missing');
  const response=await fetch('https://web-design-pros-astro.pages.dev/api/internal/order-alerts',{method:'POST',headers:{Authorization:`Bearer ${secret}`},signal:AbortSignal.timeout(60000)});
  if(!response.ok){console.error(`Order alert retry failed (HTTP ${response.status}). Check configuration and deployment.`);process.exitCode=1;}
  else{
    const result=await response.json();
    console.log(result.allDueDelivered?'All deliveries due in this batch were accepted.':'Some deliveries are still pending.');
    const reasons={request_timeout:'The request timed out before delivery was confirmed.',request_aborted:'The request was interrupted; delivery is uncertain.',network_error:'The connection failed; delivery is uncertain.',response_unreadable:'The provider response could not be read.',delivery_record_failed:'Provider accepted the message, but its delivery record could not be saved. Check the chat before retrying.',configuration:'Required notification settings are missing.',invalid_response:'Provider response did not confirm acceptance.',manual_review:'Held for manual review.',delivery_uncertain:'Delivery is uncertain; check the delivery table.'};
    for(const item of (Array.isArray(result.pendingAlerts)?result.pendingAlerts:[]).slice(0,20)){
      if(!/^WDP-(?:TEST-)?\d+$/.test(item.reference)||!['email','telegram'].includes(item.channel)||!Number.isSafeInteger(item.attempts))continue;
      const reason=reasons[item.error]??(/^http_\d{3}$/.test(item.error)?`Provider returned HTTP ${item.error.slice(5)}.`:'Delivery is uncertain.');
      console.log(`${item.reference} | ${item.channel} | attempts: ${item.attempts} | ${reason}`);
    }
    console.log('Check the delivery table for remaining or held alerts.');
  }
}catch{console.error('Could not retry order alerts. Check the saved retry secret in .dev.vars and your connection. No secrets printed.');process.exitCode=1;}
