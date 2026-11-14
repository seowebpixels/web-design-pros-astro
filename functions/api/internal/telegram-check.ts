import {hash,json} from '../../../src/lib/payments/core';
import type {AlertEnv} from '../../../src/lib/orders/alerts';
import {checkTelegramConnection} from '../../../src/lib/orders/telegram-check.mjs';

export const onRequestPost:PagesFunction<AlertEnv>=async({request,env})=>{
  const token=request.headers.get('authorization')?.replace(/^Bearer /,'');
  if(!env.WDP_ORDER_ALERT_RETRY_SECRET||env.WDP_ORDER_ALERT_RETRY_SECRET.length<32||!token||token.length>256||await hash(token)!==await hash(env.WDP_ORDER_ALERT_RETRY_SECRET))return json({error:'Not permitted.'},403);
  const checks=await checkTelegramConnection(env.WDP_TELEGRAM_BOT_TOKEN,env.WDP_TELEGRAM_CHAT_ID);
  return json({checks});
};
