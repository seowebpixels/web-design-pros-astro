import {priceForHostname} from '../domains/catalogue';
import {orderReference,type OrderRow} from './core';
export function purchasedServices(order:OrderRow&{prices_json?:string|null}){
  if(order.payment_status!=='paid')return [];
  const cart=JSON.parse(order.cart_json),prices=order.prices_json?JSON.parse(order.prices_json):[];
  const base={orderId:order.id,reference:orderReference(order),mode:order.mode,status:order.mode==='test'?'test_purchase':'pending_setup',nextDueDate:null};
  const services=cart.domains.map((item:{domain:string;cents:number})=>{
    const snapshot=prices.find((price:any)=>price.domain===item.domain),catalogue=priceForHostname(item.domain);
    return {...base,id:order.id+':'+item.domain,product:'Domain Registration',domain:item.domain,paidCents:item.cents,recurringCents:snapshot?snapshot.renewalCents:catalogue?.renewalCents??null,priceSource:snapshot?'purchase':'current_catalogue',cycle:'Annual',status:order.mode==='test'?'test_purchase':'pending_registration'};
  });
  if(cart.hosting)services.push({...base,id:order.id+':hosting',product:'Starter Hosting',domain:cart.domains.length===1?cart.domains[0].domain:'To be assigned',paidCents:6000,recurringCents:6000,priceSource:'purchase',cycle:'Monthly'});
  return services;
}
