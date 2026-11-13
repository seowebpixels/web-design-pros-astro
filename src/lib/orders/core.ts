import {AccountError,type AccountEnv} from '../accounts/auth';
import {validateProfile} from '../accounts/profile';
import {PaymentError} from '../payments/core';
import {priceForHostname} from '../domains/catalogue';

export interface OrderRow {
  id:string;customer_id:string;mode:'test'|'live';sequence:number;access_hash:string;
  cart_json:string;billing_json:string;registrant_json:string;amount:number;currency:string;
  payment_status:string;fulfilment_status:string;checkout_id:string|null;payment_id:string|null;
  terms_url:string;terms_accepted_at:string;created_at:string;paid_at:string|null;
}
export const orderReference=(order:Pick<OrderRow,'mode'|'sequence'>)=>`${order.mode==='test'?'WDP-TEST-':'WDP-'}${String(order.sequence).padStart(7,'0')}`;
const termsUrl='https://truehost.cloud/terms-of-service/';
function text(value:unknown,label:string,optional=false){
  if(typeof value!=='string'||value.trim().length>200||/[\u0000-\u001f]/.test(value)||(!optional&&!value.trim()))throw new PaymentError(400,`Please check the domain owner's ${label}.`);
  return value.trim();
}
export function registrantDetails(input:any,billing:Record<string,string>){
  if(typeof input?.sameAsBilling!=='boolean')throw new PaymentError(400,'Please select the domain owner details.');
  if(input.sameAsBilling)return {sameAsBilling:true,name:`${billing.firstName} ${billing.lastName}`,email:billing.email,phone:billing.phone,company:billing.company,address:billing.address,city:billing.city,province:billing.province,postalCode:billing.postalCode,country:billing.country};
  const owner={sameAsBilling:false,name:text(input.name,'name'),email:text(input.email,'email'),phone:text(input.phone,'phone'),company:text(input.company??'','organisation',true),address:text(input.address,'address'),city:text(input.city,'city'),province:text(input.province,'province'),postalCode:text(input.postalCode,'postal code'),country:text(input.country,'country')};
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner.email))throw new PaymentError(400,'Please check the domain owner email address.');
  return owner;
}
export async function saveTestOrder(env:AccountEnv,user:{id:string;email:string},input:any,priced:{cart:string;amount:number},accessHash:string){
  if(!env.DB)throw new AccountError(503,'Customer orders are not configured.');
  const db=env.DB;
  const saved=await db.prepare('SELECT profile_json FROM wdp_customer_profiles WHERE auth_user_id=?').bind(user.id).first<{profile_json:string}>();
  if(!saved)throw new PaymentError(400,'Please save your billing details before payment.');
  const billing={...validateProfile(JSON.parse(saved.profile_json)),email:user.email};
  const billingJson=JSON.stringify(billing),registrantJson=JSON.stringify(registrantDetails(input.registrant,billing));
  const priceSnapshot=JSON.stringify(JSON.parse(priced.cart).domains.map((item:{domain:string;cents:number;years?:number})=>{const price=priceForHostname(item.domain),years=item.years??1;return {domain:item.domain,registrationCents:item.cents,renewalCents:price?.yearlyPricesCents[years]??null,transferCents:price?.transferCents??null,years,yearlyPricesCents:price?.yearlyPricesCents??[]};}));
  // D1 executes the batch transactionally. Concurrent requests cannot share a number;
  // repeating the same order ID does not advance the counter or create another order.
  await db.batch([
    db.prepare("INSERT INTO wdp_orders (id,customer_id,mode,sequence,access_hash,cart_json,billing_json,registrant_json,amount,terms_url) SELECT ?,?,'test',next_value,?,?,?,?,?,? FROM wdp_order_sequences WHERE mode='test' ON CONFLICT(id) DO NOTHING").bind(input.attemptId,user.id,accessHash,priced.cart,billingJson,registrantJson,priced.amount,termsUrl),
    db.prepare("INSERT OR IGNORE INTO wdp_order_prices (order_id,prices_json) SELECT id,? FROM wdp_orders WHERE id=? AND customer_id=? AND mode='test' AND sequence=(SELECT next_value FROM wdp_order_sequences WHERE mode='test')").bind(priceSnapshot,input.attemptId,user.id),
    db.prepare("UPDATE wdp_order_sequences SET next_value=next_value+1 WHERE mode='test' AND EXISTS (SELECT 1 FROM wdp_orders WHERE id=? AND mode='test' AND sequence=wdp_order_sequences.next_value)").bind(input.attemptId)
  ]);
  const order=await db.prepare('SELECT * FROM wdp_orders WHERE id=?').bind(input.attemptId).first<OrderRow>();
  if(!order)throw new PaymentError(503,'Order setup is incomplete. Please contact WDP.');
  if(order.customer_id!==user.id||order.mode!=='test'||order.access_hash!==accessHash||order.cart_json!==priced.cart||order.amount!==priced.amount||order.billing_json!==billingJson||order.registrant_json!==registrantJson)throw new PaymentError(409,'This payment attempt belongs to different purchase details. Refresh checkout and try again.');
  return order;
}
export async function syncTestOrder(env:AccountEnv,payment:{id:string;cart_json:string;amount:number;status:string;checkout_id:string|null;payment_id?:string|null}){
  if(!env.DB)return null;
  const db=env.DB,order=await db.prepare('SELECT * FROM wdp_orders WHERE id=?').bind(payment.id).first<OrderRow>();
  if(!order)return null; // Older sandbox payments predate saved orders.
  if(order.mode!=='test'||order.amount!==payment.amount||order.cart_json!==payment.cart_json)throw new PaymentError(409,'Payment does not match the saved order.');
  if(payment.status==='paid'){
    if(!payment.payment_id)throw new PaymentError(503,'Payment confirmation is incomplete. Please check again.');
    await db.prepare("UPDATE wdp_orders SET payment_status='paid',checkout_id=?,payment_id=?,paid_at=COALESCE(paid_at,CURRENT_TIMESTAMP) WHERE id=?").bind(payment.checkout_id,payment.payment_id,order.id).run();
  }else if(payment.status==='failed'){
    await db.prepare("UPDATE wdp_orders SET payment_status='failed',checkout_id=? WHERE id=? AND payment_status!='paid'").bind(payment.checkout_id,order.id).run();
  }else if(payment.checkout_id){await db.prepare('UPDATE wdp_orders SET checkout_id=? WHERE id=?').bind(payment.checkout_id,order.id).run();}
  return {...order,payment_status:order.payment_status==='paid'?'paid':payment.status};
}
export function publicOrder(order:OrderRow,detail=false){
  const value={id:order.id,reference:orderReference(order),mode:order.mode,amount:order.amount,currency:order.currency,paymentStatus:order.payment_status,fulfilmentStatus:order.fulfilment_status,createdAt:order.created_at,paidAt:order.paid_at,items:JSON.parse(order.cart_json)};
  return detail?{...value,billing:JSON.parse(order.billing_json),registrant:JSON.parse(order.registrant_json),terms:{url:order.terms_url,acceptedAt:order.terms_accepted_at}}:value;
}
