import {queueRenewalReminders,deliverRenewalMail,type RenewalEnv} from '../../../src/lib/orders/renewals';
import {hash,json} from '../../../src/lib/payments/core';
type Env=RenewalEnv&{WDP_ORDER_ALERT_RETRY_SECRET?:string};
export const onRequestPost:PagesFunction<Env>=async({request,env})=>{
 const secret=env.WDP_ORDER_ALERT_RETRY_SECRET,token=request.headers.get('authorization')?.replace(/^Bearer /,'');
 if(!secret||secret.length<32||!token||await hash(token)!==await hash(secret))return json({error:'Not permitted.'},403);
 try{
  const settings={renewalsEnabled:env.WDP_RENEWALS_ENABLED==='true',emailsEnabled:env.WDP_RENEWAL_EMAIL_ENABLED==='true',testEmailsEnabled:env.WDP_RENEWAL_TEST_EMAILS_ENABLED==='true'};
  if(!settings.renewalsEnabled||!env.DB)return json({error:'Domain renewals or the database binding are not enabled in this deployment.'},503);
  const queued=await queueRenewalReminders(env),delivery=await deliverRenewalMail(env);
  const outstanding=await env.DB.prepare("SELECT mode,COUNT(*) AS total FROM wdp_renewal_mail WHERE status NOT IN ('sent','skipped') GROUP BY mode").all<{mode:string;total:number}>();
  return json({queued,...delivery,settings,outstanding:outstanding.results});
 }catch{return json({error:'Renewal reminders unavailable. Check configuration and migration.'},503);}
};
