import type {AccountEnv} from '../accounts/auth';
import {orderReference,type OrderRow} from './core';
import {rand} from '../domains/catalogue';

export interface AlertEnv extends AccountEnv {
  WDP_ORDER_EMAIL_ENABLED?:string;
  WDP_ORDER_TELEGRAM_ENABLED?:string;
  WDP_ORDER_TEST_ALERTS_ENABLED?:string;
  WDP_ORDER_ALERT_EMAIL?:string;
  WDP_TELEGRAM_BOT_TOKEN?:string;
  WDP_TELEGRAM_CHAT_ID?:string;
  WDP_ORDER_ALERT_RETRY_SECRET?:string;
}
type Channel='email'|'telegram';
type AlertRow={order_id:string;channel:Channel;payload_json:string;status:string;attempts:number;created_at:string};
export function enabledChannels(env:AlertEnv):Channel[]{
  return [...(env.WDP_ORDER_EMAIL_ENABLED==='true'?['email' as const]:[]),...(env.WDP_ORDER_TELEGRAM_ENABLED==='true'?['telegram' as const]:[])];
}
export function alertMessage(order:OrderRow){
  const cart=JSON.parse(order.cart_json),reference=orderReference(order);
  const subject=order.mode==='test'?`TEST paid order ${reference} — do not register`:`Paid order ${reference} — registration required`;
  const lines=cart.domains.map((item:{domain:string;years?:number;cents:number})=>`${item.domain} | ${item.years??1} ${(item.years??1)===1?'year':'years'} | ${rand(item.cents)}`);
  if(cart.hosting)lines.push('Starter hosting with email | first month | R60');
  return {subject,text:[subject,'',`Payment confirmed: ${rand(order.amount)} ZAR`,...lines,'',order.mode==='test'?'TEST PAYMENT ONLY. No real money received. Do not buy or register these domains.':'Awaiting manual registration through TrueHost. Use the saved WDP order registrant details. Confirm registration and actual expiry before marking the domain active.','',`WDP reference: ${reference}`].join('\n')};
}
// Called only after payment signature/amount/mode validation and saved-order sync.
// Persist independent channel deliveries before making external requests.
export async function queuePaidOrderAlerts(env:AlertEnv,orderId:string){
  const channels=enabledChannels(env);if(!channels.length)return;
  if(!env.DB)throw new Error('Order alert database missing');
  const order=await env.DB.prepare('SELECT * FROM wdp_orders WHERE id=?').bind(orderId).first<OrderRow>();
  if(!order||order.payment_status!=='paid')return;
  if(order.mode==='test'&&env.WDP_ORDER_TEST_ALERTS_ENABLED!=='true')return;
  const message=alertMessage(order);
  const statements=channels.map(channel=>{
    if(channel==='email'&&(!env.RESEND_API_KEY||!env.AUTH_FROM_EMAIL||!env.WDP_ORDER_ALERT_EMAIL||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.WDP_ORDER_ALERT_EMAIL)))throw new Error('Order email alerts not configured');
    if(channel==='telegram'&&(!/^\d+:[A-Za-z0-9_-]+$/.test(env.WDP_TELEGRAM_BOT_TOKEN??'')||!/^\d+$/.test(env.WDP_TELEGRAM_CHAT_ID??'')))throw new Error('Private Telegram alerts not configured');
    const payload=channel==='email'?{from:env.AUTH_FROM_EMAIL,to:[env.WDP_ORDER_ALERT_EMAIL],...message}:{chat_id:env.WDP_TELEGRAM_CHAT_ID,text:message.text,link_preview_options:{is_disabled:true},protect_content:true};
    return env.DB!.prepare('INSERT OR IGNORE INTO wdp_order_alerts (order_id,channel,payload_json) VALUES (?,?,?)').bind(order.id,channel,JSON.stringify(payload));
  });
  await env.DB.batch(statements);
}
async function deliver(env:AlertEnv,row:AlertRow){
  const db=env.DB!,now=Date.now(),lease=crypto.randomUUID();
  const claim=await db.prepare("UPDATE wdp_order_alerts SET status='sending',lease_token=?,lease_until=?,attempts=attempts+1 WHERE order_id=? AND channel=? AND status!='sent' AND lease_until<=? AND next_attempt_at<=?").bind(lease,now+60000,row.order_id,row.channel,now,now).run();
  if(!claim.meta.changes)return false;
  try{
    // Resend retains idempotency keys for 24h. Stop ambiguous old retries for review.
    const created=Date.parse(row.created_at.replace(' ','T')+'Z');
    if(row.channel==='email'&&row.attempts>0&&Date.now()-created>23*60*60*1000)throw new Error('manual_review');
    const headers:Record<string,string>={'Content-Type':'application/json'};
    let url:string;
    if(row.channel==='email'){
      if(!env.RESEND_API_KEY)throw new Error('configuration');
      url='https://api.resend.com/emails';headers.Authorization=`Bearer ${env.RESEND_API_KEY}`;headers['Idempotency-Key']=`wdp-paid-order/${row.order_id}/email`;
    }else{
      if(!/^\d+:[A-Za-z0-9_-]+$/.test(env.WDP_TELEGRAM_BOT_TOKEN??''))throw new Error('configuration');
      url=`https://api.telegram.org/bot${env.WDP_TELEGRAM_BOT_TOKEN}/sendMessage`;
    }
    const response=await fetch(url,{method:'POST',headers,body:row.payload_json,signal:AbortSignal.timeout(8000)});
    if(!response.ok)throw new Error(`http_${response.status}`);
    const result=await response.json() as any;
    const id=row.channel==='email'?result.id:result.ok===true?result.result?.message_id:null;
    if(id===null||id===undefined||id==='')throw new Error('invalid_response');
    await db.prepare("UPDATE wdp_order_alerts SET status='sent',sent_at=CURRENT_TIMESTAMP,provider_id=?,last_error=NULL,lease_token=NULL,lease_until=0 WHERE order_id=? AND channel=? AND lease_token=?").bind(String(id),row.order_id,row.channel,lease).run();
    return true;
  }catch(error){
    // Never persist provider bodies, tokens, request URLs or personal details in errors.
    const reason=error instanceof Error&&/^(http_\d{3}|configuration|invalid_response|manual_review)$/.test(error.message)?error.message:'delivery_uncertain';
    await db.prepare("UPDATE wdp_order_alerts SET status='pending',next_attempt_at=?,last_error=?,lease_token=NULL,lease_until=0 WHERE order_id=? AND channel=? AND lease_token=?").bind(Date.now()+60000,reason,row.order_id,row.channel,lease).run();
    return false;
  }
}
export async function deliverOrderAlerts(env:AlertEnv,orderId?:string){
  const channels=enabledChannels(env);if(!channels.length||!env.DB)return true;
  const rows=await env.DB.prepare("SELECT a.* FROM wdp_order_alerts a JOIN wdp_orders o ON o.id=a.order_id WHERE a.status!='sent' AND o.payment_status='paid'"+(env.WDP_ORDER_TEST_ALERTS_ENABLED==='true'?'':" AND o.mode!='test'")+(orderId?' AND a.order_id=?':" AND a.next_attempt_at<=? AND a.lease_until<=? AND COALESCE(a.last_error,'')!='manual_review'")+' ORDER BY a.created_at LIMIT 20').bind(...(orderId?[orderId]:[Date.now(),Date.now()])).all<AlertRow>();
  const selected=rows.results.filter(row=>channels.includes(row.channel));
  const results=await Promise.allSettled(selected.map(row=>deliver(env,row)));
  return results.every(result=>result.status==='fulfilled'&&result.value);
}
