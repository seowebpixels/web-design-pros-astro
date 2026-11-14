import {accountJson,accountFailure,AccountError} from '../../../src/lib/accounts/auth';
import {requireRegistrationAdmin} from '../../../src/lib/orders/registrations';
import {telegramAlertView,reviewTelegramAlert,type AlertEnv,type AlertRow} from '../../../src/lib/orders/alerts';
import {orderReference} from '../../../src/lib/orders/core';
import {readBody,uuid} from '../../../src/lib/payments/core';

export const onRequestGet:PagesFunction<AlertEnv>=async context=>{
  try{
    await requireRegistrationAdmin(context.request,context.env,p=>context.waitUntil(p));
    const params=new URL(context.request.url).searchParams,mode=params.get('mode')??'test',filter=params.get('filter')??'review',before=params.get('before');
    if(!['test','live'].includes(mode)||!['review','all'].includes(filter)||(before!==null&&(!/^\d{1,10}$/.test(before)||Number(before)<1)))throw new AccountError(400,'Invalid alert filter.');
    const review=filter==='review'?" AND a.status!='sent' AND a.attempts>0 AND (a.status!='sending' OR a.lease_until<=?) AND NOT (a.status='pending' AND COALESCE(a.last_error,'')='http_429')":'';
    const rows=await context.env.DB!.prepare("SELECT a.order_id,a.status,a.attempts,a.last_error,a.lease_until,a.sent_at,o.mode,o.sequence FROM wdp_order_alerts a JOIN wdp_orders o ON o.id=a.order_id WHERE a.channel='telegram' AND o.payment_status='paid' AND o.mode=? AND o.sequence<?"+review+' ORDER BY o.sequence DESC LIMIT 26').bind(mode,before?Number(before):Number.MAX_SAFE_INTEGER,...(filter==='review'?[Date.now()]:[])).all<AlertRow&{mode:'test'|'live';sequence:number}>();
    const visible=rows.results.slice(0,25);
    return accountJson({items:visible.map(row=>({orderId:row.order_id,reference:orderReference(row),...telegramAlertView(row)})),nextBefore:rows.results.length>25?visible.at(-1)!.sequence:null});
  }catch(error){return accountFailure(error);}
};

export const onRequestPost:PagesFunction<AlertEnv>=async context=>{
  try{
    if(context.request.headers.get('origin')!==context.env.AUTH_BASE_URL)throw new AccountError(403,'Request not permitted.');
    if(!context.request.headers.get('content-type')?.includes('application/json'))throw new AccountError(415,'JSON required.');
    await requireRegistrationAdmin(context.request,context.env,p=>context.waitUntil(p));
    let body;try{body=JSON.parse(await readBody(context.request,2000));}catch{throw new AccountError(400,'Invalid alert action.');}
    if(!uuid(body?.orderId)||!['received','retry'].includes(body?.action)||!Number.isSafeInteger(body?.attempts)||body.attempts<1||body.confirmed!==true)throw new AccountError(400,'Check the Telegram chat and confirm your choice.');
    return accountJson({alert:await reviewTelegramAlert(context.env,body.orderId,body.action,body.attempts)});
  }catch(error){return accountFailure(error);}
};
