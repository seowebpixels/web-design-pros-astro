import {priceForHostname,renewalPriceCents} from '../domains/catalogue';
import {orderReference,type OrderRow} from './core';
export function nextBillingDate(purchasedAt:string,cycle:'Annual'|'Monthly',years=1){
  // Stored order timestamps are UTC. Billing follows the South African purchase date.
  const normalized=purchasedAt.replace(' ','T'),instant=new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)?normalized:normalized+'Z');
  if(!Number.isFinite(instant.getTime()))return null;
  const parts=new Intl.DateTimeFormat('en-ZA',{timeZone:'Africa/Johannesburg',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(instant);
  const part=(type:string)=>Number(parts.find(value=>value.type===type)!.value);
  const target=new Date(Date.UTC(part('year'),part('month')-1+(cycle==='Annual'?12*years:1),1));
  const lastDay=new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate();
  target.setUTCDate(Math.min(part('day'),lastDay));
  return target.toISOString().slice(0,10);
}
export function purchasedServices(order:OrderRow&{prices_json?:string|null}){
  if(order.payment_status!=='paid')return [];
  const cart=JSON.parse(order.cart_json),prices=order.prices_json?JSON.parse(order.prices_json):[];
  const purchasedAt=order.paid_at??order.created_at;
  const base={orderId:order.id,reference:orderReference(order),mode:order.mode,status:order.mode==='test'?'test_purchase':'pending_setup'};
  const services=cart.domains.map((item:{domain:string;cents:number;years?:number})=>{
    const snapshot=prices.find((price:any)=>price.domain===item.domain),catalogue=priceForHostname(item.domain);
    const years=item.years??snapshot?.years??1;
    return {...base,id:order.id+':'+item.domain,product:'Domain Registration',domain:item.domain,years,paidCents:item.cents,recurringCents:snapshot?snapshot.renewalCents:catalogue?renewalPriceCents(catalogue,years):null,renewalYears:snapshot?(snapshot.renewalYears??1):years,priceSource:snapshot?'purchase':'current_catalogue',cycle:'Annual',nextDueDate:nextBillingDate(purchasedAt,'Annual',years),status:order.mode==='test'?'test_purchase':'pending_registration'};
  });
  if(cart.hosting)services.push({...base,id:order.id+':hosting',product:'Starter Hosting',domain:cart.domains.length===1?cart.domains[0].domain:'To be assigned',paidCents:6000,recurringCents:6000,priceSource:'purchase',cycle:'Monthly',nextDueDate:nextBillingDate(purchasedAt,'Monthly')});
  return services;
}
