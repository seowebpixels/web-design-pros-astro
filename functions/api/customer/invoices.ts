import {accountJson,accountFailure,AccountError,requireCustomer,type AccountEnv} from '../../../src/lib/accounts/auth';
import {invoiceDetail,invoiceSummary} from '../../../src/lib/orders/invoices';
import type {OrderRow} from '../../../src/lib/orders/core';
import {uuid} from '../../../src/lib/payments/core';
export const onRequestGet:PagesFunction<AccountEnv>=async context=>{
  try{
    const session=await requireCustomer(context.request,context.env,p=>context.waitUntil(p));
    const params=new URL(context.request.url).searchParams,id=params.get('invoice');
    if(id!==null){
      if(!uuid(id))throw new AccountError(404,'Invoice not found.');
      const order=await context.env.DB!.prepare("SELECT * FROM wdp_orders WHERE id=? AND customer_id=? AND payment_status='paid'").bind(id,session.user.id).first<OrderRow>();
      if(!order)throw new AccountError(404,'Invoice not found.');
      return accountJson({invoice:invoiceDetail(order)});
    }
    const mode=params.get('mode')??'test',before=params.get('before');
    if(!['test','live'].includes(mode)||(before!==null&&(!/^\d{1,10}$/.test(before)||Number(before)<1)))throw new AccountError(400,'Invalid invoice page.');
    const rows=await context.env.DB!.prepare("SELECT * FROM wdp_orders WHERE customer_id=? AND mode=? AND payment_status='paid' AND sequence<? ORDER BY sequence DESC LIMIT 26").bind(session.user.id,mode,before?Number(before):Number.MAX_SAFE_INTEGER).all<OrderRow>();
    const invoices=rows.results.slice(0,25);
    const totals=await context.env.DB!.prepare("SELECT COUNT(*) AS total,COALESCE(SUM(amount),0) AS amount FROM wdp_orders WHERE customer_id=? AND mode=? AND payment_status='paid'").bind(session.user.id,mode).first<{total:number;amount:number}>();
    return accountJson({invoices:invoices.map(invoiceSummary),invoiceCount:totals?.total??0,totalPaid:totals?.amount??0,unpaidInvoiceCount:0,nextBefore:rows.results.length>25?invoices.at(-1)!.sequence:null});
  }catch(error){return accountFailure(error);}
};
