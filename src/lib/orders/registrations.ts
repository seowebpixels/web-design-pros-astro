import {AccountError,requireCustomer,type AccountEnv} from '../accounts/auth';
import {orderReference,type OrderRow} from './core';
import {uuid} from '../payments/core';
export interface RegistrationRow {
  order_id:string;domain:string;status:'pending'|'registered'|'issue';registered_on:string|null;expires_on:string|null;provider_reference:string;notes:string;updated_by:string;version:number;revision_id:string;updated_at:string;
}
export function isRegistrationAdmin(env:AccountEnv,email:string){
  return env.WDP_REGISTRATION_QUEUE_ENABLED==='true'&&!!env.WDP_REGISTRATION_ADMIN_EMAIL&&email.toLowerCase()===env.WDP_REGISTRATION_ADMIN_EMAIL.trim().toLowerCase();
}
export async function requireRegistrationAdmin(request:Request,env:AccountEnv,waitUntil:(p:Promise<unknown>)=>void){
  const session=await requireCustomer(request,env,waitUntil);
  if(!isRegistrationAdmin(env,session.user.email))throw new AccountError(403,'This area is restricted to the WDP administrator.');
  return session;
}
export function validDate(value:unknown):value is string{
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'2000-01-01'||value>'2100-12-31')return false;
  const instant=new Date(value+'T12:00:00Z');return Number.isFinite(instant.getTime())&&instant.toISOString().slice(0,10)===value;
}
function limited(value:unknown,max:number){if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))throw new AccountError(400,'Please check the reference and notes.');return value.trim();}
export function registrationInput(body:any){
  if(!uuid(body?.orderId)||typeof body.domain!=='string'||!Number.isSafeInteger(body.version)||body.version<0||!['pending','registered','issue'].includes(body.status))throw new AccountError(400,'Please check the registration details.');
  const registeredOn=body.registeredOn||null,expiresOn=body.expiresOn||null;
  if((registeredOn!==null&&!validDate(registeredOn))||(expiresOn!==null&&!validDate(expiresOn)))throw new AccountError(400,'Enter valid registration and expiry dates.');
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Johannesburg',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  if(body.status==='registered'&&(!registeredOn||!expiresOn||registeredOn>today||expiresOn<=registeredOn))throw new AccountError(400,'A registered domain needs its actual registration date and a later expiry date.');
  const value={orderId:body.orderId,domain:body.domain.toLowerCase(),version:body.version,status:body.status,registeredOn:body.status==='registered'?registeredOn:null,expiresOn:body.status==='registered'?expiresOn:null,providerReference:limited(body.providerReference??'',120),notes:limited(body.notes??'',2000),confirmed:body.confirmed===true};
  if(body.status==='registered'&&(!value.confirmed||!value.providerReference))throw new AccountError(400,'Confirm the registration and enter the TrueHost reference.');
  if(body.status==='issue'&&!value.notes)throw new AccountError(400,'Describe the registration problem in the notes.');
  return value;
}
export async function saveRegistration(env:AccountEnv,actorId:string,body:any){
  const input=registrationInput(body),db=env.DB!;
  const order=await db.prepare('SELECT * FROM wdp_orders WHERE id=?').bind(input.orderId).first<OrderRow>();
  if(!order||order.payment_status!=='paid'||!JSON.parse(order.cart_json).domains.some((item:any)=>item.domain===input.domain))throw new AccountError(404,'Paid domain purchase not found.');
  const before=await db.prepare('SELECT * FROM wdp_domain_registrations WHERE order_id=? AND domain=?').bind(input.orderId,input.domain).first<RegistrationRow>();
  if((before?.version??0)!==input.version)throw new AccountError(409,'This record changed. Refresh the queue before saving again.');
  const revision=crypto.randomUUID();
  await db.batch([
    db.prepare("INSERT INTO wdp_domain_registrations (order_id,domain,status,registered_on,expires_on,provider_reference,notes,updated_by,version,revision_id) SELECT ?,?,?,?,?,?,?,?,1,? WHERE ?=0 OR EXISTS(SELECT 1 FROM wdp_domain_registrations WHERE order_id=? AND domain=? AND version=?) ON CONFLICT(order_id,domain) DO UPDATE SET status=excluded.status,registered_on=excluded.registered_on,expires_on=excluded.expires_on,provider_reference=excluded.provider_reference,notes=excluded.notes,updated_by=excluded.updated_by,version=wdp_domain_registrations.version+1,revision_id=excluded.revision_id,updated_at=CURRENT_TIMESTAMP WHERE wdp_domain_registrations.version=?").bind(input.orderId,input.domain,input.status,input.registeredOn,input.expiresOn,input.providerReference,input.notes,actorId,revision,input.version,input.orderId,input.domain,input.version,input.version),
    db.prepare('INSERT INTO wdp_registration_audit(id,order_id,domain,actor_id,before_json,after_json) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM wdp_domain_registrations WHERE revision_id=?)').bind(revision,input.orderId,input.domain,actorId,JSON.stringify(before),JSON.stringify(input),revision),
    db.prepare("UPDATE wdp_orders SET fulfilment_status=CASE WHEN NOT EXISTS(SELECT 1 FROM json_each(wdp_orders.cart_json,'$.domains') d LEFT JOIN wdp_domain_registrations r ON r.order_id=wdp_orders.id AND r.domain=json_extract(d.value,'$.domain') WHERE COALESCE(r.status,'pending')!='registered') THEN CASE WHEN mode='test' THEN 'test_domains_recorded' ELSE 'domains_registered' END ELSE CASE WHEN mode='test' THEN 'test_registration_pending' ELSE 'awaiting_registration' END END WHERE id=? AND EXISTS(SELECT 1 FROM wdp_domain_registrations WHERE revision_id=?)").bind(input.orderId,revision)
  ]);
  const saved=await db.prepare('SELECT * FROM wdp_domain_registrations WHERE order_id=? AND domain=?').bind(input.orderId,input.domain).first<RegistrationRow>();
  if(saved?.revision_id!==revision)throw new AccountError(409,'This record changed. Refresh the queue before saving again.');
  return saved;
}
export function queueItem(order:OrderRow,item:any,registration:RegistrationRow|undefined){
  const billing=JSON.parse(order.billing_json);
  return {orderId:order.id,reference:orderReference(order),mode:order.mode,domain:item.domain,years:item.years??1,cents:item.cents,paidAt:order.paid_at,customer:{name:`${billing.firstName} ${billing.lastName}`,email:billing.email},registrant:JSON.parse(order.registrant_json),status:registration?.status??'pending',registeredOn:registration?.registered_on??'',expiresOn:registration?.expires_on??'',providerReference:registration?.provider_reference??'',notes:registration?.notes??'',version:registration?.version??0,updatedAt:registration?.updated_at??null};
}
