import {accountJson,accountFailure,AccountError,requireCustomer,type AccountEnv} from '../../../src/lib/accounts/auth';
import {purchasedServices} from '../../../src/lib/orders/services';
import type {OrderRow} from '../../../src/lib/orders/core';
export const onRequestGet:PagesFunction<AccountEnv>=async context=>{
  try{
    const session=await requireCustomer(context.request,context.env,p=>context.waitUntil(p));
    const before=new URL(context.request.url).searchParams.get('before');
    if(before!==null&&(!/^\d{1,10}$/.test(before)||Number(before)<1))throw new AccountError(400,'Invalid services page.');
    const rows=await context.env.DB!.prepare("SELECT o.*,p.prices_json FROM wdp_orders o LEFT JOIN wdp_order_prices p ON p.order_id=o.id WHERE o.customer_id=? AND o.mode='test' AND o.payment_status='paid' AND o.sequence<? ORDER BY o.sequence DESC LIMIT 26").bind(session.user.id,before?Number(before):Number.MAX_SAFE_INTEGER).all<OrderRow&{prices_json:string|null}>();
    const orders=rows.results.slice(0,25);
    const count=await context.env.DB!.prepare("SELECT COALESCE(SUM(json_array_length(cart_json,'$.domains')+CASE WHEN json_extract(cart_json,'$.hosting')=1 THEN 1 ELSE 0 END),0) AS total FROM wdp_orders WHERE customer_id=? AND mode='test' AND payment_status='paid'").bind(session.user.id).first<{total:number}>();
    return accountJson({services:orders.flatMap(purchasedServices),serviceCount:count?.total??0,nextBefore:rows.results.length>25?orders.at(-1)!.sequence:null});
  }catch(error){return accountFailure(error);}
};
