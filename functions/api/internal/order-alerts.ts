import {deliverOrderAlerts,type AlertEnv} from '../../../src/lib/orders/alerts';
import {hash,json} from '../../../src/lib/payments/core';
import {deliverRegistrationEmails} from '../../../src/lib/orders/registration-emails';

export const onRequestPost:PagesFunction<AlertEnv>=async({request,env})=>{
  const token=request.headers.get('authorization')?.replace(/^Bearer /,'');
  if(!env.WDP_ORDER_ALERT_RETRY_SECRET||env.WDP_ORDER_ALERT_RETRY_SECRET.length<32||!token||token.length>256||await hash(token)!==await hash(env.WDP_ORDER_ALERT_RETRY_SECRET))return json({error:'Not permitted.'},403);
  try{const alerts=await deliverOrderAlerts(env),registrations=await deliverRegistrationEmails(env);return json({processed:true,allDueDelivered:alerts&&registrations});}
  catch{return json({error:'Order alerts could not be processed.'},503);}
};
