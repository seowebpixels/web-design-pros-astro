import {afterEach,describe,expect,it,vi} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createAuth} from '../../accounts/auth';
import {createPayment,paymentStatus,paymentWebhook} from '../../payments/handlers';
import {saveTestOrder,orderReference} from '../core';
import {deliverOrderAlerts} from '../alerts';
import {onRequestPost as retryAlerts} from '../../../../functions/api/internal/order-alerts';
import {onRequestGet as ordersEndpoint} from '../../../../functions/api/customer/orders';
import {onRequestGet as servicesEndpoint} from '../../../../functions/api/customer/services';
import {onRequestGet as queueEndpoint,onRequestPut as registrationEndpoint} from '../../../../functions/api/admin/registrations';
import {onRequestGet as domainsEndpoint} from '../../../../functions/api/customer/domains';
import {validDate} from '../registrations';
import {deliverRegistrationEmails,registrationMessage} from '../registration-emails';
import {onRequestGet as invoicesEndpoint} from '../../../../functions/api/customer/invoices';
import {invoiceDetail} from '../invoices';
import type {PaymentEnv} from '../../payments/core';

const signing='test-order-webhook-secret',secret='whsec_'+btoa(signing);
const profile={firstName:'Test',lastName:'Customer',phone:'0100000000',company:'',address:'Original street',city:'Test city',province:'Test province',postalCode:'0000',country:'South Africa'};
function database(sql:DatabaseSync){
  const prepare=(query:string,args:any[]=[]):any=>{
    const execute=()=>{const statement=sql.prepare(query);if(statement.columns().length)return{results:statement.all(...args),success:true,meta:{changes:0}};const result=statement.run(...args);return{results:[],success:true,meta:{changes:Number(result.changes)}};};
    return {bind:(...values:any[])=>prepare(query,values),execute,all:async()=>execute(),run:async()=>execute(),first:async()=>sql.prepare(query).get(...args)??null};
  };
  return {prepare,exec:async(query:string)=>sql.exec(query),dump:async()=>new ArrayBuffer(0),batch:async(statements:any[])=>{sql.exec('BEGIN');try{const values=statements.map(statement=>statement.execute());sql.exec('COMMIT');return values;}catch(error){sql.exec('ROLLBACK');throw error;}}} as unknown as D1Database;
}
function setup(){
  const sql=new DatabaseSync(':memory:'),payments=new DatabaseSync(':memory:');
  sql.exec(readFileSync('migrations/0002_customer_accounts.sql','utf8'));sql.exec(readFileSync('migrations/0003_customer_orders.sql','utf8'));sql.exec(readFileSync('migrations/0004_order_price_snapshots.sql','utf8'));
  sql.exec(readFileSync('migrations/0005_order_alerts.sql','utf8'));
  sql.exec(readFileSync('migrations/0006_domain_registration_queue.sql','utf8'));
  sql.exec(readFileSync('migrations/0007_registration_emails.sql','utf8'));
  payments.exec(readFileSync('migrations/0001_payment_tests.sql','utf8'));
  const env={DB:database(sql),WDP_PAYMENT_DB:database(payments),WDP_ACCOUNTS_ENABLED:'true',AUTH_SECRET:'test-only-account-secret-at-least-thirty-two-characters',AUTH_BASE_URL:'https://wdp.test',AUTH_FROM_EMAIL:'WDP <accounts@example.com>',RESEND_API_KEY:'test-only',WDP_PAYMENT_TEST_ENABLED:'true',YOCO_TEST_SECRET_KEY:'sk_test_only',YOCO_TEST_WEBHOOK_SECRET:secret} as PaymentEnv;
  const template=readFileSync('src/pages/dashboard/invoice.astro','utf8').replace(/^---[\s\S]*?---/, '').replace(/<img src=\{logo.src\}[^>]+>/,'<img src="/_astro/logo.avif" alt="Web Design Pros">');
  Object.assign(env,{WDP_PDF_ACCOUNT_ID:'a'.repeat(32),WDP_PDF_API_TOKEN:'test-pdf-token',ASSETS:{fetch:async(request:Request)=>new Response(new URL(request.url).pathname==='/dashboard/invoice/'?'<html><head><title>Invoice</title></head><body>'+template+'</body></html>':'image',{headers:{'content-type':'image/avif'}})}});
  const tasks:Promise<unknown>[]=[];const waitUntil=(task:Promise<unknown>)=>tasks.push(task),mail:any[]=[],checkouts:any[]=[];
  const provider=vi.spyOn(globalThis,'fetch').mockImplementation(async(url,options)=>{
    const body=JSON.parse(options!.body as string);
    if(String(url).startsWith('https://api.cloudflare.com/'))return new Response('%PDF-1.7\nmock invoice PDF',{headers:{'content-type':'application/pdf'}});
    if(String(url)==='https://api.resend.com/emails'){mail.push(body);return new Response('{"id":"email_test"}');}
    expect(String(url)).toBe('https://payments.yoco.com/api/checkouts');checkouts.push(body);
    return new Response(JSON.stringify({id:'checkout_'+body.externalId,processingMode:'test',redirectUrl:'https://c.yoco.com/checkout/test'}));
  });
  const auth=createAuth(env,waitUntil);
  async function customer(email='first@example.com'){
    const request=new Request('https://wdp.test/api/auth/sign-up/email',{method:'POST',headers:{Origin:'https://wdp.test','Content-Type':'application/json','cf-connecting-ip':email==='first@example.com'?'192.0.2.1':'192.0.2.2'},body:JSON.stringify({name:'Test Customer',email,password:'Test1234',callbackURL:'/checkout/'})});
    expect((await auth.handler(request)).status).toBe(200);await Promise.all(tasks);
    const link=mail.find(value=>value.to[0]===email).text.match(/https:\/\/\S+/)[0];
    const verified=await auth.handler(new Request(link));const cookie=verified.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
    const user=sql.prepare('SELECT id,email FROM wdp_auth_users WHERE email=?').get(email) as {id:string;email:string};
    sql.prepare('INSERT INTO wdp_customer_profiles(auth_user_id,profile_json) VALUES (?,?)').run(user.id,JSON.stringify(profile));
    return {user,cookie};
  }
  const input=(id=crypto.randomUUID())=>({attemptId:id,accessToken:crypto.randomUUID(),domains:['example.co.za'],hosting:true,quotedAmount:15500,termsAccepted:true,registrant:{sameAsBilling:true}});
  const request=(input:any,cookie:string)=>new Request('https://wdp.test/api/payments/create',{method:'POST',headers:{Cookie:cookie,Origin:'https://wdp.test','Content-Type':'application/json'},body:JSON.stringify(input)});
  const context=(request:Request)=>({request,env,waitUntil}) as any;
  async function webhook(input:any,status='succeeded',amount=15500){
    const raw=JSON.stringify({type:'payment.'+status,payload:{mode:'test',status,id:'payment_'+input.attemptId,currency:'ZAR',amount,metadata:{checkoutId:'checkout_'+input.attemptId}}});
    const timestamp=String(Math.floor(Date.now()/1000)),id='event_test';
    const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(signing),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    const signature=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${id}.${timestamp}.${raw}`));
    return paymentWebhook(context(new Request('https://wdp.test/api/payments/webhook',{method:'POST',headers:{'webhook-id':id,'webhook-timestamp':timestamp,'webhook-signature':'v1,'+btoa(String.fromCharCode(...new Uint8Array(signature)))},body:raw})));
  }
  return {env,sql,payments,customer,input,request,context,webhook,provider,checkouts};
}
afterEach(()=>vi.restoreAllMocks());
describe('customer test orders',()=>{
  it('creates a sequential reference, snapshots purchase details and reuses retries without advancing production',async()=>{
    const app=setup(),customer=await app.customer(),input=app.input();
    const first=await createPayment(app.context(app.request(input,customer.cookie)));expect(first.status).toBe(200);
    expect((await first.json()).reference).toBe('WDP-TEST-0000001');
    expect((await createPayment(app.context(app.request(input,customer.cookie)))).status).toBe(200);
    expect(app.checkouts).toHaveLength(1);expect(app.checkouts[0]).not.toHaveProperty('registrant');expect(app.checkouts[0]).not.toHaveProperty('billing');
    expect(app.sql.prepare('SELECT COUNT(*) AS n FROM wdp_orders').get()!.n).toBe(1);
    expect(app.sql.prepare("SELECT next_value FROM wdp_order_sequences WHERE mode='test'").get()!.next_value).toBe(2);
    expect(app.sql.prepare("SELECT next_value FROM wdp_order_sequences WHERE mode='live'").get()!.next_value).toBe(2412);
    const order=app.sql.prepare('SELECT * FROM wdp_orders').get()!;
    expect(JSON.parse(order.billing_json as string).address).toBe('Original street');expect(JSON.parse(order.registrant_json as string).email).toBe(customer.user.email);
    app.sql.prepare('UPDATE wdp_customer_profiles SET profile_json=? WHERE auth_user_id=?').run(JSON.stringify({...profile,address:'Changed street'}),customer.user.id);
    expect(JSON.parse(app.sql.prepare('SELECT billing_json FROM wdp_orders').get()!.billing_json as string).address).toBe('Original street');
    app.sql.exec(readFileSync('migrations/0003_customer_orders.sql','utf8'));
    expect(app.sql.prepare("SELECT next_value FROM wdp_order_sequences WHERE mode='test'").get()!.next_value).toBe(2);
    expect(orderReference({mode:'live',sequence:2412})).toBe('WDP-0002412');
  });
  it('stores an alternative registrant and rejects missing or malformed owner details',async()=>{
    const app=setup(),customer=await app.customer();
    const input={...app.input(),registrant:{sameAsBilling:false,name:'Other Owner',email:'owner@example.com',phone:'0101234567',company:'Other company',address:'Owner street',city:'Owner city',province:'Owner province',postalCode:'1234',country:'South Africa'}};
    expect((await createPayment(app.context(app.request(input,customer.cookie)))).status).toBe(200);
    expect(JSON.parse(app.sql.prepare('SELECT registrant_json FROM wdp_orders').get()!.registrant_json as string).name).toBe('Other Owner');
    expect((await createPayment(app.context(app.request({...app.input(),registrant:{sameAsBilling:false}},customer.cookie)))).status).toBe(400);
    expect(app.sql.prepare('SELECT COUNT(*) AS n FROM wdp_orders').get()!.n).toBe(1);
  });
  it('isolates customer history and details and rejects reuse by a different customer',async()=>{
    const app=setup(),first=await app.customer(),second=await app.customer('second@example.com'),input=app.input();
    await createPayment(app.context(app.request(input,first.cookie)));
    const get=(cookie:string,query='')=>ordersEndpoint(app.context(new Request('https://wdp.test/api/customer/orders'+query,{headers:{Cookie:cookie}})));
    expect((await (await get(first.cookie)).json()).orders).toHaveLength(1);
    expect((await (await get(second.cookie)).json()).orders).toHaveLength(0);
    expect((await get(second.cookie,'?order='+input.attemptId)).status).toBe(404);
    expect((await get('')).status).toBe(401);
    expect((await createPayment(app.context(app.request(input,second.cookie)))).status).toBe(409);
    const own=await get(first.cookie,'?order='+input.attemptId);expect(own.headers.get('cache-control')).toBe('no-store');expect((await own.json()).order.billing.email).toBe(first.user.email);
  });
  it('confirms saved orders only after verified matching webhooks and never downgrades paid orders',async()=>{
    const app=setup(),customer=await app.customer(),input=app.input();await createPayment(app.context(app.request(input,customer.cookie)));
    expect((await app.webhook(input,'succeeded',1)).status).toBe(400);expect(app.sql.prepare('SELECT payment_status FROM wdp_orders').get()!.payment_status).toBe('pending');
    expect((await app.webhook(input)).status).toBe(200);expect((await app.webhook(input)).status).toBe(200);await app.webhook(input,'failed');
    const order=app.sql.prepare('SELECT * FROM wdp_orders').get()!;expect(order.payment_status).toBe('paid');expect(order.payment_id).toBe('payment_'+input.attemptId);expect(order.fulfilment_status).toBe('not_started');
    const response=await paymentStatus(app.context(new Request(`https://wdp.test/api/payments/status?attempt=${input.attemptId}`,{headers:{Authorization:'Bearer '+input.accessToken}})));
    expect((await response.json()).reference).toBe('WDP-TEST-0000001');
  });
  it('repairs an interrupted cross-database update when the signed webhook is retried',async()=>{
    const app=setup(),customer=await app.customer(),input=app.input();await createPayment(app.context(app.request(input,customer.cookie)));
    const original=app.env.DB!.prepare.bind(app.env.DB);let fail=true;
    vi.spyOn(app.env.DB!,'prepare').mockImplementation(query=>{if(fail&&query.includes("SET payment_status='paid'"))throw new Error('Temporary customer DB failure');return original(query);});
    expect((await app.webhook(input)).status).toBe(503);expect(app.payments.prepare('SELECT status FROM payment_tests').get()!.status).toBe('paid');
    fail=false;expect((await app.webhook(input)).status).toBe(200);expect(app.sql.prepare('SELECT payment_status FROM wdp_orders').get()!.payment_status).toBe('paid');expect(app.sql.prepare('SELECT COUNT(*) AS n FROM wdp_orders').get()!.n).toBe(1);
  });
  it('allocates distinct numbers for concurrent new orders and only one number for concurrent retries',async()=>{
    const app=setup(),customer=await app.customer(),first=app.input(),second=app.input(),priced={cart:JSON.stringify({domains:[{domain:'example.co.za',cents:9500}],hosting:true}),amount:15500};
    const result=await Promise.all([saveTestOrder(app.env,customer.user,first,priced,'hash1'),saveTestOrder(app.env,customer.user,second,priced,'hash2'),saveTestOrder(app.env,customer.user,first,priced,'hash1')]);
    expect(result.map(order=>order.sequence)).toEqual([1,2,1]);expect(app.sql.prepare("SELECT next_value FROM wdp_order_sequences WHERE mode='test'").get()!.next_value).toBe(3);
  });
  it('paginates only the signed-in customer orders without leaking private payment access data',async()=>{
    const app=setup(),customer=await app.customer(),other=await app.customer('second@example.com');
    const priced={cart:JSON.stringify({domains:[{domain:'example.co.za',cents:9500}],hosting:true}),amount:15500};
    for(let i=0;i<27;i++)await saveTestOrder(app.env,customer.user,app.input(),priced,'private-hash');
    await saveTestOrder(app.env,other.user,app.input(),priced,'other-private-hash');
    const get=(query='')=>ordersEndpoint(app.context(new Request('https://wdp.test/api/customer/orders'+query,{headers:{Cookie:customer.cookie}})));
    const first=await (await get()).json();expect(first.orders).toHaveLength(25);expect(first.nextBefore).toBe(3);expect(first.orderCount).toBe(27);
    expect(JSON.stringify(first)).not.toContain('private-hash');expect(first.orders[0]).not.toHaveProperty('billing');
    const second=await (await get('?before='+first.nextBefore)).json();expect(second.orders).toHaveLength(2);expect(second.nextBefore).toBeNull();
    expect(new Set([...first.orders,...second.orders].map(order=>order.id)).size).toBe(27);
    expect((await get('?before=invalid')).status).toBe(400);
  });
  it('shows only paid customer services with saved prices and purchase-based billing dates',async()=>{
    const app=setup(),customer=await app.customer(),other=await app.customer('second@example.com'),input=app.input();
    await createPayment(app.context(app.request(input,customer.cookie)));
    const get=(cookie:string)=>servicesEndpoint(app.context(new Request('https://wdp.test/api/customer/services',{headers:{Cookie:cookie}})));
    expect((await (await get(customer.cookie)).json()).services).toHaveLength(0);
    await app.webhook(input);
    app.sql.prepare('UPDATE wdp_orders SET paid_at=? WHERE id=?').run('2026-11-13 10:00:00',input.attemptId);
    const response=await get(customer.cookie),result=await response.json();expect(response.headers.get('cache-control')).toBe('no-store');
    expect(result.serviceCount).toBe(2);expect(result.services[0]).toMatchObject({product:'Domain Registration',domain:'example.co.za',recurringCents:17000,paidCents:9500,status:'test_purchase',nextDueDate:'2027-11-13',priceSource:'purchase'});
    expect(result.services[1]).toMatchObject({product:'Starter Hosting',recurringCents:6000,cycle:'Monthly',status:'test_purchase',nextDueDate:'2026-12-13'});
    expect(JSON.stringify(result)).not.toContain('access_hash');expect((await (await get(other.cookie)).json()).services).toHaveLength(0);expect((await get('')).status).toBe(401);
    const prices=JSON.parse(app.sql.prepare('SELECT prices_json FROM wdp_order_prices WHERE order_id=?').get(input.attemptId)!.prices_json as string);prices[0].renewalCents=14000;
    app.sql.prepare('UPDATE wdp_order_prices SET prices_json=? WHERE order_id=?').run(JSON.stringify(prices),input.attemptId);
    expect((await (await get(customer.cookie)).json()).services[0].recurringCents).toBe(14000);
    app.sql.prepare('DELETE FROM wdp_order_prices WHERE order_id=?').run(input.attemptId);
    expect((await (await get(customer.cookie)).json()).services[0]).toMatchObject({recurringCents:17000,priceSource:'current_catalogue'});
  });
  it('charges a prepaid term once, keeps its years and moves renewal to the end of that term',async()=>{
    const app=setup(),customer=await app.customer();
    const input={...app.input(),domains:[{domain:'example.com',years:2}],hosting:false,quotedAmount:46000};
    expect((await createPayment(app.context(app.request(input,customer.cookie)))).status).toBe(200);
    expect(app.checkouts[0].amount).toBe(46000);
    const saved=app.sql.prepare('SELECT * FROM wdp_orders WHERE id=?').get(input.attemptId)!;
    expect(JSON.parse(saved.cart_json as string).domains[0]).toMatchObject({years:2,cents:46000});
    await app.webhook(input,'succeeded',46000);app.sql.prepare('UPDATE wdp_orders SET paid_at=? WHERE id=?').run('2026-11-13 10:00:00',input.attemptId);
    const get=()=>servicesEndpoint(app.context(new Request('https://wdp.test/api/customer/services',{headers:{Cookie:customer.cookie}})));
    expect((await (await get()).json()).services[0]).toMatchObject({years:2,paidCents:46000,recurringCents:46000,renewalYears:2,nextDueDate:'2028-11-13'});
    const five={...app.input(),domains:[{domain:'example.com',years:5}],hosting:false,quotedAmount:120000};
    await createPayment(app.context(app.request(five,customer.cookie)));await app.webhook(five,'succeeded',120000);app.sql.prepare('UPDATE wdp_orders SET paid_at=? WHERE id=?').run('2026-11-13 10:00:00',five.attemptId);
    expect((await (await get()).json()).services[0]).toMatchObject({years:5,paidCents:120000,recurringCents:120000,renewalYears:5,nextDueDate:'2031-11-13'});
  });
});


describe('paid-order owner alerts',()=>{
  const enable=(app:ReturnType<typeof setup>)=>Object.assign(app.env,{WDP_ORDER_EMAIL_ENABLED:'true',WDP_ORDER_TELEGRAM_ENABLED:'true',WDP_ORDER_TEST_ALERTS_ENABLED:'true',WDP_ORDER_ALERT_EMAIL:'info@webdesignpros.co.za',WDP_TELEGRAM_BOT_TOKEN:'123456:test_only_bot_token',WDP_TELEGRAM_CHAT_ID:'1234567',WDP_ORDER_ALERT_RETRY_SECRET:'test-retry-secret-at-least-thirty-two-characters'});
  it('sends independent minimal TEST alerts only after verified payment and reuses replayed deliveries',async()=>{
    const app=setup(),customer=await app.customer(),input=app.input();enable(app);app.env.WDP_REGISTRATION_QUEUE_ENABLED='true';
    await createPayment(app.context(app.request(input,customer.cookie)));
    expect(app.sql.prepare('SELECT COUNT(*) AS n FROM wdp_order_alerts').get()!.n).toBe(0);
    const sent:any[]=[];
    app.provider.mockImplementation(async(url,options)=>{sent.push({url:String(url),headers:options!.headers,body:JSON.parse(options!.body as string)});return new Response(String(url).includes('telegram.org')?JSON.stringify({ok:true,result:{message_id:42}}):JSON.stringify({id:'email_order'}));});
    expect((await app.webhook(input)).status).toBe(200);
    expect(sent).toHaveLength(2);expect(sent.find(item=>item.url.includes('resend')).body.to).toEqual(['info@webdesignpros.co.za']);
    const mail=sent.find(item=>item.url.includes('resend'));expect(mail.headers['Idempotency-Key']).toBe(`wdp-paid-order/${input.attemptId}/email`);expect(mail.body.text).toContain('https://wdp.test/dashboard/registrations/');
    for(const item of sent){expect(item.body.text).toContain('WDP-TEST-0000001');expect(item.body.text).toContain('example.co.za');expect(item.body.text).toContain('Do not buy or register');expect(item.body.text).not.toContain('Original street');expect(item.body.text).not.toContain(customer.email);expect(item.body.text).not.toContain(input.accessToken);}
    expect(app.sql.prepare("SELECT COUNT(*) AS n FROM wdp_order_alerts WHERE status='sent'").get()!.n).toBe(2);
    expect((await app.webhook(input)).status).toBe(200);expect(sent).toHaveLength(2);
  });
  it('retains verified payment on a channel failure and retries only the failed channel',async()=>{
    const app=setup(),customer=await app.customer(),input=app.input();enable(app);await createPayment(app.context(app.request(input,customer.cookie)));
    let telegramFail=true;const counts={email:0,telegram:0};
    app.provider.mockImplementation(async(url)=>{if(String(url).includes('telegram.org')){counts.telegram++;return telegramFail?new Response('{}',{status:503}):new Response('{"ok":true,"result":{"message_id":1}}');}counts.email++;return new Response('{"id":"email_order"}');});
    expect((await app.webhook(input)).status).toBe(503);
    expect(app.sql.prepare('SELECT payment_status FROM wdp_orders').get()!.payment_status).toBe('paid');
    const status=await paymentStatus(app.context(new Request(`https://wdp.test/api/payments/status?attempt=${input.attemptId}`,{headers:{Authorization:`Bearer ${input.accessToken}`}})));
    expect(status.status).toBe(200);expect((await status.json()).status).toBe('paid');
    telegramFail=false;app.sql.exec('UPDATE wdp_order_alerts SET next_attempt_at=0');
    expect(await deliverOrderAlerts(app.env)).toBe(true);expect(counts).toEqual({email:1,telegram:2});
  });
  it.each([
    ['timeout','request_timeout'],['network','network_error'],['aborted','request_aborted'],['body','response_unreadable'],['http','http_403']
  ])('reports a safe %s diagnostic without exposing Telegram credentials',async(kind,reason)=>{
    const app=setup(),customer=await app.customer(),input=app.input();enable(app);await createPayment(app.context(app.request(input,customer.cookie)));
    const sensitive='https://api.telegram.org/bot'+app.env.WDP_TELEGRAM_BOT_TOKEN+'/sendMessage';
    app.provider.mockImplementation(async(url)=>{
      if(!String(url).includes('telegram.org'))return new Response('{"id":"email_order"}');
      if(kind==='timeout')throw new DOMException(sensitive,'TimeoutError');
      if(kind==='network')throw new TypeError(sensitive);
      if(kind==='aborted')throw new DOMException(sensitive,'AbortError');
      return kind==='body'?new Response(sensitive):new Response(sensitive,{status:403});
    });
    expect((await app.webhook(input)).status).toBe(503);
    expect(app.sql.prepare("SELECT status,last_error FROM wdp_order_alerts WHERE channel='telegram'").get()).toMatchObject({status:'pending',last_error:reason});
    const request=(token:string)=>app.context(new Request('https://wdp.test/api/internal/order-alerts',{method:'POST',headers:{Authorization:`Bearer ${token}`}}));
    expect((await retryAlerts(request('wrong'))).status).toBe(403);
    const response=await retryAlerts(request(app.env.WDP_ORDER_ALERT_RETRY_SECRET!)),result=await response.json();
    expect(result.pendingAlerts).toEqual([{reference:'WDP-TEST-0000001',channel:'telegram',attempts:1,error:reason}]);
    expect(JSON.stringify(result)).not.toContain(app.env.WDP_TELEGRAM_BOT_TOKEN);expect(JSON.stringify(result)).not.toContain(customer.user.email);
    expect(app.sql.prepare("SELECT status FROM wdp_order_alerts WHERE channel='email'").get()!.status).toBe('sent');
  });
  it('accepts a Telegram confirmation taking longer than the previous eight-second limit',async()=>{
    const app=setup(),customer=await app.customer(),input=app.input();enable(app);await createPayment(app.context(app.request(input,customer.cookie)));
    let telegramRequests=0;
    app.provider.mockImplementation(async(url,options)=>{
      if(!String(url).includes('telegram.org'))return new Response('{"id":"email_order"}');
      telegramRequests++;
      const signal=options!.signal!;
      return new Promise<Response>((resolve,reject)=>{
        const abort=()=>{clearTimeout(timer);reject(signal.reason);};
        const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve(new Response('{"ok":true,"result":{"message_id":42}}'));},9000);
        signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
      });
    });
    expect((await app.webhook(input)).status).toBe(200);
    expect(app.sql.prepare("SELECT status,provider_id FROM wdp_order_alerts WHERE channel='telegram'").get()).toMatchObject({status:'sent',provider_id:'42'});
    expect((await app.webhook(input)).status).toBe(200);expect(telegramRequests).toBe(1);
  },15000);
  it('distinguishes acceptance followed by a delivery-record failure',async()=>{
    const app=setup(),customer=await app.customer(),input=app.input();enable(app);await createPayment(app.context(app.request(input,customer.cookie)));
    app.sql.exec("CREATE TRIGGER reject_telegram_sent BEFORE UPDATE OF status ON wdp_order_alerts WHEN NEW.channel='telegram' AND NEW.status='sent' BEGIN SELECT RAISE(ABORT,'private database error'); END;");
    app.provider.mockImplementation(async(url)=>new Response(String(url).includes('telegram.org')?'{"ok":true,"result":{"message_id":42}}':'{"id":"email_order"}'));
    expect((await app.webhook(input)).status).toBe(503);
    expect(app.sql.prepare("SELECT status,last_error FROM wdp_order_alerts WHERE channel='telegram'").get()).toMatchObject({status:'pending',last_error:'delivery_record_failed'});
  });
  it('does not alert on failed payments, disabled test alerts, or forged webhooks',async()=>{
    const app=setup(),customer=await app.customer(),input=app.input();enable(app);await createPayment(app.context(app.request(input,customer.cookie)));
    app.provider.mockClear();expect((await app.webhook(input,'failed')).status).toBe(200);expect(app.provider).not.toHaveBeenCalled();
    app.env.WDP_ORDER_TEST_ALERTS_ENABLED='false';expect((await app.webhook(input)).status).toBe(200);expect(app.provider).not.toHaveBeenCalled();
    expect(app.sql.prepare('SELECT COUNT(*) AS n FROM wdp_order_alerts').get()!.n).toBe(0);
    app.env.WDP_ORDER_TEST_ALERTS_ENABLED='true';
    expect((await paymentWebhook(app.context(new Request('https://wdp.test/api/payments/webhook',{method:'POST',body:'{}'})))).status).toBe(403);expect(app.provider).not.toHaveBeenCalled();
  });
  it('uses a lease against concurrent delivery, protects retries and holds old uncertain email sends',async()=>{
    const app=setup(),customer=await app.customer(),input=app.input();enable(app);await createPayment(app.context(app.request(input,customer.cookie)));
    let release:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});const sent:string[]=[];
    app.provider.mockImplementation(async(url)=>{sent.push(String(url));await pending;return new Response(String(url).includes('telegram.org')?'{"ok":true,"result":{"message_id":1}}':'{"id":"email_order"}');});
    const first=app.webhook(input);await vi.waitFor(()=>expect(sent).toHaveLength(2));
    expect(await deliverOrderAlerts(app.env,input.attemptId)).toBe(false);expect(sent).toHaveLength(2);release!();expect((await first).status).toBe(200);
    const retry=(token:string)=>retryAlerts(app.context(new Request('https://wdp.test/api/internal/order-alerts',{method:'POST',headers:{Authorization:`Bearer ${token}`}})));
    expect((await retry('wrong')).status).toBe(403);expect((await retry(app.env.WDP_ORDER_ALERT_RETRY_SECRET!)).status).toBe(200);
    app.sql.exec("UPDATE wdp_order_alerts SET status='pending',created_at='2020-01-01 00:00:00' WHERE channel='email'");
    expect(await deliverOrderAlerts(app.env,input.attemptId)).toBe(false);expect(sent).toHaveLength(2);expect(app.sql.prepare("SELECT last_error FROM wdp_order_alerts WHERE channel='email'").get()!.last_error).toBe('manual_review');
  });
});


describe('customer paid invoices',()=>{
  const get=(app:ReturnType<typeof setup>,cookie='',query='')=>invoicesEndpoint(app.context(new Request('https://wdp.test/api/customer/invoices'+query,{headers:{Cookie:cookie}})));
  it('issues a paid snapshot only after payment, without duplicating numbers or exposing private data',async()=>{
    const app=setup(),customer=await app.customer(),input=app.input();await createPayment(app.context(app.request(input,customer.cookie)));
    expect(await (await get(app,customer.cookie)).json()).toMatchObject({invoiceCount:0,totalPaid:0,unpaidInvoiceCount:0,invoices:[]});expect((await get(app,customer.cookie,'?invoice='+input.attemptId)).status).toBe(404);
    await app.webhook(input);await app.webhook(input);
    const list=await get(app,customer.cookie);expect(list.headers.get('cache-control')).toBe('no-store');const summary=await list.json();expect(summary).toMatchObject({invoiceCount:1,totalPaid:15500,unpaidInvoiceCount:0});expect(summary.invoices[0]).not.toHaveProperty('billing');expect(JSON.stringify(summary)).not.toContain('access_hash');
    const detail=(await (await get(app,customer.cookie,'?invoice='+input.attemptId)).json()).invoice;
    expect(detail).toMatchObject({reference:'WDP-TEST-0000001',mode:'test',total:15500,amountPaid:15500,balanceDue:0,seller:{registrationNumber:'2026/282129/07'},billing:{email:customer.user.email,address:'Original street'}});
    expect(detail.lines).toEqual([{description:'Domain registration: example.co.za',period:'1 year',amount:9500},{description:'Starter hosting with email',period:'First month',amount:6000}]);
    expect(detail).not.toHaveProperty('payment_id');expect(detail).not.toHaveProperty('access_hash');expect(detail).not.toHaveProperty('registrant');expect(detail).not.toHaveProperty('checkout_id');
    app.sql.prepare('UPDATE wdp_customer_profiles SET profile_json=? WHERE auth_user_id=?').run(JSON.stringify({...profile,address:'New address'}),customer.user.id);
    expect((await (await get(app,customer.cookie,'?invoice='+input.attemptId)).json()).invoice.billing.address).toBe('Original street');
    expect(app.sql.prepare("SELECT next_value FROM wdp_order_sequences WHERE mode='test'").get()!.next_value).toBe(2);expect(app.sql.prepare("SELECT next_value FROM wdp_order_sequences WHERE mode='live'").get()!.next_value).toBe(2412);
  });
  it('requires verified sign-in and customer ownership for lists and individual invoices',async()=>{
    const app=setup(),customer=await app.customer(),other=await app.customer('other@example.com'),input=app.input();await createPayment(app.context(app.request(input,customer.cookie)));await app.webhook(input);
    expect((await get(app)).status).toBe(401);expect((await get(app,other.cookie,'?invoice='+input.attemptId)).status).toBe(404);expect((await get(app,customer.cookie,'?invoice=not-a-uuid')).status).toBe(404);
    expect(await (await get(app,other.cookie)).json()).toMatchObject({invoiceCount:0,totalPaid:0,invoices:[]});expect(await (await get(app,customer.cookie,'?mode=live')).json()).toMatchObject({invoiceCount:0,invoices:[]});
    expect((await get(app,customer.cookie,'?mode=other')).status).toBe(400);expect((await get(app,customer.cookie,'?before=-1')).status).toBe(400);
  });
  it('preserves the complete selected-term total rather than multiplying or repricing it',async()=>{
    const app=setup(),customer=await app.customer(),input={...app.input(),domains:[{domain:'example.com',years:3}],hosting:false,quotedAmount:73000};await createPayment(app.context(app.request(input,customer.cookie)));await app.webhook(input,'succeeded',73000);
    const invoice=(await (await get(app,customer.cookie,'?invoice='+input.attemptId)).json()).invoice;
    expect(invoice.lines).toEqual([{description:'Domain registration: example.com',period:'3 years',amount:73000}]);expect(invoice.total).toBe(73000);
  });
  it('excludes failed attempts and refuses mismatched saved item totals',async()=>{
    const app=setup(),customer=await app.customer(),input=app.input();await createPayment(app.context(app.request(input,customer.cookie)));await app.webhook(input,'failed');
    expect((await get(app,customer.cookie,'?invoice='+input.attemptId)).status).toBe(404);expect((await (await get(app,customer.cookie)).json()).invoiceCount).toBe(0);
    const row=app.sql.prepare('SELECT * FROM wdp_orders').get()!;expect(()=>invoiceDetail({...row,payment_status:'paid',amount:1} as any)).toThrow('Invoice totals');
  });
  it('paginates confirmed invoices without repeating rows or changing account totals',async()=>{
    const app=setup(),customer=await app.customer(),priced={cart:JSON.stringify({domains:[{domain:'example.com',cents:21000}],hosting:false}),amount:21000};
    for(let i=0;i<27;i++)await saveTestOrder(app.env,customer.user,app.input(),priced,'private-hash');app.sql.exec("UPDATE wdp_orders SET payment_status='paid',paid_at='2026-11-14 10:00:00'");
    const first=await (await get(app,customer.cookie)).json(),next=await (await get(app,customer.cookie,'?before='+first.nextBefore)).json();expect(first).toMatchObject({invoiceCount:27,totalPaid:567000});expect(first.invoices).toHaveLength(25);expect(next.invoices).toHaveLength(2);expect(new Set([...first.invoices,...next.invoices].map(invoice=>invoice.id)).size).toBe(27);expect(next.nextBefore).toBeNull();
  });
});

describe('private manual registration queue',()=>{
  const enable=(app:ReturnType<typeof setup>)=>Object.assign(app.env,{WDP_REGISTRATION_QUEUE_ENABLED:'true',WDP_REGISTRATION_ADMIN_EMAIL:'admin@example.com'});
  const queue=(app:ReturnType<typeof setup>,cookie='',query='')=>queueEndpoint(app.context(new Request('https://wdp.test/api/admin/registrations'+query,{headers:{Cookie:cookie}})));
  const update=(app:ReturnType<typeof setup>,cookie:string,body:any,origin='https://wdp.test')=>registrationEndpoint(app.context(new Request('https://wdp.test/api/admin/registrations',{method:'PUT',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)})));
  const record=(orderId:string,domain='example.co.za',version=0)=>({orderId,domain,version,status:'registered',registeredOn:'2026-11-13',expiresOn:'2027-11-13',providerReference:'TH-123',notes:'Internal note',confirmed:true});
  it('restricts queue reads and writes to the configured verified administrator',async()=>{
    const app=setup(),customer=await app.customer(),admin=await app.customer('admin@example.com');enable(app);
    expect((await queue(app)).status).toBe(401);expect((await queue(app,customer.cookie)).status).toBe(403);expect((await queue(app,admin.cookie)).status).toBe(200);
    expect((await update(app,customer.cookie,record(crypto.randomUUID()))).status).toBe(403);
    expect((await update(app,admin.cookie,record(crypto.randomUUID()),'https://evil.test')).status).toBe(403);
    app.env.WDP_REGISTRATION_QUEUE_ENABLED='false';expect((await queue(app,admin.cookie)).status).toBe(403);
  });
  it('records paid domains individually, audits edits and keeps test purchases visibly separate',async()=>{
    const app=setup(),customer=await app.customer(),admin=await app.customer('admin@example.com'),other=await app.customer('other@example.com');enable(app);
    const input={...app.input(),domains:['example.co.za','example.com'],hosting:false,quotedAmount:30500};
    await createPayment(app.context(app.request(input,customer.cookie)));expect((await queue(app,admin.cookie)).status).toBe(200);expect((await (await queue(app,admin.cookie)).json()).items).toHaveLength(0);
    await app.webhook(input,'succeeded',30500);const initial=await (await queue(app,admin.cookie)).json();expect(initial.items).toHaveLength(2);expect(initial.items[0].registrant.address).toBe('Original street');
    const calls=app.provider.mock.calls.length;
    expect((await update(app,admin.cookie,record(input.attemptId))).status).toBe(200);
    const partial=await (await domainsEndpoint(app.context(new Request('https://wdp.test/api/customer/domains',{headers:{Cookie:customer.cookie}})))).json();
    expect(partial).toMatchObject({domainCount:0,testDomainCount:1});
    expect(app.sql.prepare('SELECT fulfilment_status FROM wdp_orders').get()!.fulfilment_status).toBe('test_registration_pending');
    expect((await update(app,admin.cookie,record(input.attemptId))).status).toBe(409);
    expect((await update(app,admin.cookie,record(input.attemptId,'example.com'))).status).toBe(200);
    expect(app.sql.prepare('SELECT fulfilment_status FROM wdp_orders').get()!.fulfilment_status).toBe('test_domains_recorded');expect(app.provider.mock.calls).toHaveLength(calls);
    await app.webhook(input,'succeeded',30500);expect(app.sql.prepare('SELECT fulfilment_status FROM wdp_orders').get()!.fulfilment_status).toBe('test_domains_recorded');
    expect((await (await queue(app,admin.cookie,'?status=registered')).json()).items).toHaveLength(2);expect((await (await queue(app,admin.cookie)).json()).items).toHaveLength(0);
    const getDomains=(cookie:string)=>domainsEndpoint(app.context(new Request('https://wdp.test/api/customer/domains',{headers:{Cookie:cookie}})));
    const domains=await (await getDomains(customer.cookie)).json();expect(domains.domains).toHaveLength(2);expect(domains.domainCount).toBe(0);expect(domains.domains[0]).toMatchObject({mode:'test',status:'registered',registeredOn:'2026-11-13',expiresOn:'2027-11-13'});expect(domains.domains[0]).not.toHaveProperty('notes');expect(domains.domains[0]).not.toHaveProperty('providerReference');expect((await (await getDomains(other.cookie)).json()).domains).toHaveLength(0);
    expect(domains.testDomainCount).toBe(2);
    expect(await (await getDomains(other.cookie)).json()).toMatchObject({domainCount:0,testDomainCount:0});
    const services=await (await servicesEndpoint(app.context(new Request('https://wdp.test/api/customer/services',{headers:{Cookie:customer.cookie}})))).json();expect(services.services[0]).toMatchObject({status:'test_recorded',expiresOn:'2027-11-13'});
    expect(app.sql.prepare('SELECT COUNT(*) AS n FROM wdp_registration_audit').get()!.n).toBe(2);
    expect((await update(app,admin.cookie,{...record(input.attemptId,'example.com',1),notes:'Corrected notes'})).status).toBe(200);expect(app.sql.prepare('SELECT COUNT(*) AS n FROM wdp_registration_audit').get()!.n).toBe(3);
  });
  it('validates dates, paid membership, confirmation and issue notes without writing bad records',async()=>{
    const app=setup(),customer=await app.customer(),admin=await app.customer('admin@example.com'),input=app.input();enable(app);await createPayment(app.context(app.request(input,customer.cookie)));
    expect((await update(app,admin.cookie,record(input.attemptId))).status).toBe(404);await app.webhook(input);
    for(const change of [{registeredOn:'2026-02-30'},{registeredOn:'2099-01-01'},{expiresOn:'2026-11-12'},{confirmed:false},{providerReference:''},{status:'issue',notes:''}])expect((await update(app,admin.cookie,{...record(input.attemptId),...change})).status).toBe(400);
    expect((await update(app,admin.cookie,record(input.attemptId,'not-purchased.com'))).status).toBe(404);
    expect(app.sql.prepare('SELECT COUNT(*) AS n FROM wdp_domain_registrations').get()!.n).toBe(0);expect(validDate('2028-02-29')).toBe(true);expect(validDate('2027-02-29')).toBe(false);
    expect((await update(app,admin.cookie,{...record(input.attemptId),status:'issue',notes:'Domain became unavailable'})).status).toBe(200);expect((await (await queue(app,admin.cookie,'?status=issue')).json()).items).toHaveLength(1);
  });
  it('refuses competing stale edits and keeps one matching audit entry',async()=>{
    const app=setup(),customer=await app.customer(),admin=await app.customer('admin@example.com'),input=app.input();enable(app);await createPayment(app.context(app.request(input,customer.cookie)));await app.webhook(input);
    const results=await Promise.all([update(app,admin.cookie,record(input.attemptId)),update(app,admin.cookie,{...record(input.attemptId),notes:'Competing change'})]);
    expect(results.map(result=>result.status).sort()).toEqual([200,409]);expect(app.sql.prepare('SELECT COUNT(*) AS n FROM wdp_registration_audit').get()!.n).toBe(1);expect(app.sql.prepare('SELECT version FROM wdp_domain_registrations').get()!.version).toBe(1);
  });
  const confirmations=(app:ReturnType<typeof setup>)=>app.provider.mock.calls.filter(([,options])=>JSON.parse(options!.body as string).subject?.startsWith('TEST registration confirmation:'));
  const enableEmails=(app:ReturnType<typeof setup>)=>Object.assign(app.env,{WDP_REGISTRATION_EMAIL_ENABLED:'true',WDP_REGISTRATION_TEST_EMAILS_ENABLED:'true'});
  it('downloads the identical emailed PDF for every included order without sending or rendering again',async()=>{
    const app=setup(),customer=await app.customer(),admin=await app.customer('admin@example.com');enable(app);enableEmails(app);
    const inputs=[app.input(),app.input()];
    const get=(id:string,cookie=customer.cookie,download=true)=>invoicesEndpoint(app.context(new Request('https://wdp.test/api/customer/invoices?invoice='+id+(download?'&download=pdf':''),{headers:{Cookie:cookie}})));
    for(const input of inputs){await createPayment(app.context(app.request(input,customer.cookie)));await app.webhook(input);}
    expect((await get(inputs[0].attemptId)).status).toBe(409);
    expect(await (await get(inputs[0].attemptId,customer.cookie,false)).json()).toMatchObject({pdfAvailable:false});
    for(const input of inputs)await update(app,admin.cookie,record(input.attemptId));
    const sent=JSON.parse(confirmations(app)[0][1]!.body as string),calls=app.provider.mock.calls.length;
    for(const input of inputs){
      const response=await get(input.attemptId);expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/pdf');expect(response.headers.get('content-disposition')).toBe('attachment; filename="WDP-TEST-0000001.pdf"');expect(response.headers.get('cache-control')).toContain('no-store');expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(await response.text()).toBe(atob(sent.attachments[0].content));
      const details=await (await get(input.attemptId,customer.cookie,false)).json();expect(details.pdfAvailable).toBe(true);expect(details).not.toHaveProperty('email');expect(details).not.toHaveProperty('attachments');
    }
    const list=await (await invoicesEndpoint(app.context(new Request('https://wdp.test/api/customer/invoices',{headers:{Cookie:customer.cookie}})))).json();
    expect(list.invoices).toHaveLength(1);expect(list.invoices[0].pdfAvailable).toBe(true);expect(JSON.stringify(list)).not.toContain(sent.attachments[0].content);
    expect(app.provider.mock.calls).toHaveLength(calls);
    expect((await get(inputs[0].attemptId,'')).status).toBe(401);expect((await get(inputs[0].attemptId,admin.cookie)).status).toBe(404);
    const pending=app.input();await createPayment(app.context(app.request(pending,customer.cookie)));expect((await get(pending.attemptId)).status).toBe(404);
  });
  it('rejects a damaged stored PDF without regenerating or returning private delivery data',async()=>{
    const app=setup(),customer=await app.customer(),admin=await app.customer('admin@example.com'),input=app.input();enable(app);enableEmails(app);
    await createPayment(app.context(app.request(input,customer.cookie)));await app.webhook(input);await update(app,admin.cookie,record(input.attemptId));
    const envelope=JSON.parse(app.sql.prepare('SELECT payload_json FROM wdp_registration_emails').get()!.payload_json as string),calls=app.provider.mock.calls.length;
    for(const change of [{content:btoa('not a PDF')},{filename:'bad\r\nheader.pdf'},{content:'*invalid*'},{content:btoa('%PDF-'+ 'a'.repeat(900000))}]){
      const damaged=structuredClone(envelope);Object.assign(damaged.email.attachments[0],change);app.sql.prepare('UPDATE wdp_registration_emails SET payload_json=?').run(JSON.stringify(damaged));
      const response=await invoicesEndpoint(app.context(new Request('https://wdp.test/api/customer/invoices?invoice='+input.attemptId+'&download=pdf',{headers:{Cookie:customer.cookie}})));
      expect(response.status).toBe(503);expect(await response.json()).toEqual({error:'Your invoice PDF is unavailable. Please contact WDP.'});
    }
    expect(app.provider.mock.calls).toHaveLength(calls);
  });
  it('waits for every domain in the order, then sends one confirmation and unchanged invoice',async()=>{
    const app=setup(),customer=await app.customer(),admin=await app.customer('admin@example.com');enable(app);enableEmails(app);
    const input={...app.input(),domains:['example.co.za','example.com'],hosting:false,quotedAmount:30500};await createPayment(app.context(app.request(input,customer.cookie)));await app.webhook(input,'succeeded',30500);
    expect((await update(app,customer.cookie,record(input.attemptId))).status).toBe(403);expect(confirmations(app)).toHaveLength(0);
    const result=await update(app,admin.cookie,record(input.attemptId));expect(await result.json()).toMatchObject({saved:true,emailStatus:'waiting',version:1});
    expect(confirmations(app)).toHaveLength(0);expect(app.sql.prepare('SELECT COUNT(*) AS n FROM wdp_registration_emails').get()!.n).toBe(0);
    await deliverRegistrationEmails(app.env);expect(confirmations(app)).toHaveLength(0);
    expect(await (await update(app,admin.cookie,record(input.attemptId,'example.com'))).json()).toMatchObject({saved:true,emailStatus:'sent'});
    const sent=JSON.parse(confirmations(app)[0][1]!.body as string);
    expect(sent.attachments).toHaveLength(1);expect(sent.attachments[0]).toMatchObject({filename:'WDP-TEST-0000001.pdf',content_type:'application/pdf'});expect(atob(sent.attachments[0].content)).toContain('%PDF-');expect(sent).not.toHaveProperty('_invoice');
    expect(sent.text).toContain('Domain: example.co.za');expect(sent.text).toContain('Domain: example.com');expect(sent.to).toEqual(['first@example.com']);expect(sent.text).toContain('13 November 2026');expect(sent.text).toContain('13 November 2027');expect(sent.text).toContain('WDP-TEST-0000001');expect(sent.text).toContain('TEST EMAIL — no domain has been registered.');expect(sent.text).toContain('https://wdp.test/dashboard/domains/?mode=test');expect(sent.text).not.toContain('TH-123');expect(sent.text).not.toContain('Internal note');
    await update(app,admin.cookie,{...record(input.attemptId,'example.co.za',1),notes:'Corrected internal note'});expect(confirmations(app)).toHaveLength(1);
    await update(app,admin.cookie,record(input.attemptId,'example.com',1));expect(confirmations(app)).toHaveLength(1);
    expect(app.sql.prepare("SELECT COUNT(*) AS n FROM wdp_registration_emails WHERE status='sent'").get()!.n).toBe(1);
  });
  it('sends one complete snapshot when two different domains finish concurrently',async()=>{
    const app=setup(),customer=await app.customer(),admin=await app.customer('admin@example.com');enable(app);enableEmails(app);
    const input={...app.input(),domains:['example.co.za','example.com'],hosting:false,quotedAmount:30500};await createPayment(app.context(app.request(input,customer.cookie)));await app.webhook(input,'succeeded',30500);
    const results=await Promise.all([update(app,admin.cookie,{...record(input.attemptId),registeredOn:'2026-11-12'}),update(app,admin.cookie,record(input.attemptId,'example.com'))]);
    expect(results.map(result=>result.status)).toEqual([200,200]);await Promise.all([deliverRegistrationEmails(app.env),deliverRegistrationEmails(app.env)]);
    expect(confirmations(app)).toHaveLength(1);const sent=JSON.parse(confirmations(app)[0][1]!.body as string);expect(sent.text).toContain('Domain: example.co.za');expect(sent.text).toContain('Domain: example.com');expect(sent.text).toContain('12 November 2026');expect(sent.text).toContain('13 November 2026');expect(sent.attachments).toHaveLength(1);
    expect(app.sql.prepare('SELECT COUNT(*) AS n FROM wdp_registration_emails').get()!.n).toBe(1);
  });
  it('waits for every paid order for the same client, including issue domains',async()=>{
    const app=setup(),customer=await app.customer(),admin=await app.customer('admin@example.com');enable(app);enableEmails(app);
    const first={...app.input(),domains:['example.co.za','example.com'],hosting:false,quotedAmount:30500},second=app.input();
    await createPayment(app.context(app.request(first,customer.cookie)));await app.webhook(first,'succeeded',30500);await createPayment(app.context(app.request(second,customer.cookie)));await app.webhook(second);
    await update(app,admin.cookie,record(first.attemptId));await update(app,admin.cookie,{...record(first.attemptId,'example.com'),status:'issue',notes:'Checking ownership'});expect(confirmations(app)).toHaveLength(0);
    expect(await (await update(app,admin.cookie,record(second.attemptId))).json()).toMatchObject({emailStatus:'waiting'});expect(confirmations(app)).toHaveLength(0);
    await update(app,admin.cookie,record(first.attemptId,'example.com',1));expect(confirmations(app)).toHaveLength(1);const message=JSON.parse(confirmations(app)[0][1]!.body as string);expect(message.text).toContain('WDP-TEST-0000001');expect(message.text).toContain('WDP-TEST-0000002');expect(message.attachments).toHaveLength(1);
  });
  it('groups four old and new orders for a client and starts a new group for later purchases',async()=>{
    const app=setup(),customer=await app.customer(),admin=await app.customer('admin@example.com');enable(app);enableEmails(app);
    const inputs=Array.from({length:4},()=>app.input());for(const input of inputs){await createPayment(app.context(app.request(input,customer.cookie)));await app.webhook(input);}
    app.sql.prepare("UPDATE wdp_orders SET created_at='2026-01-01 10:00:00' WHERE id=?").run(inputs[0].attemptId);
    for(const input of inputs.slice(0,3)){expect(await (await update(app,admin.cookie,record(input.attemptId))).json()).toMatchObject({emailStatus:'waiting'});expect(confirmations(app)).toHaveLength(0);}
    expect(await (await update(app,admin.cookie,record(inputs[3].attemptId))).json()).toMatchObject({emailStatus:'sent'});
    const sent=JSON.parse(confirmations(app)[0][1]!.body as string);expect(sent.attachments).toHaveLength(1);expect(sent.attachments[0].filename).toBe('WDP-TEST-0000001.pdf');
    for(let i=1;i<=4;i++)expect(sent.text).toContain('WDP-TEST-000000'+i);
    const bill=await (await invoicesEndpoint(app.context(new Request('https://wdp.test/api/customer/invoices',{headers:{Cookie:customer.cookie}})))).json();expect(bill).toMatchObject({invoiceCount:1,totalPaid:62000});expect(bill.invoices).toHaveLength(1);expect(bill.invoices[0].amount).toBe(62000);
    const frozen=JSON.parse(app.sql.prepare('SELECT payload_json FROM wdp_registration_emails').get()!.payload_json as string).invoice;
    expect(frozen).toMatchObject({orderCount:4,total:62000,amountPaid:62000,balanceDue:0,seller:{name:'Web Design Pros (Pty) Ltd'}});expect(frozen.lines).toHaveLength(8);
    for(const input of inputs){const invoice=(await (await invoicesEndpoint(app.context(new Request('https://wdp.test/api/customer/invoices?invoice='+input.attemptId,{headers:{Cookie:customer.cookie}})))).json()).invoice;expect(invoice).toEqual(frozen);}
    const html=JSON.parse(app.provider.mock.calls.find(([url])=>String(url).startsWith('https://api.cloudflare.com/'))![1]!.body as string).html;
    expect(html).toContain('R620');expect(html.match(/Web Design Pros \(Pty\) Ltd/g)).toHaveLength(2);for(let i=1;i<=4;i++)expect(html).toContain('WDP-TEST-000000'+i);

    expect(app.sql.prepare('SELECT COUNT(*) AS n FROM wdp_registration_emails').get()!.n).toBe(1);
    for(const input of inputs)await update(app,admin.cookie,record(input.attemptId,'example.co.za',1));expect(confirmations(app)).toHaveLength(1);
    const next=app.input();await createPayment(app.context(app.request(next,customer.cookie)));await app.webhook(next);await update(app,admin.cookie,record(next.attemptId));
    expect(confirmations(app)).toHaveLength(2);const later=JSON.parse(confirmations(app)[1][1]!.body as string);expect(later.attachments).toHaveLength(1);expect(later.text).toContain('WDP-TEST-0000005');expect(later.text).not.toContain('WDP-TEST-0000001');
    const after=await (await invoicesEndpoint(app.context(new Request('https://wdp.test/api/customer/invoices',{headers:{Cookie:customer.cookie}})))).json();expect(after).toMatchObject({invoiceCount:2,totalPaid:77500});expect(after.invoices).toHaveLength(2);
    const other=await app.customer('other@example.com');expect((await invoicesEndpoint(app.context(new Request('https://wdp.test/api/customer/invoices?invoice='+inputs[0].attemptId,{headers:{Cookie:other.cookie}})))).status).toBe(404);
    const priced={cart:JSON.stringify({domains:[{domain:'pending-bulk.com',cents:21000}],hosting:false}),amount:21000};for(let i=0;i<26;i++)await saveTestOrder(app.env,customer.user,app.input(),priced,'private-hash');app.sql.exec("UPDATE wdp_orders SET payment_status='paid',paid_at=COALESCE(paid_at,'2026-11-14 10:00:00')");
    const page=async(query='')=>(await (await invoicesEndpoint(app.context(new Request('https://wdp.test/api/customer/invoices'+query,{headers:{Cookie:customer.cookie}})))).json());
    const one=await page(),two=await page('?before='+one.nextBefore);expect(one).toMatchObject({invoiceCount:28,totalPaid:623500});expect(one.invoices).toHaveLength(25);expect(two.invoices).toHaveLength(3);expect(new Set([...one.invoices,...two.invoices].map((invoice:any)=>invoice.id)).size).toBe(28);expect(two.invoices.find((invoice:any)=>invoice.id===inputs[0].attemptId).amount).toBe(62000);


  });
  it('does not mix customers or let another customer hold up a ready client',async()=>{
    const app=setup(),customer=await app.customer(),other=await app.customer('second@example.com'),admin=await app.customer('admin@example.com');enable(app);enableEmails(app);
    const waiting=app.input(),ready=app.input();await createPayment(app.context(app.request(waiting,customer.cookie)));await app.webhook(waiting);await createPayment(app.context(app.request(ready,other.cookie)));await app.webhook(ready);
    await update(app,admin.cookie,record(ready.attemptId));expect(confirmations(app)).toHaveLength(1);const sent=JSON.parse(confirmations(app)[0][1]!.body as string);expect(sent.to).toEqual(['second@example.com']);expect(sent.text).toContain('WDP-TEST-0000002');expect(sent.text).not.toContain('WDP-TEST-0000001');expect(sent.attachments).toHaveLength(1);
  });
  it('handles simultaneous final registrations across separate orders as one client email',async()=>{
    const app=setup(),customer=await app.customer(),admin=await app.customer('admin@example.com');enable(app);enableEmails(app);
    const first=app.input(),second=app.input();for(const input of [first,second]){await createPayment(app.context(app.request(input,customer.cookie)));await app.webhook(input);}
    const results=await Promise.all([update(app,admin.cookie,record(first.attemptId)),update(app,admin.cookie,record(second.attemptId))]);expect(results.map(result=>result.status)).toEqual([200,200]);await deliverRegistrationEmails(app.env);
    expect(confirmations(app)).toHaveLength(1);expect(JSON.parse(confirmations(app)[0][1]!.body as string).attachments).toHaveLength(1);expect(app.sql.prepare('SELECT COUNT(*) AS n FROM wdp_registration_emails').get()!.n).toBe(1);
  });
  it('folds a newly paid order into an unsent client batch and reuses its already generated invoice',async()=>{
    const app=setup(),customer=await app.customer(),admin=await app.customer('admin@example.com'),first=app.input(),second=app.input();enable(app);enableEmails(app);await createPayment(app.context(app.request(first,customer.cookie)));await app.webhook(first);
    const original=app.provider.getMockImplementation()!;let injected=false;app.provider.mockImplementation(async(url,options)=>{if(String(url).startsWith('https://api.cloudflare.com/')&&!injected){injected=true;await createPayment(app.context(app.request(second,customer.cookie)));await app.webhook(second);}return original(url,options);});
    await update(app,admin.cookie,record(first.attemptId));expect(confirmations(app)).toHaveLength(0);expect(app.sql.prepare('SELECT first_attempt_at FROM wdp_registration_emails').get()!.first_attempt_at).toBeNull();
    app.sql.exec('UPDATE wdp_registration_emails SET next_attempt_at=0');await update(app,admin.cookie,record(second.attemptId));expect(confirmations(app)).toHaveLength(1);expect(JSON.parse(confirmations(app)[0][1]!.body as string).attachments).toHaveLength(1);expect(app.provider.mock.calls.filter(([url])=>String(url).startsWith('https://api.cloudflare.com/'))).toHaveLength(2);
  });
  it('rechecks and sends once if a new order completes while the earlier invoice is rendering',async()=>{
    const app=setup(),customer=await app.customer(),admin=await app.customer('admin@example.com'),first=app.input(),second=app.input();enable(app);enableEmails(app);await createPayment(app.context(app.request(first,customer.cookie)));await app.webhook(first);
    const original=app.provider.getMockImplementation()!;let injected=false;app.provider.mockImplementation(async(url,options)=>{if(String(url).startsWith('https://api.cloudflare.com/')&&!injected){injected=true;await createPayment(app.context(app.request(second,customer.cookie)));await app.webhook(second);await update(app,admin.cookie,record(second.attemptId));}return original(url,options);});
    await update(app,admin.cookie,record(first.attemptId));expect(confirmations(app)).toHaveLength(1);expect(JSON.parse(confirmations(app)[0][1]!.body as string).attachments).toHaveLength(1);expect(app.sql.prepare('SELECT COUNT(*) AS n FROM wdp_registration_emails').get()!.n).toBe(1);
  });
  it('keeps test/live pools separate and ignores unpaid checkout attempts',async()=>{
    const app=setup(),customer=await app.customer(),admin=await app.customer('admin@example.com');enable(app);enableEmails(app);
    const live=app.input(),unpaid=app.input(),ready=app.input();await createPayment(app.context(app.request(live,customer.cookie)));await app.webhook(live);
    app.sql.prepare("UPDATE wdp_orders SET mode='live',sequence=2412 WHERE id=?").run(live.attemptId);
    await createPayment(app.context(app.request(unpaid,customer.cookie)));await createPayment(app.context(app.request(ready,customer.cookie)));await app.webhook(ready);
    await update(app,admin.cookie,record(ready.attemptId));expect(confirmations(app)).toHaveLength(1);const sent=JSON.parse(confirmations(app)[0][1]!.body as string);expect(sent.attachments).toHaveLength(1);expect(sent.text).toContain('WDP-TEST-0000003');expect(sent.text).not.toContain('WDP-0002412');expect(sent.text).not.toContain('WDP-TEST-0000002');
  });
  it('retries a failed consolidated PDF without emailing separate invoices',async()=>{
    const app=setup(),customer=await app.customer(),admin=await app.customer('admin@example.com');enable(app);enableEmails(app);
    const inputs=[app.input(),app.input()];for(const input of inputs){await createPayment(app.context(app.request(input,customer.cookie)));await app.webhook(input);}
    const original=app.provider.getMockImplementation()!;let renders=0;app.provider.mockImplementation(async(url,options)=>{if(String(url).startsWith('https://api.cloudflare.com/')&&++renders===1)return new Response('{}',{status:503});return original(url,options);});
    await update(app,admin.cookie,record(inputs[0].attemptId));expect(await (await update(app,admin.cookie,record(inputs[1].attemptId))).json()).toMatchObject({saved:true,emailStatus:'pending'});
    expect(confirmations(app)).toHaveLength(0);expect(app.sql.prepare('SELECT first_attempt_at FROM wdp_registration_emails').get()!.first_attempt_at).toBeNull();
    app.sql.exec('UPDATE wdp_registration_emails SET next_attempt_at=0');await deliverRegistrationEmails(app.env);expect(confirmations(app)).toHaveLength(1);expect(JSON.parse(confirmations(app)[0][1]!.body as string).attachments).toHaveLength(1);expect(renders).toBe(2);
  });
  it('does not send a second invoice for a historical order already notified per domain',async()=>{
    const app=setup(),customer=await app.customer(),admin=await app.customer('admin@example.com');enable(app);enableEmails(app);
    const input={...app.input(),domains:['example.co.za','example.com'],hosting:false,quotedAmount:30500};await createPayment(app.context(app.request(input,customer.cookie)));await app.webhook(input,'succeeded',30500);
    await update(app,admin.cookie,record(input.attemptId));
    app.sql.prepare("INSERT INTO wdp_registration_emails(order_id,domain,payload_json,status,attempts,first_attempt_at) VALUES (?,?,'{}','sent',1,?)").run(input.attemptId,'example.co.za',Date.now());
    expect(await (await update(app,admin.cookie,record(input.attemptId,'example.com'))).json()).toMatchObject({saved:true,emailStatus:'sent'});
    await deliverRegistrationEmails(app.env);expect(confirmations(app)).toHaveLength(0);expect(app.sql.prepare('SELECT COUNT(*) AS n FROM wdp_registration_emails').get()!.n).toBe(1);
  });
  it('pauses a queued order if a domain returns to issue status before its email is sent',async()=>{
    const app=setup(),customer=await app.customer(),admin=await app.customer('admin@example.com'),input=app.input();enable(app);enableEmails(app);await createPayment(app.context(app.request(input,customer.cookie)));await app.webhook(input);
    app.env.WDP_PDF_API_TOKEN=undefined;await update(app,admin.cookie,record(input.attemptId));
    await update(app,admin.cookie,{...record(input.attemptId,'example.co.za',1),status:'issue',notes:'Double-checking registration'});
    app.env.WDP_PDF_API_TOKEN='test-pdf-token';app.sql.exec('UPDATE wdp_registration_emails SET next_attempt_at=0');await deliverRegistrationEmails(app.env);expect(confirmations(app)).toHaveLength(0);
    await update(app,admin.cookie,record(input.attemptId,'example.co.za',2));expect(confirmations(app)).toHaveLength(1);
  });
  it('retains a saved registration after email failure and retries with the same provider key',async()=>{
    const app=setup(),customer=await app.customer(),admin=await app.customer('admin@example.com'),input=app.input();enable(app);enableEmails(app);await createPayment(app.context(app.request(input,customer.cookie)));await app.webhook(input);
    const original=app.provider.getMockImplementation()!;let failed=false;app.provider.mockImplementation(async(url,options)=>{if(String(url)==='https://api.resend.com/emails'&&!failed){failed=true;return new Response('{}',{status:503});}return original(url,options);});
    expect(await (await update(app,admin.cookie,record(input.attemptId))).json()).toMatchObject({saved:true,emailStatus:'pending'});
    expect(app.sql.prepare('SELECT status FROM wdp_domain_registrations').get()!.status).toBe('registered');
    const first=confirmations(app)[0][1]!,key=(first.headers as Record<string,string>)['Idempotency-Key'];
    app.sql.prepare('UPDATE wdp_registration_emails SET next_attempt_at=0').run();
    await Promise.all([deliverRegistrationEmails(app.env),deliverRegistrationEmails(app.env)]);
    expect(confirmations(app)[1][1]!.body).toBe(first.body);expect(app.provider.mock.calls.filter(([url])=>String(url).startsWith('https://api.cloudflare.com/'))).toHaveLength(1);
    expect(confirmations(app)).toHaveLength(2);expect((confirmations(app)[1][1]!.headers as Record<string,string>)['Idempotency-Key']).toBe(key);
    expect(app.sql.prepare('SELECT status,attempts FROM wdp_registration_emails').get()).toMatchObject({status:'sent',attempts:2});
  });
  it('keeps registration saved and sends nothing until PDF rendering is configured',async()=>{
    const app=setup(),customer=await app.customer(),admin=await app.customer('admin@example.com'),input=app.input();enable(app);enableEmails(app);await createPayment(app.context(app.request(input,customer.cookie)));await app.webhook(input);
    app.env.WDP_PDF_API_TOKEN=undefined;
    expect(await (await update(app,admin.cookie,record(input.attemptId))).json()).toMatchObject({saved:true,emailStatus:'pending'});
    expect(confirmations(app)).toHaveLength(0);expect(app.sql.prepare('SELECT status FROM wdp_domain_registrations').get()!.status).toBe('registered');
    expect(app.sql.prepare('SELECT last_error,first_attempt_at FROM wdp_registration_emails').get()).toMatchObject({last_error:'pdf_configuration',first_attempt_at:null});
    app.env.WDP_PDF_API_TOKEN='test-pdf-token';app.sql.exec('UPDATE wdp_registration_emails SET next_attempt_at=0');
    await deliverRegistrationEmails(app.env);expect(confirmations(app)).toHaveLength(1);
  });
  it('holds historical per-domain notifications without rewriting or resending them',async()=>{
    const app=setup(),customer=await app.customer(),admin=await app.customer('admin@example.com'),input=app.input();enable(app);enableEmails(app);await createPayment(app.context(app.request(input,customer.cookie)));await app.webhook(input);
    app.env.WDP_PDF_API_TOKEN=undefined;await update(app,admin.cookie,record(input.attemptId));
    const payload=JSON.parse(app.sql.prepare('SELECT payload_json FROM wdp_registration_emails').get()!.payload_json as string).email;delete payload._invoice;payload.subject='Old per-domain confirmation';
    app.sql.prepare('UPDATE wdp_registration_emails SET payload_json=?,next_attempt_at=0').run(JSON.stringify(payload));await deliverRegistrationEmails(app.env);
    expect(confirmations(app)).toHaveLength(0);expect(JSON.parse(app.sql.prepare('SELECT payload_json FROM wdp_registration_emails').get()!.payload_json as string)).toEqual(payload);
    expect(await (await update(app,admin.cookie,record(input.attemptId,'example.co.za',1))).json()).toMatchObject({emailStatus:'manual_review'});expect(confirmations(app)).toHaveLength(0);
  });
  it('requires test-email opt-in and never notifies pending, unpaid or invalid domains',async()=>{
    const app=setup(),customer=await app.customer(),admin=await app.customer('admin@example.com'),input=app.input();enable(app);app.env.WDP_REGISTRATION_EMAIL_ENABLED='true';await createPayment(app.context(app.request(input,customer.cookie)));
    expect((await update(app,admin.cookie,record(input.attemptId))).status).toBe(404);await app.webhook(input);
    await update(app,admin.cookie,record(input.attemptId));expect(confirmations(app)).toHaveLength(0);expect(app.sql.prepare('SELECT COUNT(*) AS n FROM wdp_registration_emails').get()!.n).toBe(0);
    enableEmails(app);
    expect((await update(app,admin.cookie,record(input.attemptId,'not-purchased.com'))).status).toBe(404);
    await update(app,admin.cookie,{...record(input.attemptId,'example.co.za',1),status:'issue',notes:'Checking details'});expect(confirmations(app)).toHaveLength(0);
  });
  it('holds uncertain old deliveries for review instead of risking a duplicate',async()=>{
    const app=setup(),customer=await app.customer(),admin=await app.customer('admin@example.com'),input=app.input();enable(app);enableEmails(app);await createPayment(app.context(app.request(input,customer.cookie)));await app.webhook(input);
    const original=app.provider.getMockImplementation()!;let failed=false;app.provider.mockImplementation(async(url,options)=>{if(String(url)==='https://api.resend.com/emails'&&!failed){failed=true;throw new Error('Private provider response must not be logged');}return original(url,options);});await update(app,admin.cookie,record(input.attemptId));
    expect(app.sql.prepare('SELECT last_error FROM wdp_registration_emails').get()!.last_error).toBe('delivery_uncertain');
    app.sql.prepare('UPDATE wdp_registration_emails SET next_attempt_at=0,first_attempt_at=?').run(Date.now()-24*60*60*1000);
    await deliverRegistrationEmails(app.env);expect(confirmations(app)).toHaveLength(1);expect(app.sql.prepare('SELECT last_error FROM wdp_registration_emails').get()!.last_error).toBe('manual_review');
  });
  it('rolls back registration and audit when its confirmation cannot be queued',async()=>{
    const app=setup(),customer=await app.customer(),admin=await app.customer('admin@example.com'),input=app.input();enable(app);enableEmails(app);await createPayment(app.context(app.request(input,customer.cookie)));await app.webhook(input);
    app.sql.exec('DROP TABLE wdp_registration_emails');
    expect((await update(app,admin.cookie,record(input.attemptId))).status).toBe(503);
    expect(app.sql.prepare('SELECT COUNT(*) AS n FROM wdp_domain_registrations').get()!.n).toBe(0);expect(app.sql.prepare('SELECT COUNT(*) AS n FROM wdp_registration_audit').get()!.n).toBe(0);expect(confirmations(app)).toHaveLength(0);
  });
  it('uses the production WDP reference and actual dates in live confirmation wording',()=>{
    const result=registrationMessage([{mode:'live',sequence:2412,registrations:[{domain:'example.com',status:'registered',registeredOn:'2026-11-14',expiresOn:'2029-11-14'}]}] as any,'https://webdesignpros.co.za');
    expect(result.subject).toBe('Your domain registrations are complete');expect(result.text).toContain('WDP-0002412');expect(result.text).toContain('Your domain registrations are complete.');expect(result.text).toContain('14 November 2029');expect(result.text).not.toContain('TEST');
  });
});
