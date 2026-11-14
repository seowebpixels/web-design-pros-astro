import {accountJson,accountFailure,AccountError,requireCustomer,type AccountEnv} from '../../../src/lib/accounts/auth';
import {invoiceDetail,invoiceSummary} from '../../../src/lib/orders/invoices';
import type {OrderRow} from '../../../src/lib/orders/core';
import {uuid} from '../../../src/lib/payments/core';

// A finalized client invoice owns every included purchase. Keep historical
// single-order invoices intact; never expose the private delivery envelope.
const finalized=`json_extract(e.payload_json,'$.scope')='client' AND json_extract(e.payload_json,'$.invoiceFormat')='consolidated-v1' AND e.first_attempt_at IS NOT NULL AND json_extract(e.payload_json,'$.invoice') IS NOT NULL`;
const member=(id:string)=>`EXISTS(SELECT 1 FROM json_each(e.payload_json,'$.orders') member WHERE json_extract(member.value,'$.id')=${id})`;
const owner=`NOT EXISTS(SELECT 1 FROM json_each(e.payload_json,'$.orders') member LEFT JOIN wdp_orders owned ON owned.id=json_extract(member.value,'$.id') AND owned.customer_id=o.customer_id AND owned.mode=o.mode AND owned.payment_status='paid' WHERE owned.id IS NULL)`;
const visible=`NOT EXISTS(SELECT 1 FROM wdp_registration_emails e JOIN wdp_orders anchor ON anchor.id=e.order_id AND anchor.customer_id=o.customer_id AND anchor.mode=o.mode WHERE ${finalized} AND ${owner} AND e.order_id!=o.id AND ${member('o.id')})`;
const invoiceSnapshot=`(SELECT json_extract(e.payload_json,'$.invoice') FROM wdp_registration_emails e WHERE e.order_id=o.id AND ${finalized} AND ${owner} LIMIT 1)`;
const pdfAvailable=`EXISTS(SELECT 1 FROM wdp_registration_emails e WHERE e.order_id=o.id AND ${finalized} AND ${owner} AND json_extract(e.payload_json,'$.email.attachments[0].content') IS NOT NULL)`;
function downloadPdf(invoice:ReturnType<typeof invoiceDetail>,emailJson:string){
  const attachments=JSON.parse(emailJson)?.attachments,attachment=Array.isArray(attachments)&&attachments.length===1?attachments[0]:null;
  const filename=invoice.reference+'.pdf',content=attachment?.content;
  if(!/^WDP-(?:TEST-)?\d{7,}$/.test(invoice.reference)||attachment?.filename!==filename||attachment?.content_type!=='application/pdf'||typeof content!=='string'||content.length>1200000||!content.length||content.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(content))throw new AccountError(503,'Your invoice PDF is unavailable. Please contact WDP.');
  const raw=atob(content);
  if(!raw.startsWith('%PDF-')||raw.length>900000)throw new AccountError(503,'Your invoice PDF is unavailable. Please contact WDP.');
  return new Response(Uint8Array.from(raw,char=>char.charCodeAt(0)),{headers:{'content-type':'application/pdf','content-disposition':`attachment; filename="${filename}"`,'cache-control':'private, no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});
}
function summary(invoice:ReturnType<typeof invoiceDetail>){const {id,reference,mode,issuedAt,paidAt,amount,currency,status}=invoice;return {id,reference,mode,issuedAt,paidAt,amount,currency,status};}
export const onRequestGet:PagesFunction<AccountEnv>=async context=>{
  try{
    const session=await requireCustomer(context.request,context.env,p=>context.waitUntil(p));
    const params=new URL(context.request.url).searchParams,id=params.get('invoice'),db=context.env.DB!,download=params.get('download');
    if(download!==null&&(download!=='pdf'||id===null))throw new AccountError(400,'Choose an invoice to download.');
    if(id!==null){
      if(!uuid(id))throw new AccountError(404,'Invoice not found.');
      const order=await db.prepare("SELECT * FROM wdp_orders WHERE id=? AND customer_id=? AND payment_status='paid'").bind(id,session.user.id).first<OrderRow>();
      if(!order)throw new AccountError(404,'Invoice not found.');
      const combined=await db.prepare(`SELECT json_extract(e.payload_json,'$.invoice') AS invoice_json,json_extract(e.payload_json,'$.email') AS email_json FROM wdp_orders o JOIN wdp_registration_emails e JOIN wdp_orders anchor ON anchor.id=e.order_id AND anchor.customer_id=o.customer_id AND anchor.mode=o.mode WHERE o.id=? AND o.customer_id=? AND ${finalized} AND ${owner} AND ${member('o.id')} LIMIT 1`).bind(id,session.user.id).first<{invoice_json:string;email_json:string}>();
      const invoice=combined?JSON.parse(combined.invoice_json):invoiceDetail(order);
      const hasPdf=!!(combined&&JSON.parse(combined.email_json)?.attachments?.[0]?.content);
      if(download==='pdf'){
        if(!hasPdf)throw new AccountError(409,'Your PDF will be available once registration is complete and the invoice email is prepared.');
        return downloadPdf(invoice,combined!.email_json);
      }
      return accountJson({invoice,pdfAvailable:hasPdf});
    }
    const mode=params.get('mode')??'test',before=params.get('before');
    if(!['test','live'].includes(mode)||(before!==null&&(!/^\d{1,10}$/.test(before)||Number(before)<1)))throw new AccountError(400,'Invalid invoice page.');
    const rows=await db.prepare(`SELECT o.*,${invoiceSnapshot} AS consolidated_json,${pdfAvailable} AS pdf_available FROM wdp_orders o WHERE o.customer_id=? AND o.mode=? AND o.payment_status='paid' AND o.sequence<? AND ${visible} ORDER BY o.sequence DESC LIMIT 26`).bind(session.user.id,mode,before?Number(before):Number.MAX_SAFE_INTEGER).all<OrderRow&{consolidated_json:string|null;pdf_available:number}>();
    const invoices=rows.results.slice(0,25);
    const totals=await db.prepare(`SELECT COALESCE(SUM(CASE WHEN ${visible} THEN 1 ELSE 0 END),0) AS total,COALESCE(SUM(o.amount),0) AS amount FROM wdp_orders o WHERE o.customer_id=? AND o.mode=? AND o.payment_status='paid'`).bind(session.user.id,mode).first<{total:number;amount:number}>();
    return accountJson({invoices:invoices.map(order=>({... (order.consolidated_json?summary(JSON.parse(order.consolidated_json)):invoiceSummary(order)),pdfAvailable:!!order.pdf_available})),invoiceCount:totals?.total??0,totalPaid:totals?.amount??0,unpaidInvoiceCount:0,nextBefore:rows.results.length>25?invoices.at(-1)!.sequence:null});
  }catch(error){return accountFailure(error);}
};
