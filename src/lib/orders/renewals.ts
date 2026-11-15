import {AccountError,type AccountEnv} from '../accounts/auth';
import {priceForHostname,renewalPriceCents,validYears} from '../domains/catalogue';
import {validDate,type RegistrationRow} from './registrations';
import {orderReference,type OrderRow} from './core';
import {uuid} from '../payments/core';

export interface RenewalEnv extends AccountEnv {WDP_RENEWALS_ENABLED?:string;WDP_RENEWAL_EMAIL_ENABLED?:string;WDP_RENEWAL_TEST_EMAILS_ENABLED?:string}
export const isRenewal=(order:Pick<OrderRow,'cart_json'>)=>JSON.parse(order.cart_json).kind==='renewal';
export function todayZA(now=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Johannesburg',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
export function extendExpiry(date:string,years:number){
 if(!validDate(date)||!validYears(years))throw new AccountError(400,'Check the renewal date and period.');
 const [y,m,d]=date.split('-').map(Number),last=new Date(Date.UTC(y+years,m,0)).getUTCDate();
 const result=`${y+years}-${String(m).padStart(2,'0')}-${String(Math.min(d,last)).padStart(2,'0')}`;
 if(!validDate(result))throw new AccountError(400,'Renewal date is outside the supported range.');return result;
}
export function renewalState(record:Pick<RegistrationRow,'status'|'expires_on'>,now=new Date()){
 if(record.status!=='registered'||!record.expires_on||!validDate(record.expires_on))return {state:'unavailable',days:null};
 const days=Math.round((Date.parse(record.expires_on+'T00:00:00Z')-Date.parse(todayZA(now)+'T00:00:00Z'))/86400000);
 return {state:days<=0?'expired':days<=30?'due':'active',days};
}
export function requireRenewals(env:RenewalEnv){if(env.WDP_RENEWALS_ENABLED!=='true'||!env.DB)throw new AccountError(503,'Domain renewals are not enabled yet.');return env.DB;}
export async function renewalQuote(env:RenewalEnv,customerId:string,input:any){
 const db=requireRenewals(env);
 if(!uuid(input?.sourceOrderId)||typeof input.domain!=='string'||!validYears(input.years)||input.termsAccepted!==true)throw new AccountError(400,'Choose a domain, renewal period and accept the terms.');
 const order=await db.prepare("SELECT * FROM wdp_orders WHERE id=? AND customer_id=? AND payment_status='paid'").bind(input.sourceOrderId,customerId).first<OrderRow>();
 const domain=input.domain.toLowerCase();
 if(!order||order.mode!=='test'||isRenewal(order)||!JSON.parse(order.cart_json).domains.some((item:any)=>item.domain===domain))throw new AccountError(404,'Domain purchase not found.');
 const record=await db.prepare('SELECT * FROM wdp_domain_registrations WHERE order_id=? AND domain=?').bind(order.id,domain).first<RegistrationRow>();
 if(!record||record.status!=='registered'||!record.expires_on||!validDate(record.expires_on))throw new AccountError(409,'Registration must be confirmed before this domain can be renewed.');
 if(record.expires_on!==input.expiresOn)throw new AccountError(409,'The expiry date changed. Refresh your domains before renewing.');
 if(renewalState(record).state==='expired')throw new AccountError(409,'Please contact WDP to confirm renewal availability and any expiry fees before paying.');
 const price=priceForHostname(domain);if(!price)throw new AccountError(409,'Please contact WDP for this domain renewal price.');
 const amount=renewalPriceCents(price,input.years);
 if(input.quotedAmount!==amount)throw new AccountError(409,'The renewal price changed. Refresh before paying.');
 const existing=await db.prepare("SELECT id,access_hash,cart_json FROM wdp_orders WHERE customer_id=? AND mode=? AND json_extract(cart_json,'$.kind')='renewal' AND json_extract(cart_json,'$.renewal.sourceOrderId')=? AND json_extract(cart_json,'$.renewal.domain')=? AND json_extract(cart_json,'$.renewal.expiresOn')=?").bind(customerId,order.mode,order.id,domain,record.expires_on).first<{id:string;access_hash:string;cart_json:string}>();
 if(existing&&existing.id!==input.attemptId)throw new AccountError(409,'A renewal already exists for this expiry date. Check your renewal order or contact WDP before paying again.');
 const cart=JSON.stringify({kind:'renewal',domains:[{domain,cents:amount,years:input.years}],hosting:false,renewal:{sourceOrderId:order.id,domain,expiresOn:record.expires_on,expectedExpiresOn:extendExpiry(record.expires_on,input.years)}});
 return {amount,cart,registrant:JSON.parse(order.registrant_json)};
}
export async function confirmRenewal(env:RenewalEnv,actor:string,input:any){
 const db=requireRenewals(env);
 if(!uuid(input?.orderId)||!Number.isSafeInteger(input.version)||input.version<1||input.confirmed!==true||!validDate(input.expiresOn)||typeof input.providerReference!=='string'||!input.providerReference.trim()||input.providerReference.length>120||/[\u0000-\u001f]/.test(input.providerReference))throw new AccountError(400,'Confirm the renewal, reference and actual expiry date.');
 const order=await db.prepare("SELECT * FROM wdp_orders WHERE id=? AND payment_status='paid'").bind(input.orderId).first<OrderRow>();
 if(!order||!isRenewal(order))throw new AccountError(404,'Paid renewal not found.');
 if(order.fulfilment_status==='renewal_complete')return {saved:true};
 const cart=JSON.parse(order.cart_json),link=cart.renewal;
 const source=await db.prepare("SELECT * FROM wdp_orders WHERE id=? AND customer_id=? AND mode=? AND payment_status='paid'").bind(link.sourceOrderId,order.customer_id,order.mode).first<OrderRow>();
 if(!source||isRenewal(source))throw new AccountError(409,'Original domain purchase could not be verified.');
 const before=await db.prepare('SELECT * FROM wdp_domain_registrations WHERE order_id=? AND domain=?').bind(source.id,link.domain).first<RegistrationRow>();
 if(!before||before.status!=='registered'||before.version!==input.version||before.expires_on!==link.expiresOn)throw new AccountError(409,'The domain changed. Refresh the renewal queue.');
 if(input.expiresOn!==link.expectedExpiresOn)throw new AccountError(400,'The expiry date must match the paid renewal period. Contact WDP support to resolve a registrar discrepancy.');
 const revision=crypto.randomUUID();
 await db.batch([
  db.prepare("UPDATE wdp_domain_registrations SET expires_on=?,provider_reference=?,updated_by=?,version=version+1,revision_id=?,updated_at=CURRENT_TIMESTAMP WHERE order_id=? AND domain=? AND version=? AND expires_on=?").bind(input.expiresOn,input.providerReference.trim(),actor,revision,source.id,link.domain,before.version,link.expiresOn),
  db.prepare('INSERT INTO wdp_registration_audit(id,order_id,domain,actor_id,before_json,after_json) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM wdp_domain_registrations WHERE revision_id=?)').bind(revision,source.id,link.domain,actor,JSON.stringify(before),JSON.stringify({renewalOrderId:order.id,expiresOn:input.expiresOn,providerReference:input.providerReference.trim()}),revision),
  db.prepare("UPDATE wdp_orders SET fulfilment_status='renewal_complete' WHERE id=? AND EXISTS(SELECT 1 FROM wdp_domain_registrations WHERE revision_id=?)").bind(order.id,revision),
  db.prepare("INSERT OR IGNORE INTO wdp_renewal_mail(id,customer_id,mode,payload_json) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM wdp_domain_registrations WHERE revision_id=?)").bind('confirmation/'+order.id,order.customer_id,order.mode,JSON.stringify({kind:'confirmation',orderId:order.id,domain:link.domain,expiresOn:input.expiresOn}),revision)
 ]);
 const saved=await db.prepare('SELECT revision_id FROM wdp_domain_registrations WHERE order_id=? AND domain=?').bind(source.id,link.domain).first<{revision_id:string}>();
 if(saved?.revision_id!==revision)throw new AccountError(409,'The domain changed. Refresh the renewal queue.');return {saved:true};
}

export async function queueRenewalReminders(env:RenewalEnv){
 const db=requireRenewals(env);if(env.WDP_RENEWAL_EMAIL_ENABLED!=='true')return 0;
 const rows=await db.prepare(`SELECT r.*,o.customer_id,o.mode FROM wdp_domain_registrations r JOIN wdp_orders o ON o.id=r.order_id WHERE r.status='registered' AND o.payment_status='paid' AND COALESCE(json_extract(o.cart_json,'$.kind'),'registration')!='renewal' AND r.expires_on>? AND r.expires_on<=date(?,'+30 days') AND NOT EXISTS(SELECT 1 FROM wdp_orders pending WHERE pending.customer_id=o.customer_id AND pending.mode=o.mode AND json_extract(pending.cart_json,'$.kind')='renewal' AND json_extract(pending.cart_json,'$.renewal.sourceOrderId')=o.id AND json_extract(pending.cart_json,'$.renewal.domain')=r.domain AND json_extract(pending.cart_json,'$.renewal.expiresOn')=r.expires_on AND pending.payment_status='paid')`).bind(todayZA(),todayZA()).all<RegistrationRow&{customer_id:string;mode:'test'|'live'}>();
 let count=0;
 for(const row of rows.results){
  if(row.mode==='test'&&env.WDP_RENEWAL_TEST_EMAILS_ENABLED!=='true')continue;
  const days=renewalState(row).days!,stage=days<=1?1:days<=7?7:30;
  const result=await db.prepare('INSERT OR IGNORE INTO wdp_renewal_mail(id,customer_id,mode,payload_json) VALUES (?,?,?,?)').bind(`reminder/${row.order_id}/${row.domain}/${row.expires_on}/${stage}`,row.customer_id,row.mode,JSON.stringify({kind:'reminder',sourceOrderId:row.order_id,domain:row.domain,expiresOn:row.expires_on,stage})).run();count+=result.meta.changes;
 }return count;
}
export async function deliverRenewalMail(env:RenewalEnv){
 if(env.WDP_RENEWALS_ENABLED!=='true'||env.WDP_RENEWAL_EMAIL_ENABLED!=='true'||!env.DB)return {sent:0,pending:0};
 const db=env.DB,now=Date.now();
 const rows=await db.prepare("SELECT * FROM wdp_renewal_mail WHERE status!='sent' AND status!='skipped' AND lease_until<=? AND next_attempt_at<=? AND COALESCE(last_error,'')!='manual_review'"+(env.WDP_RENEWAL_TEST_EMAILS_ENABLED==='true'?'':" AND mode='live'")+" ORDER BY id LIMIT 20").bind(now,now).all<any>();
 let sent=0,pending=0;
 for(const row of rows.results){
  const lease=crypto.randomUUID(),claim=await db.prepare("UPDATE wdp_renewal_mail SET status='sending',lease_token=?,lease_until=?,attempts=attempts+1 WHERE id=? AND status NOT IN ('sent','skipped') AND lease_until<=?").bind(lease,Date.now()+180000,row.id,Date.now()).run();if(!claim.meta.changes)continue;
  try{
   if(row.first_attempt_at!==null&&Date.now()-row.first_attempt_at>23*3600000)throw new Error('manual_review');
   if(!env.AUTH_BASE_URL||!env.RESEND_API_KEY||!env.AUTH_FROM_EMAIL)throw new Error('configuration');
   const base=new URL(env.AUTH_BASE_URL);if(base.protocol!=='https:'||base.origin!==env.AUTH_BASE_URL)throw new Error('configuration');
   const payload=JSON.parse(row.payload_json);
   const user=await db.prepare('SELECT email,emailVerified FROM wdp_auth_users WHERE id=?').bind(row.customer_id).first<{email:string;emailVerified:number}>();if(!user?.emailVerified)throw new Error('configuration');
   if(payload.kind==='reminder'){
    const registration=await db.prepare('SELECT * FROM wdp_domain_registrations WHERE order_id=? AND domain=?').bind(payload.sourceOrderId,payload.domain).first<RegistrationRow>();
    const paid=await db.prepare("SELECT id FROM wdp_orders WHERE customer_id=? AND mode=? AND payment_status='paid' AND json_extract(cart_json,'$.renewal.sourceOrderId')=? AND json_extract(cart_json,'$.renewal.domain')=? AND json_extract(cart_json,'$.renewal.expiresOn')=?").bind(row.customer_id,row.mode,payload.sourceOrderId,payload.domain,payload.expiresOn).first();
    if(!registration||registration.status!=='registered'||registration.expires_on!==payload.expiresOn||renewalState(registration).state==='expired'||paid){await db.prepare("UPDATE wdp_renewal_mail SET status='skipped',lease_until=0,lease_token=NULL WHERE id=? AND lease_token=?").bind(row.id,lease).run();continue;}
   }
   if(!payload.email){
    const test=row.mode==='test',subject=`${test?'TEST · ':''}${payload.kind==='reminder'?'Domain renewal reminder':'Domain renewal confirmed'}: ${payload.domain}`;
    const text=[test?'TEST EMAIL — practice records only. No domain has been renewed.':'',payload.kind==='reminder'?`Your domain ${payload.domain} expires on ${payload.expiresOn}. Sign in to review renewal options.`:`Your domain ${payload.domain} has been renewed. The recorded expiry date is ${payload.expiresOn}.`,`${base.origin}/dashboard/domains/?mode=${row.mode}`,'','Need a hand? info@webdesignpros.co.za','Web Design Pros (Pty) Ltd'].filter(Boolean).join('\n\n');
    payload.email={from:env.AUTH_FROM_EMAIL,to:[user.email],subject,text};
    if(payload.kind==='confirmation'){
     const order=await db.prepare("SELECT * FROM wdp_orders WHERE id=? AND customer_id=? AND mode=? AND payment_status='paid' AND fulfilment_status='renewal_complete'").bind(payload.orderId,row.customer_id,row.mode).first<OrderRow>();if(!order)throw new Error('configuration');
     const {invoiceDetail}=await import('./invoices'),{invoiceAttachment}=await import('./invoice-pdf');
     payload.email.attachments=[await invoiceAttachment(env,invoiceDetail(order))];payload.email.text+=`\n\nWDP reference: ${orderReference(order)}\nYour invoice is attached.`;
    }
   }
   await db.prepare('UPDATE wdp_renewal_mail SET payload_json=?,first_attempt_at=COALESCE(first_attempt_at,?) WHERE id=? AND lease_token=?').bind(JSON.stringify(payload),Date.now(),row.id,lease).run();
   const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':'wdp-renewal/'+row.id},body:JSON.stringify(payload.email),signal:AbortSignal.timeout(10000),redirect:'manual'});
   if(!response.ok)throw new Error('delivery_uncertain');const data=await response.json() as any;if(!data.id)throw new Error('delivery_uncertain');
   await db.prepare("UPDATE wdp_renewal_mail SET status='sent',sent_at=CURRENT_TIMESTAMP,last_error=NULL,lease_until=0,lease_token=NULL WHERE id=? AND lease_token=?").bind(row.id,lease).run();sent++;
  }catch(error){const reason=error instanceof Error&&['configuration','manual_review'].includes(error.message)?error.message:'delivery_uncertain';await db.prepare("UPDATE wdp_renewal_mail SET status='pending',last_error=?,next_attempt_at=?,lease_until=0,lease_token=NULL WHERE id=? AND lease_token=?").bind(reason,Date.now()+60000,row.id,lease).run();pending++;}
 }return {sent,pending};
}
