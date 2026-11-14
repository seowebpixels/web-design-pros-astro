import {accountJson,accountFailure,AccountError,type AccountEnv} from '../../../src/lib/accounts/auth';
import {requireRegistrationAdmin,saveRegistration,queueItem,type RegistrationRow} from '../../../src/lib/orders/registrations';
import type {OrderRow} from '../../../src/lib/orders/core';
import {readBody} from '../../../src/lib/payments/core';
import {deliverRegistrationEmails} from '../../../src/lib/orders/registration-emails';
export const onRequestGet:PagesFunction<AccountEnv>=async context=>{
  try{
    await requireRegistrationAdmin(context.request,context.env,p=>context.waitUntil(p));
    const params=new URL(context.request.url).searchParams,mode=params.get('mode')??'test',status=params.get('status')??'pending',before=params.get('before');
    if(!['test','live'].includes(mode)||!['pending','registered','issue','all'].includes(status)||(before!==null&&(!/^\d{1,10}$/.test(before)||Number(before)<1)))throw new AccountError(400,'Invalid queue filter.');
    const filter=status==='all'?'':" AND EXISTS(SELECT 1 FROM json_each(o.cart_json,'$.domains') d LEFT JOIN wdp_domain_registrations r ON r.order_id=o.id AND r.domain=json_extract(d.value,'$.domain') WHERE COALESCE(r.status,'pending')=?)";
    const rows=await context.env.DB!.prepare("SELECT o.* FROM wdp_orders o WHERE o.payment_status='paid' AND o.mode=? AND o.sequence<?"+filter+' ORDER BY o.sequence DESC LIMIT 26').bind(mode,before?Number(before):Number.MAX_SAFE_INTEGER,...(status==='all'?[]:[status])).all<OrderRow>();
    const orders=rows.results.slice(0,25),items:any[]=[];
    for(const order of orders){
      const registrations=await context.env.DB!.prepare('SELECT * FROM wdp_domain_registrations WHERE order_id=?').bind(order.id).all<RegistrationRow>();
      for(const item of JSON.parse(order.cart_json).domains){const row=registrations.results.find(record=>record.domain===item.domain);if(status==='all'||(row?.status??'pending')===status)items.push(queueItem(order,item,row));}
    }
    return accountJson({items,nextBefore:rows.results.length>25?orders.at(-1)!.sequence:null});
  }catch(error){return accountFailure(error);}
};
export const onRequestPut:PagesFunction<AccountEnv>=async context=>{
  try{
    if(context.request.headers.get('origin')!==context.env.AUTH_BASE_URL)throw new AccountError(403,'Request not permitted.');
    if(!context.request.headers.get('content-type')?.includes('application/json'))throw new AccountError(415,'JSON required.');
    const session=await requireRegistrationAdmin(context.request,context.env,p=>context.waitUntil(p));
    let body;try{body=JSON.parse(await readBody(context.request,8000));}catch{throw new AccountError(400,'Please check the registration details.');}
    const registration=await saveRegistration(context.env,session.user.id,body);
    let emailStatus='off';
    if(registration.status==='registered'&&context.env.WDP_REGISTRATION_EMAIL_ENABLED==='true'){
      try{
        await deliverRegistrationEmails(context.env,registration.order_id);
        const email=await context.env.DB!.prepare("SELECT status,last_error,json_extract(payload_json,'$.scope') AS scope FROM wdp_registration_emails WHERE order_id=? ORDER BY CASE WHEN status='sent' THEN 0 ELSE 1 END LIMIT 1").bind(registration.order_id).first<{status:string;last_error:string|null;scope:string|null}>();
        emailStatus=!email?'waiting':email.status==='sent'?'sent':email.last_error==='manual_review'||email.scope!=='order'?'manual_review':email.status;
      }catch{emailStatus='pending';}
    }
    return accountJson({saved:true,version:registration.version,emailStatus});
  }catch(error){return accountFailure(error);}
};
