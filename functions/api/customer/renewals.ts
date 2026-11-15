import {accountJson,accountFailure,AccountError,requireCustomer} from '../../../src/lib/accounts/auth';
import {requireRenewals,renewalState,type RenewalEnv} from '../../../src/lib/orders/renewals';
import {priceForHostname,renewalPriceCents} from '../../../src/lib/domains/catalogue';
import {uuid} from '../../../src/lib/payments/core';
export const onRequestGet:PagesFunction<RenewalEnv>=async context=>{
 try{
  const session=await requireCustomer(context.request,context.env,p=>context.waitUntil(p)),db=requireRenewals(context.env);
  const params=new URL(context.request.url).searchParams,source=params.get('source'),domain=params.get('domain');
  if(!uuid(source)||!domain||domain.length>253)throw new AccountError(404,'Domain not found.');
  const row=await db.prepare("SELECT r.*,o.mode FROM wdp_domain_registrations r JOIN wdp_orders o ON o.id=r.order_id WHERE o.id=? AND o.customer_id=? AND o.payment_status='paid' AND r.domain=? AND COALESCE(json_extract(o.cart_json,'$.kind'),'registration')!='renewal'").bind(source,session.user.id,domain).first<any>();
  if(!row)throw new AccountError(404,'Domain not found.');
  if(row.status!=='registered'||!row.expires_on)throw new AccountError(409,'Registration must be confirmed before renewal.');
  const price=priceForHostname(domain),state=renewalState(row);
  const pending=await db.prepare("SELECT id,sequence,mode,payment_status,fulfilment_status,cart_json FROM wdp_orders WHERE customer_id=? AND mode=? AND json_extract(cart_json,'$.kind')='renewal' AND json_extract(cart_json,'$.renewal.sourceOrderId')=? AND json_extract(cart_json,'$.renewal.domain')=? AND json_extract(cart_json,'$.renewal.expiresOn')=?").bind(session.user.id,row.mode,source,domain,row.expires_on).first<any>();
  return accountJson({sourceOrderId:source,domain,mode:row.mode,expiresOn:row.expires_on,...state,available:row.mode==='test'&&!!price&&state.days!==null&&state.days>0,prices:price?[1,2,3,4,5].map(years=>({years,cents:renewalPriceCents(price,years)})):[],pending:pending?{id:pending.id,paymentStatus:pending.payment_status,fulfilmentStatus:pending.fulfilment_status,years:JSON.parse(pending.cart_json).domains[0].years}:null});
 }catch(error){return accountFailure(error);}
};
