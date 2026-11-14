import {accountJson,accountFailure,AccountError,requireCustomer,type AccountEnv} from '../../../src/lib/accounts/auth';
import {orderReference,type OrderRow} from '../../../src/lib/orders/core';
import type {RegistrationRow} from '../../../src/lib/orders/registrations';
export const onRequestGet:PagesFunction<AccountEnv>=async context=>{
  try{
    const session=await requireCustomer(context.request,context.env,p=>context.waitUntil(p));
    if(context.env.WDP_REGISTRATION_QUEUE_ENABLED!=='true')return accountJson({domains:[],domainCount:0,nextBefore:null});
    const params=new URL(context.request.url).searchParams,mode=params.get('mode')??'test',before=params.get('before');
    if(!['test','live'].includes(mode)||(before!==null&&(!/^\d{1,10}$/.test(before)||Number(before)<1)))throw new AccountError(400,'Invalid domain page.');
    const rows=await context.env.DB!.prepare("SELECT * FROM wdp_orders WHERE customer_id=? AND mode=? AND payment_status='paid' AND sequence<? ORDER BY sequence DESC LIMIT 26").bind(session.user.id,mode,before?Number(before):Number.MAX_SAFE_INTEGER).all<OrderRow>();
    const orders=rows.results.slice(0,25),domains:any[]=[];
    for(const order of orders){
      const records=await context.env.DB!.prepare('SELECT * FROM wdp_domain_registrations WHERE order_id=?').bind(order.id).all<RegistrationRow>();
      for(const item of JSON.parse(order.cart_json).domains){const record=records.results.find(row=>row.domain===item.domain);domains.push({domain:item.domain,orderId:order.id,reference:orderReference(order),mode:order.mode,years:item.years??1,status:record?.status??'pending',registeredOn:record?.registered_on??null,expiresOn:record?.expires_on??null});}
    }
    const count=await context.env.DB!.prepare("SELECT COUNT(*) AS total FROM wdp_domain_registrations r JOIN wdp_orders o ON o.id=r.order_id WHERE o.customer_id=? AND o.mode='live' AND o.payment_status='paid' AND r.status='registered'").bind(session.user.id).first<{total:number}>();
    return accountJson({domains,domainCount:count?.total??0,nextBefore:rows.results.length>25?orders.at(-1)!.sequence:null});
  }catch(error){return accountFailure(error);}
};
