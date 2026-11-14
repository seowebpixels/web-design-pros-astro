import type {AccountEnv} from '../accounts/auth';
import {orderReference,type OrderRow} from './core';
import {hash} from '../payments/core';
import {invoiceDetail} from './invoices';
import {invoiceAttachment} from './invoice-pdf';

type RecordedDomain={domain:string;status:string;registeredOn:string|null;expiresOn:string|null};
type Delivery={order_id:string;domain:string;payload_json:string;attempts:number;first_attempt_at:number|null};
function enabled(env:AccountEnv,mode:string){return env.WDP_REGISTRATION_EMAIL_ENABLED==='true'&&(mode==='live'||env.WDP_REGISTRATION_TEST_EMAILS_ENABLED==='true');}
const date=(value:string)=>new Intl.DateTimeFormat('en-ZA',{dateStyle:'long',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z'));
// Evaluate this against committed transaction state, including every purchased domain.
const allRegistered=(orderId:string)=>`NOT EXISTS(SELECT 1 FROM wdp_orders o,json_each(o.cart_json,'$.domains') d LEFT JOIN wdp_domain_registrations r ON r.order_id=o.id AND r.domain=json_extract(d.value,'$.domain') WHERE o.id=${orderId} AND COALESCE(r.status,'pending')!='registered')`;
export function registrationMessage(order:Pick<OrderRow,'mode'|'sequence'>,record:RecordedDomain|RecordedDomain[],base:string){
  const records=Array.isArray(record)?record:[record],test=order.mode==='test',reference=orderReference(order),plural=records.length>1;
  const subject=test?`TEST registration confirmation: ${reference}`:`Your ${plural?'domains are':'domain is'} registered: ${reference}`;
  return {subject,text:[test?'TEST EMAIL — no domain has been registered.':`Your domain ${plural?'registrations are':'registration is'} complete.`,'',`WDP order reference: ${reference}`,'',...records.flatMap(item=>[`Domain: ${item.domain}`,`${test?'Sample registration date':'Registration date'}: ${date(item.registeredOn!)}`,`${test?'Sample expiry date':'Expiry date'}: ${date(item.expiresOn!)}`,'']),test?'This email confirms a practice record only. No domain was purchased or registered through this test.':'You can view your domain details in your WDP account.',`${base}/dashboard/domains/?mode=${order.mode}`,'','Need a hand? Contact WDP:',`${base}/contact/`,'','Web Design Pros'].join('\n')};
}
// One canonical key per order (its first domain), using the existing queue table.
// All-domains and revision checks run INSIDE the registration transaction. This
// also works when different domains are saved concurrently. Existing historical
// per-domain notifications block another email for that order after deployment.
export async function registrationEmailStatement(env:AccountEnv,order:OrderRow,record:RecordedDomain,revision:string){
  if(record.status!=='registered'||!enabled(env,order.mode))return null;
  if(!env.RESEND_API_KEY||!env.AUTH_FROM_EMAIL||!env.AUTH_BASE_URL||new URL(env.AUTH_BASE_URL).protocol!=='https:')throw new Error('Registration email is not configured.');
  const customer=await env.DB!.prepare('SELECT email,emailVerified FROM wdp_auth_users WHERE id=?').bind(order.customer_id).first<{email:string;emailVerified:number}>();
  if(!customer?.emailVerified||!customer.email)throw new Error('Verified customer email missing.');
  const payload={scope:'order',order:{mode:order.mode,sequence:order.sequence},base:new URL(env.AUTH_BASE_URL).origin,email:{from:env.AUTH_FROM_EMAIL,to:[customer.email],_invoice:invoiceDetail(order)}};
  const firstDomain=JSON.parse(order.cart_json).domains[0].domain;
  return env.DB!.prepare(`INSERT OR IGNORE INTO wdp_registration_emails(order_id,domain,payload_json) SELECT ?,?,json_set(?, '$.registrations', json((SELECT json_group_array(json_object('domain',r.domain,'status',r.status,'registeredOn',r.registered_on,'expiresOn',r.expires_on)) FROM wdp_orders o,json_each(o.cart_json,'$.domains') d JOIN wdp_domain_registrations r ON r.order_id=o.id AND r.domain=json_extract(d.value,'$.domain') WHERE o.id=?))) WHERE EXISTS(SELECT 1 FROM wdp_domain_registrations WHERE revision_id=?) AND ${allRegistered('?')} AND NOT EXISTS(SELECT 1 FROM wdp_registration_emails WHERE order_id=?)`).bind(order.id,firstDomain,JSON.stringify(payload),order.id,revision,order.id,order.id);
}
async function deliver(env:AccountEnv,row:Delivery){
  const db=env.DB!,now=Date.now(),lease=crypto.randomUUID();
  const claimed=await db.prepare(`UPDATE wdp_registration_emails SET status='sending',lease_token=?,lease_until=?,attempts=attempts+1 WHERE order_id=? AND domain=? AND status!='sent' AND lease_until<=? AND next_attempt_at<=? AND COALESCE(last_error,'')!='manual_review' AND json_extract(payload_json,'$.scope')='order' AND ${allRegistered('wdp_registration_emails.order_id')}`).bind(lease,now+60000,row.order_id,row.domain,now,now).run();
  if(!claimed.meta.changes)return false;
  try{
    // A competing delivery may have frozen a PDF after this worker selected rows.
    const fresh=await db.prepare('SELECT * FROM wdp_registration_emails WHERE order_id=? AND domain=? AND lease_token=?').bind(row.order_id,row.domain,lease).first<Delivery>();if(!fresh)return false;row=fresh;
    if(row.first_attempt_at!==null&&now-row.first_attempt_at>23*60*60*1000)throw new Error('manual_review');
    if(!env.RESEND_API_KEY)throw new Error('configuration');
    const envelope=JSON.parse(row.payload_json),payload=envelope.email;
    if(!payload.subject)Object.assign(payload,registrationMessage(envelope.order,envelope.registrations,envelope.base));
    if(payload._invoice){
      payload.attachments=[await invoiceAttachment(env,payload._invoice)];
      delete payload._invoice;
      payload.text+='\n\nYour invoice is attached as a PDF.';
    }
    // Freeze the full Resend request before sending. Retries reuse exactly the
    // same PDF bytes and idempotency key, even after a deploy or invoice edit.
    const frozen=JSON.stringify(payload),storedEnvelope=JSON.stringify(envelope);
    const stored=await db.prepare(`UPDATE wdp_registration_emails SET payload_json=?,first_attempt_at=COALESCE(first_attempt_at,?) WHERE order_id=? AND domain=? AND lease_token=? AND lease_until>? AND ${allRegistered('wdp_registration_emails.order_id')}`).bind(storedEnvelope,Date.now(),row.order_id,row.domain,lease,Date.now()).run();
    if(!stored.meta.changes)return false;
    const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`wdp-registration/${await hash('order/'+row.order_id)}`},body:frozen,signal:AbortSignal.timeout(8000)});
    if(!response.ok)throw new Error(`http_${response.status}`);
    const data=await response.json() as {id?:string};if(!data.id)throw new Error('invalid_response');
    await db.prepare("UPDATE wdp_registration_emails SET status='sent',provider_id=?,sent_at=CURRENT_TIMESTAMP,last_error=NULL,lease_token=NULL,lease_until=0 WHERE order_id=? AND domain=? AND lease_token=?").bind(data.id,row.order_id,row.domain,lease).run();return true;
  }catch(error){
    const reason=error instanceof Error&&/^(http_\d{3}|configuration|invalid_response|manual_review|pdf_configuration|pdf_asset|pdf_template|pdf_render|pdf_size)$/.test(error.message)?error.message:'delivery_uncertain';
    await db.prepare("UPDATE wdp_registration_emails SET status='pending',next_attempt_at=?,last_error=?,lease_token=NULL,lease_until=0 WHERE order_id=? AND domain=? AND lease_token=?").bind(Date.now()+60000,reason,row.order_id,row.domain,lease).run();return false;
  }
}
export async function deliverRegistrationEmails(env:AccountEnv,orderId?:string){
  if(env.WDP_REGISTRATION_EMAIL_ENABLED!=='true'||!env.DB)return true;
  const now=Date.now();
  // Historical per-domain rows are retained for audit but never sent by this
  // order-level sender. Never rewrite an uncertain old request/idempotency key.
  const rows=await env.DB.prepare(`SELECT e.* FROM wdp_registration_emails e JOIN wdp_orders o ON o.id=e.order_id WHERE e.status!='sent' AND o.payment_status='paid' AND json_extract(e.payload_json,'$.scope')='order' AND ${allRegistered('e.order_id')} AND e.next_attempt_at<=? AND e.lease_until<=? AND COALESCE(e.last_error,'')!='manual_review'`+(env.WDP_REGISTRATION_TEST_EMAILS_ENABLED==='true'?'':" AND o.mode='live'")+(orderId?' AND e.order_id=?':'')+' ORDER BY e.created_at LIMIT 20').bind(now,now,...(orderId?[orderId]:[])).all<Delivery>();
  const results=await Promise.allSettled(rows.results.map(row=>deliver(env,row)));
  return results.every(result=>result.status==='fulfilled'&&result.value);
}
