import {queueRenewalReminders,deliverRenewalMail,type RenewalEnv} from '../../../src/lib/orders/renewals';
import {hash,json} from '../../../src/lib/payments/core';
type Env=RenewalEnv&{WDP_ORDER_ALERT_RETRY_SECRET?:string};
export const onRequestPost:PagesFunction<Env>=async({request,env})=>{
 const secret=env.WDP_ORDER_ALERT_RETRY_SECRET,token=request.headers.get('authorization')?.replace(/^Bearer /,'');
 if(!secret||secret.length<32||!token||await hash(token)!==await hash(secret))return json({error:'Not permitted.'},403);
 try{const queued=await queueRenewalReminders(env),delivery=await deliverRenewalMail(env);return json({queued,...delivery});}catch{return json({error:'Renewal reminders unavailable. Check configuration and migration.'},503);}
};
