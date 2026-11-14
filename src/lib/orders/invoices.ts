import {AccountError} from '../accounts/auth';
import {orderReference,type OrderRow} from './core';

export const invoiceSeller={name:'Web Design Pros (Pty) Ltd',registrationNumber:'2026/282129/07',address:'15 Madge Avenue, Northcliff, Johannesburg, 2115',email:'info@webdesignpros.co.za',phone:'075 221 6842',website:'webdesignpros.co.za'};
// Use purchase snapshots, never current catalogue prices. Reuse the WDP reference
// without consuming another order sequence or creating another charge.
export function invoiceSummary(order:OrderRow){
  if(order.payment_status!=='paid')throw new AccountError(404,'Invoice not found.');
  return {id:order.id,reference:orderReference(order),mode:order.mode,issuedAt:order.paid_at??order.created_at,paidAt:order.paid_at,amount:order.amount,currency:order.currency,status:'paid' as const};
}
export function invoiceDetail(order:OrderRow){
  const summary=invoiceSummary(order),cart=JSON.parse(order.cart_json),billing=JSON.parse(order.billing_json);
  const lines:{description:string;period:string;amount:number}[]=[];
  if(!Array.isArray(cart.domains))throw new AccountError(503,'Invoice details are unavailable. Please contact WDP.');
  for(const item of cart.domains){
    const years=item.years??1;
    if(typeof item.domain!=='string'||!Number.isSafeInteger(item.cents)||item.cents<=0||!Number.isInteger(years)||years<1||years>5)throw new AccountError(503,'Invoice details are unavailable. Please contact WDP.');
    lines.push({description:`Domain registration: ${item.domain}`,period:`${years} ${years===1?'year':'years'}`,amount:item.cents});
  }
  const domainTotal=lines.reduce((total,item)=>total+item.amount,0),hostingAmount=order.amount-domainTotal;
  if(cart.hosting&&Number.isSafeInteger(hostingAmount)&&hostingAmount>0)lines.push({description:'Starter hosting with email',period:'First month',amount:hostingAmount});
  if(!Number.isSafeInteger(order.amount)||order.amount<=0||order.currency!=='ZAR'||lines.reduce((total,item)=>total+item.amount,0)!==order.amount)throw new AccountError(503,'Invoice totals could not be verified. Please contact WDP.');
  const billedTo=Object.fromEntries(['firstName','lastName','company','email','phone','address','city','province','postalCode','country'].map(key=>[key,typeof billing[key]==='string'?billing[key]:'']));
  return {...summary,seller:invoiceSeller,lines,billing:billedTo,total:order.amount,amountPaid:order.amount,balanceDue:0,orderCount:1,sourceOrders:[{id:summary.id,reference:summary.reference,amount:summary.amount,paidAt:summary.paidAt}]};
}

// One invoice for the completed client group, using purchase snapshots and the
// earliest existing WDP reference. This never allocates another order number.
export function consolidatedInvoice(orders:OrderRow[],issuedAt:string){
  if(!orders.length||new Set(orders.map(order=>order.id)).size!==orders.length||orders.some(order=>order.mode!==orders[0].mode))throw new AccountError(503,'Invoice purchases could not be verified. Please contact WDP.');
  const details=[...orders].sort((a,b)=>a.sequence-b.sequence).map(invoiceDetail);
  if(details.length===1)return details[0];
  const first=details[0],latest=details.at(-1)!,total=details.reduce((sum,item)=>sum+item.total,0);
  if(!Number.isSafeInteger(total))throw new AccountError(503,'Invoice totals could not be verified. Please contact WDP.');
  const paidAt=details.map(item=>item.paidAt).filter((value):value is string=>!!value).sort().at(-1)??null;
  return {...first,issuedAt,paidAt,billing:latest.billing,amount:total,total,amountPaid:total,balanceDue:0,orderCount:details.length,
    lines:details.flatMap(item=>item.lines.map(line=>({...line,description:line.description+' · '+item.reference}))),
    sourceOrders:details.map(item=>({id:item.id,reference:item.reference,amount:item.amount,paidAt:item.paidAt}))};
}
