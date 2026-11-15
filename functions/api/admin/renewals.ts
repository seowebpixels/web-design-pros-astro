import {accountJson,accountFailure,AccountError} from '../../../src/lib/accounts/auth';
import {requireRegistrationAdmin} from '../../../src/lib/orders/registrations';
import {requireRenewals,confirmRenewal,deliverRenewalMail,type RenewalEnv} from '../../../src/lib/orders/renewals';
import {orderReference} from '../../../src/lib/orders/core';
import {readBody} from '../../../src/lib/payments/core';
export const onRequestGet:PagesFunction<RenewalEnv>=async context=>{
 try{
  await requireRegistrationAdmin(context.request,context.env,p=>context.waitUntil(p));const db=requireRenewals(context.env),params=new URL(context.request.url).searchParams,mode=params.get('mode')??'test',before=params.get('before');
  if(!['test','live'].includes(mode)||(before!==null&&!/^\d{1,10}$/.test(before)))throw new AccountError(400,'Invalid renewal page.');
  const rows=await db.prepare("SELECT o.*,r.version,r.expires_on FROM wdp_orders o LEFT JOIN wdp_domain_registrations r ON r.order_id=json_extract(o.cart_json,'$.renewal.sourceOrderId') AND r.domain=json_extract(o.cart_json,'$.renewal.domain') WHERE o.mode=? AND o.payment_status='paid' AND json_extract(o.cart_json,'$.kind')='renewal' AND o.fulfilment_status!='renewal_complete' AND o.sequence<? ORDER BY o.sequence DESC LIMIT 26").bind(mode,before?Number(before):Number.MAX_SAFE_INTEGER).all<any>();
  const items=rows.results.slice(0,25).map(order=>{const cart=JSON.parse(order.cart_json),billing=JSON.parse(order.billing_json);return {orderId:order.id,reference:orderReference(order),domain:cart.renewal.domain,years:cart.domains[0].years,cents:order.amount,expiresOn:cart.renewal.expiresOn,expectedExpiresOn:cart.renewal.expectedExpiresOn,currentExpiresOn:order.expires_on,version:order.version,customer:billing.email,mode:order.mode};});
  const mail=await db.prepare("SELECT status,COUNT(*) AS total FROM wdp_renewal_mail WHERE mode=? AND status NOT IN ('sent','skipped') GROUP BY status").bind(mode).all();
  return accountJson({items,mail:mail.results,nextBefore:rows.results.length>25?rows.results[24].sequence:null});
 }catch(error){return accountFailure(error);}
};
export const onRequestPut:PagesFunction<RenewalEnv>=async context=>{
 try{
  if(context.request.headers.get('origin')!==context.env.AUTH_BASE_URL)throw new AccountError(403,'Request not permitted.');
  if(!context.request.headers.get('content-type')?.includes('application/json'))throw new AccountError(415,'JSON required.');
  const session=await requireRegistrationAdmin(context.request,context.env,p=>context.waitUntil(p));let input;try{input=JSON.parse(await readBody(context.request,3000));}catch{throw new AccountError(400,'Check renewal details.');}
  const saved=await confirmRenewal(context.env,session.user.id,input);
  let email='queued';try{const result=await deliverRenewalMail(context.env);email=result.pending?'pending':result.sent?'sent':'queued';}catch{}
  return accountJson({...saved,email});
 }catch(error){return accountFailure(error);}
};
