import {afterEach,describe,expect,it,vi} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createAuth} from '../../accounts/auth';
import {createPayment,paymentStatus,paymentWebhook} from '../../payments/handlers';
import {saveTestOrder,orderReference} from '../core';
import {onRequestGet as ordersEndpoint} from '../../../../functions/api/customer/orders';
import {onRequestGet as servicesEndpoint} from '../../../../functions/api/customer/services';
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
  payments.exec(readFileSync('migrations/0001_payment_tests.sql','utf8'));
  const env={DB:database(sql),WDP_PAYMENT_DB:database(payments),WDP_ACCOUNTS_ENABLED:'true',AUTH_SECRET:'test-only-account-secret-at-least-thirty-two-characters',AUTH_BASE_URL:'https://wdp.test',AUTH_FROM_EMAIL:'WDP <accounts@example.com>',RESEND_API_KEY:'test-only',WDP_PAYMENT_TEST_ENABLED:'true',YOCO_TEST_SECRET_KEY:'sk_test_only',YOCO_TEST_WEBHOOK_SECRET:secret} as PaymentEnv;
  const tasks:Promise<unknown>[]=[];const waitUntil=(task:Promise<unknown>)=>tasks.push(task),mail:any[]=[],checkouts:any[]=[];
  const provider=vi.spyOn(globalThis,'fetch').mockImplementation(async(url,options)=>{
    const body=JSON.parse(options!.body as string);
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
  const input=(id=crypto.randomUUID())=>({attemptId:id,accessToken:crypto.randomUUID(),domains:['example.co.za'],hosting:true,quotedAmount:13500,termsAccepted:true,registrant:{sameAsBilling:true}});
  const request=(input:any,cookie:string)=>new Request('https://wdp.test/api/payments/create',{method:'POST',headers:{Cookie:cookie,Origin:'https://wdp.test','Content-Type':'application/json'},body:JSON.stringify(input)});
  const context=(request:Request)=>({request,env,waitUntil}) as any;
  async function webhook(input:any,status='succeeded',amount=13500){
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
    const app=setup(),customer=await app.customer(),first=app.input(),second=app.input(),priced={cart:JSON.stringify({domains:[{domain:'example.co.za',cents:7500}],hosting:true}),amount:13500};
    const result=await Promise.all([saveTestOrder(app.env,customer.user,first,priced,'hash1'),saveTestOrder(app.env,customer.user,second,priced,'hash2'),saveTestOrder(app.env,customer.user,first,priced,'hash1')]);
    expect(result.map(order=>order.sequence)).toEqual([1,2,1]);expect(app.sql.prepare("SELECT next_value FROM wdp_order_sequences WHERE mode='test'").get()!.next_value).toBe(3);
  });
  it('paginates only the signed-in customer orders without leaking private payment access data',async()=>{
    const app=setup(),customer=await app.customer(),other=await app.customer('second@example.com');
    const priced={cart:JSON.stringify({domains:[{domain:'example.co.za',cents:7500}],hosting:true}),amount:13500};
    for(let i=0;i<27;i++)await saveTestOrder(app.env,customer.user,app.input(),priced,'private-hash');
    await saveTestOrder(app.env,other.user,app.input(),priced,'other-private-hash');
    const get=(query='')=>ordersEndpoint(app.context(new Request('https://wdp.test/api/customer/orders'+query,{headers:{Cookie:customer.cookie}})));
    const first=await (await get()).json();expect(first.orders).toHaveLength(25);expect(first.nextBefore).toBe(3);expect(first.orderCount).toBe(27);
    expect(JSON.stringify(first)).not.toContain('private-hash');expect(first.orders[0]).not.toHaveProperty('billing');
    const second=await (await get('?before='+first.nextBefore)).json();expect(second.orders).toHaveLength(2);expect(second.nextBefore).toBeNull();
    expect(new Set([...first.orders,...second.orders].map(order=>order.id)).size).toBe(27);
    expect((await get('?before=invalid')).status).toBe(400);
  });
  it('shows only paid customer services, preserves quoted renewal prices and never invents registration or due dates',async()=>{
    const app=setup(),customer=await app.customer(),other=await app.customer('second@example.com'),input=app.input();
    await createPayment(app.context(app.request(input,customer.cookie)));
    const get=(cookie:string)=>servicesEndpoint(app.context(new Request('https://wdp.test/api/customer/services',{headers:{Cookie:cookie}})));
    expect((await (await get(customer.cookie)).json()).services).toHaveLength(0);
    await app.webhook(input);
    const response=await get(customer.cookie),result=await response.json();expect(response.headers.get('cache-control')).toBe('no-store');
    expect(result.serviceCount).toBe(2);expect(result.services[0]).toMatchObject({product:'Domain Registration',domain:'example.co.za',recurringCents:12500,paidCents:7500,status:'test_purchase',nextDueDate:null,priceSource:'purchase'});
    expect(result.services[1]).toMatchObject({product:'Starter Hosting',recurringCents:6000,cycle:'Monthly',status:'test_purchase',nextDueDate:null});
    expect(JSON.stringify(result)).not.toContain('access_hash');expect((await (await get(other.cookie)).json()).services).toHaveLength(0);expect((await get('')).status).toBe(401);
    const prices=JSON.parse(app.sql.prepare('SELECT prices_json FROM wdp_order_prices WHERE order_id=?').get(input.attemptId)!.prices_json as string);prices[0].renewalCents=14000;
    app.sql.prepare('UPDATE wdp_order_prices SET prices_json=? WHERE order_id=?').run(JSON.stringify(prices),input.attemptId);
    expect((await (await get(customer.cookie)).json()).services[0].recurringCents).toBe(14000);
    app.sql.prepare('DELETE FROM wdp_order_prices WHERE order_id=?').run(input.attemptId);
    expect((await (await get(customer.cookie)).json()).services[0]).toMatchObject({recurringCents:12500,priceSource:'current_catalogue'});
  });
});
