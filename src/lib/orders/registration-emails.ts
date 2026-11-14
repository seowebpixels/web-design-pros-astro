import type {AccountEnv} from '../accounts/auth';
import {orderReference,type OrderRow} from './core';
import {hash} from '../payments/core';
import {consolidatedInvoice} from './invoices';
import {invoiceAttachment} from './invoice-pdf';

type RecordedDomain={domain:string;status:string;registeredOn:string|null;expiresOn:string|null};
type Delivery={order_id:string;domain:string;payload_json:string;attempts:number;first_attempt_at:number|null};
type BatchOrder=OrderRow&{registrations:RecordedDomain[]};
function enabled(env:AccountEnv,mode:string){return env.WDP_REGISTRATION_EMAIL_ENABLED==='true'&&(mode==='live'||env.WDP_REGISTRATION_TEST_EMAILS_ENABLED==='true');}
const date=(value:string)=>new Intl.DateTimeFormat('en-ZA',{dateStyle:'long',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z'));
// Scope by verified customer ID, with sandbox and live records kept separate.
const allClientRegistered=(customer:string,mode:string)=>`NOT EXISTS(SELECT 1 FROM wdp_orders o,json_each(o.cart_json,'$.domains') d LEFT JOIN wdp_domain_registrations r ON r.order_id=o.id AND r.domain=json_extract(d.value,'$.domain') WHERE o.customer_id=${customer} AND o.mode=${mode} AND o.payment_status='paid' AND COALESCE(r.status,'pending')!='registered')`;
const covered=(order:string,exclude='NULL')=>`EXISTS(SELECT 1 FROM wdp_registration_emails e WHERE e.order_id!=COALESCE(${exclude},'') AND (e.order_id=${order}.id OR (json_extract(e.payload_json,'$.scope')='client' AND EXISTS(SELECT 1 FROM json_each(e.payload_json,'$.orders') member WHERE json_extract(member.value,'$.id')=${order}.id))))`;
// Snapshot only fields needed for the existing invoice and customer message.
// No access hashes, payment keys, internal notes or registrar references.
const batchOrders=(customer:string,mode:string,exclude='NULL')=>`(SELECT json_group_array(json_object('id',o.id,'mode',o.mode,'sequence',o.sequence,'payment_status',o.payment_status,'cart_json',o.cart_json,'billing_json',o.billing_json,'amount',o.amount,'currency',o.currency,'paid_at',o.paid_at,'created_at',o.created_at,'registrations',json((SELECT json_group_array(json_object('domain',r.domain,'status',r.status,'registeredOn',r.registered_on,'expiresOn',r.expires_on)) FROM json_each(o.cart_json,'$.domains') d JOIN wdp_domain_registrations r ON r.order_id=o.id AND r.domain=json_extract(d.value,'$.domain'))))) FROM wdp_orders o WHERE o.customer_id=${customer} AND o.mode=${mode} AND o.payment_status='paid' AND NOT ${covered('o',exclude)})`;
export function registrationMessage(orders:BatchOrder[],base:string){
  const test=orders[0].mode==='test',references=orders.map(orderReference).join(', ');
  return {subject:test?`TEST registration confirmation: ${references}`:'Your domain registrations are complete',text:[test?'TEST EMAIL — no domain has been registered.':'Your domain registrations are complete.','',...orders.flatMap(order=>[`WDP order reference: ${orderReference(order)}`,...order.registrations.flatMap(item=>[`Domain: ${item.domain}`,`${test?'Sample registration date':'Registration date'}: ${date(item.registeredOn!)}`,`${test?'Sample expiry date':'Expiry date'}: ${date(item.expiresOn!)}`,''])]),test?'This email confirms practice records only. No domain was purchased or registered through this test.':'You can view your domain details in your WDP account.',`${base}/dashboard/domains/?mode=${orders[0].mode}`,'','Your consolidated invoice is attached as a PDF.','','Need a hand? Contact WDP:',`${base}/contact/`,'','Web Design Pros'].join('\n')};
}
export async function registrationEmailStatement(env:AccountEnv,order:OrderRow,record:RecordedDomain,revision:string){
  if(record.status!=='registered'||!enabled(env,order.mode))return null;
  if(!env.RESEND_API_KEY||!env.AUTH_FROM_EMAIL||!env.AUTH_BASE_URL||new URL(env.AUTH_BASE_URL).protocol!=='https:')throw new Error('Registration email is not configured.');
  const customer=await env.DB!.prepare('SELECT email,emailVerified FROM wdp_auth_users WHERE id=?').bind(order.customer_id).first<{email:string;emailVerified:number}>();
  if(!customer?.emailVerified||!customer.email)throw new Error('Verified customer email missing.');
  const envelope={scope:'client',customerId:order.customer_id,mode:order.mode,base:new URL(env.AUTH_BASE_URL).origin,email:{from:env.AUTH_FROM_EMAIL,to:[customer.email]}};
  // The final registration, complete-client check, invoice snapshots and batch
  // ownership commit atomically. An existing batch owns ALL its order IDs.
  return env.DB!.prepare(`INSERT OR IGNORE INTO wdp_registration_emails(order_id,domain,payload_json)
    SELECT anchor.id,json_extract(anchor.cart_json,'$.domains[0].domain'),json_set(?, '$.orders',json(${batchOrders('?','?')}))
    FROM wdp_orders anchor WHERE anchor.customer_id=? AND anchor.mode=? AND anchor.payment_status='paid' AND NOT ${covered('anchor')}
    AND EXISTS(SELECT 1 FROM wdp_domain_registrations WHERE revision_id=?) AND ${allClientRegistered('?','?')}
    AND NOT EXISTS(SELECT 1 FROM wdp_registration_emails active WHERE json_extract(active.payload_json,'$.scope')='client' AND json_extract(active.payload_json,'$.customerId')=? AND json_extract(active.payload_json,'$.mode')=? AND active.status!='sent' AND active.first_attempt_at IS NULL)
    ORDER BY anchor.sequence LIMIT 1`).bind(JSON.stringify(envelope),order.customer_id,order.mode,order.customer_id,order.mode,revision,order.customer_id,order.mode,order.customer_id,order.mode);
}
const readyForRow=allClientRegistered("json_extract(wdp_registration_emails.payload_json,'$.customerId')","json_extract(wdp_registration_emails.payload_json,'$.mode')");
async function deliver(env:AccountEnv,row:Delivery,rechecked=false){
  const db=env.DB!,now=Date.now(),lease=crypto.randomUUID();
  const claimed=await db.prepare(`UPDATE wdp_registration_emails SET status='sending',lease_token=?,lease_until=?,attempts=attempts+1 WHERE order_id=? AND domain=? AND status!='sent' AND lease_until<=? AND next_attempt_at<=? AND COALESCE(last_error,'')!='manual_review' AND json_extract(payload_json,'$.scope')='client' AND ${readyForRow}`).bind(lease,now+180000,row.order_id,row.domain,now,now).run();
  if(!claimed.meta.changes)return false;
  try{
    // Until the first Resend attempt, fold in any newly completed purchases for
    // this client. Already sent or possibly sent messages must stay immutable.
    await db.prepare(`UPDATE wdp_registration_emails SET payload_json=json_set(payload_json,'$.orders',json(${batchOrders("json_extract(wdp_registration_emails.payload_json,'$.customerId')","json_extract(wdp_registration_emails.payload_json,'$.mode')",'wdp_registration_emails.order_id')})) WHERE order_id=? AND domain=? AND lease_token=? AND first_attempt_at IS NULL AND ${readyForRow}`).bind(row.order_id,row.domain,lease).run();
    const fresh=await db.prepare('SELECT * FROM wdp_registration_emails WHERE order_id=? AND domain=? AND lease_token=?').bind(row.order_id,row.domain,lease).first<Delivery>();if(!fresh)return false;row=fresh;
    if(row.first_attempt_at!==null&&now-row.first_attempt_at>23*60*60*1000)throw new Error('manual_review');
    if(!env.RESEND_API_KEY)throw new Error('configuration');
    const envelope=JSON.parse(row.payload_json),payload=envelope.email;
    if(row.first_attempt_at===null){
      if(!envelope.orders?.length)throw new Error('invalid_response');
      Object.assign(payload,registrationMessage(envelope.orders,envelope.base));
      const key=await hash(JSON.stringify(envelope.orders.map((order:BatchOrder)=>[order.id,order.amount,order.cart_json,order.billing_json]).sort()));
      if(envelope.invoiceKey!==key||!envelope.invoice||payload.attachments?.length!==1){
        const invoice=consolidatedInvoice(envelope.orders,(fresh as Delivery&{created_at:string}).created_at);
        payload.attachments=[await invoiceAttachment(env,invoice)];
        envelope.invoice=invoice;envelope.invoiceKey=key;envelope.invoiceFormat='consolidated-v1';
      }
      // Persist the one invoice with the exact send request. If more purchases
      // join before sending, the key changes and the combined PDF is regenerated.
      const partial=JSON.stringify(envelope);if(new TextEncoder().encode(partial).length>1800000)throw new Error('pdf_size');
      const saved=await db.prepare('UPDATE wdp_registration_emails SET payload_json=? WHERE order_id=? AND domain=? AND lease_token=? AND first_attempt_at IS NULL AND lease_until>?').bind(partial,row.order_id,row.domain,lease,Date.now()).run();if(!saved.meta.changes)return false;
    }
    const frozen=JSON.stringify(payload),storedEnvelope=JSON.stringify(envelope);
    const stored=await db.prepare(`UPDATE wdp_registration_emails SET payload_json=?,first_attempt_at=COALESCE(first_attempt_at,?) WHERE order_id=? AND domain=? AND lease_token=? AND lease_until>? AND ${readyForRow}
      AND NOT EXISTS(SELECT 1 FROM wdp_orders o WHERE o.customer_id=json_extract(wdp_registration_emails.payload_json,'$.customerId') AND o.mode=json_extract(wdp_registration_emails.payload_json,'$.mode') AND o.payment_status='paid' AND NOT ${covered('o')})`).bind(storedEnvelope,Date.now(),row.order_id,row.domain,lease,Date.now()).run();
    if(!stored.meta.changes)throw new Error('waiting_for_client');
    const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`wdp-registration/${await hash('client/'+row.order_id)}`},body:frozen,signal:AbortSignal.timeout(8000)});
    if(!response.ok)throw new Error(`http_${response.status}`);
    const data=await response.json() as {id?:string};if(!data.id)throw new Error('invalid_response');
    await db.prepare("UPDATE wdp_registration_emails SET status='sent',provider_id=?,sent_at=CURRENT_TIMESTAMP,last_error=NULL,lease_token=NULL,lease_until=0 WHERE order_id=? AND domain=? AND lease_token=?").bind(data.id,row.order_id,row.domain,lease).run();return true;
  }catch(error){
    const reason=error instanceof Error&&/^(http_\d{3}|configuration|invalid_response|manual_review|pdf_configuration|pdf_asset|pdf_template|pdf_render|pdf_size|waiting_for_client)$/.test(error.message)?error.message:'delivery_uncertain';
    await db.prepare("UPDATE wdp_registration_emails SET status='pending',next_attempt_at=?,last_error=?,lease_token=NULL,lease_until=0 WHERE order_id=? AND domain=? AND lease_token=?").bind(reason==='waiting_for_client'?0:Date.now()+60000,reason,row.order_id,row.domain,lease).run();
    if(reason==='waiting_for_client'&&!rechecked){
      const ready=await db.prepare(`SELECT order_id FROM wdp_registration_emails WHERE order_id=? AND domain=? AND first_attempt_at IS NULL AND ${readyForRow}`).bind(row.order_id,row.domain).first();
      if(ready)return deliver(env,row,true);
    }
    return false;
  }
}
export async function deliverRegistrationEmails(env:AccountEnv,orderId?:string){
  if(env.WDP_REGISTRATION_EMAIL_ENABLED!=='true'||!env.DB)return true;
  const now=Date.now();
  // Old per-domain/order messages stay untouched for audit/manual review.
  const rows=await env.DB.prepare(`SELECT e.* FROM wdp_registration_emails e JOIN wdp_orders anchor ON anchor.id=e.order_id WHERE e.status!='sent' AND anchor.payment_status='paid' AND json_extract(e.payload_json,'$.scope')='client' AND ${allClientRegistered('anchor.customer_id','anchor.mode')} AND e.next_attempt_at<=? AND e.lease_until<=? AND COALESCE(e.last_error,'')!='manual_review'`+(env.WDP_REGISTRATION_TEST_EMAILS_ENABLED==='true'?'':" AND anchor.mode='live'")+(orderId?' AND EXISTS(SELECT 1 FROM wdp_orders requested WHERE requested.id=? AND requested.customer_id=anchor.customer_id AND requested.mode=anchor.mode)':'')+' ORDER BY e.created_at LIMIT 20').bind(now,now,...(orderId?[orderId]:[])).all<Delivery>();
  const results=await Promise.allSettled(rows.results.map(row=>deliver(env,row)));
  return results.every(result=>result.status==='fulfilled'&&result.value);
}
