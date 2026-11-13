import {accountJson,accountFailure,AccountError,requireCustomer,type AccountEnv} from '../../../src/lib/accounts/auth';
import {publicOrder,type OrderRow} from '../../../src/lib/orders/core';
import {uuid} from '../../../src/lib/payments/core';
export const onRequestGet:PagesFunction<AccountEnv>=async context=>{
  try{
    const session=await requireCustomer(context.request,context.env,p=>context.waitUntil(p));
    const params=new URL(context.request.url).searchParams,id=params.get('order');
    if(id!==null){
      if(!uuid(id))throw new AccountError(404,'Order not found.');
      const order=await context.env.DB!.prepare('SELECT * FROM wdp_orders WHERE id=? AND customer_id=?').bind(id,session.user.id).first<OrderRow>();
      if(!order)throw new AccountError(404,'Order not found.');
      return accountJson({order:publicOrder(order,true)});
    }
    const before=params.get('before');
    if(before!==null&&(!/^\d{1,10}$/.test(before)||Number(before)<1))throw new AccountError(400,'Invalid order page.');
    const rows=await context.env.DB!.prepare("SELECT * FROM wdp_orders WHERE customer_id=? AND mode='test' AND sequence<? ORDER BY sequence DESC LIMIT 26").bind(session.user.id,before?Number(before):Number.MAX_SAFE_INTEGER).all<OrderRow>();
    const orders=rows.results.slice(0,25);
    return accountJson({orders:orders.map(order=>publicOrder(order)),nextBefore:rows.results.length>25?orders.at(-1)!.sequence:null});
  }catch(error){return accountFailure(error);}
};
