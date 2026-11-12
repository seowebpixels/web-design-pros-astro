import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { runInNewContext } from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { clearPaidDomains } from '../cart';
import { readFileSync } from 'node:fs';
import { quote, requireTest, verifyWebhook, type PaymentEnv } from '../core';
import { createPayment, paymentStatus, paymentWebhook } from '../handlers';

const secret = 'whsec_' + btoa('a-test-webhook-signing-secret-only');
const attemptId = 'c837fdac-9b10-4ac0-a848-f74e2f955abc';
const accessToken = 'f6895d08-6025-434b-a20c-4bd691c50a47';
const input = {domains:['example.co.za'],hosting:true,termsAccepted:true,quotedAmount:13500,attemptId,accessToken};
function setup() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync('migrations/0001_payment_tests.sql','utf8'));
  function prepare(query: string, values: any[] = []): any {
    return {bind:(...args: any[])=>prepare(query,args),run:async()=>sql.prepare(query).run(...values),first:async()=>sql.prepare(query).get(...values) ?? null};
  }
  return {env:{WDP_PAYMENT_TEST_ENABLED:'true',YOCO_TEST_SECRET_KEY:'sk_test_example_not_real',YOCO_TEST_WEBHOOK_SECRET:secret,WDP_PAYMENT_DB:{prepare}} as unknown as PaymentEnv,sql};
}
function createRequest(body: any = input, origin = 'https://wdp.test') {
  return new Request('https://wdp.test/api/payments/create',{method:'POST',headers:{'Content-Type':'application/json',origin},body:JSON.stringify(body)});
}
async function signed(body: any, age = 0) {
  const raw = JSON.stringify(body), timestamp = String(Math.floor(Date.now()/1000)-age);
  const key = await crypto.subtle.importKey('raw',new TextEncoder().encode('a-test-webhook-signing-secret-only'),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature = await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`evt_1.${timestamp}.${raw}`));
  return new Request('https://wdp.test/api/payments/webhook',{method:'POST',headers:{'webhook-id':'evt_1','webhook-timestamp':timestamp,'webhook-signature':'v1,'+btoa(String.fromCharCode(...new Uint8Array(signature)))},body:raw});
}
const event = {type:'payment.succeeded',id:'evt_1',payload:{mode:'test',status:'succeeded',id:'payment_1',currency:'ZAR',amount:13500,metadata:{checkoutId:'checkout_1'}}};
function provider() { return vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({id:'checkout_1',processingMode:'test',redirectUrl:'https://c.yoco.com/checkout/test'}))); }
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('sandbox payment engine',()=>{
  it('calculates prices from server catalogue and refuses tampered/duplicate carts',()=>{
    expect(quote(input).amount).toBe(13500);
    expect(()=>quote({...input,quotedAmount:1})).toThrow('prices have changed');
    expect(()=>quote({...input,domains:['example.co.za','example.co.za']})).toThrow('duplicate');
    expect(()=>quote({...input,domains:['example.co.za.evil.com/path']})).toThrow('Invalid domain');
    expect(()=>quote({...input,termsAccepted:false})).toThrow('accept');
  });
  it('fails closed without configuration or with a live key',()=>{
    expect(()=>requireTest({})).toThrow();
    expect(()=>requireTest({...setup().env,YOCO_TEST_SECRET_KEY:'sk_live_never_allowed'})).toThrow();
  });
  it('rejects foreign origins and malformed requests without calling Yoco',async()=>{
    const {env}=setup();const fetch=provider();
    expect((await createPayment({request:createRequest(input,'https://evil.test'),env})).status).toBe(403);
    expect((await createPayment({request:createRequest(null),env})).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('creates a priced test checkout, reuses attempts and protects status',async()=>{
    const {env}=setup(); const fetch=provider();
    expect((await createPayment({request:createRequest(),env})).status).toBe(200);
    const payload=JSON.parse(fetch.mock.calls[0][1]!.body as string);
    expect(payload.amount).toBe(13500); expect(payload.successUrl).toContain('/payment/result/');
    expect(payload).not.toHaveProperty('password');
    expect((await createPayment({request:createRequest(),env})).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
    const statusRequest=new Request(`https://wdp.test/api/payments/status?attempt=${attemptId}`,{headers:{Authorization:`Bearer ${accessToken}`}});
    expect((await (await paymentStatus({request:statusRequest,env})).json()).status).toBe('pending');
    expect((await paymentStatus({request:new Request(`https://wdp.test/api/payments/status?attempt=${attemptId}`),env})).status).toBe(404);
    expect((await createPayment({request:createRequest({...input,hosting:false,quotedAmount:7500}),env})).status).toBe(409);
  });
  it('retries uncertain creation using the same provider idempotency key',async()=>{
    const {env}=setup(); const fetch=vi.spyOn(globalThis,'fetch').mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(new Response(JSON.stringify({id:'checkout_1',processingMode:'test',redirectUrl:'https://c.yoco.com/checkout/test'})));
    expect((await createPayment({request:createRequest(),env})).status).toBe(503);
    expect((await createPayment({request:createRequest(),env})).status).toBe(200);
    expect((fetch.mock.calls[0][1]!.headers as any)['Idempotency-Key']).toBe((fetch.mock.calls[1][1]!.headers as any)['Idempotency-Key']);
  });
  it('refuses live or malicious provider responses',async()=>{
    const {env}=setup();vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({id:'x',processingMode:'live',redirectUrl:'https://evil.test'})));
    expect((await createPayment({request:createRequest(),env})).status).toBe(502);
  });
  it('verifies signatures against raw body and rejects old timestamps',async()=>{
    const request=await signed(event);expect(await verifyWebhook(request,await request.clone().text(),secret)).toBe(true);
    expect(await verifyWebhook(request,'{}',secret)).toBe(false);
    const multiple = new Request(request.clone(),{headers:{...Object.fromEntries(request.headers),'webhook-signature':'v1,invalid% '+request.headers.get('webhook-signature')}});
    expect(await verifyWebhook(multiple,await request.clone().text(),secret)).toBe(true);
    const stale=await signed(event,181);expect(await verifyWebhook(stale,await stale.clone().text(),secret)).toBe(false);
  });
  it('only marks paid from signed matching test webhooks; duplicates and failure cannot downgrade paid',async()=>{
    const {env,sql}=setup();provider();await createPayment({request:createRequest(),env});
    expect((await paymentWebhook({request:new Request('https://wdp.test/api/payments/webhook',{method:'POST',body:JSON.stringify(event)}),env})).status).toBe(403);
    expect((await paymentWebhook({request:await signed({...event,payload:{...event.payload,amount:1}}),env})).status).toBe(400);
    expect((await paymentWebhook({request:await signed({...event,payload:{...event.payload,mode:'live'}}),env})).status).toBe(400);
    expect(sql.prepare('SELECT status FROM payment_tests').get()!.status).toBe('pending');
    expect((await paymentWebhook({request:await signed(event),env})).status).toBe(200);
    expect((await paymentWebhook({request:await signed(event),env})).status).toBe(200);
    await paymentWebhook({request:await signed({...event,type:'payment.failed',payload:{...event.payload,status:'failed'}}),env});
    expect(sql.prepare('SELECT status FROM payment_tests').get()!.status).toBe('paid');
    const verified = await (await paymentStatus({request:new Request(`https://wdp.test/api/payments/status?attempt=${attemptId}`,{headers:{Authorization:`Bearer ${accessToken}`}}),env})).json();
    expect(verified.paidDomains).toEqual(['example.co.za']);
    expect((await createPayment({request:createRequest(),env})).status).toBe(409);
  });
  it('requests redelivery if webhook beats checkout persistence',async()=>{
    const {env}=setup();expect((await paymentWebhook({request:await signed(event),env})).status).toBe(503);
  });
});


describe('simulated provider decline (local only)',()=>{
  async function decline() {
    const {env,sql}=setup(); const fetch=provider();
    expect((await createPayment({request:createRequest(),env})).status).toBe(200);
    const failure={...event,type:'payment.failed',payload:{...event.payload,status:'failed'}};
    expect((await paymentWebhook({request:await signed(failure),env})).status).toBe(200);
    const statusResponse=await paymentStatus({request:new Request(`https://wdp.test/api/payments/status?attempt=${attemptId}`,{headers:{Authorization:`Bearer ${accessToken}`}}),env});
    const result=await statusResponse.json();
    return {env,sql,fetch,result};
  }
  it('records a signed decline as failed and allows a new payment attempt without marking it paid',async()=>{
    const {env,sql,fetch,result}=await decline();
    expect(result.status).toBe('failed');expect(result.paidDomains).toEqual([]);
    expect(sql.prepare('SELECT payment_id FROM payment_tests').get()!.payment_id).toBeNull();
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({id:'checkout_retry',processingMode:'test',redirectUrl:'https://c.yoco.com/checkout/retry'})));
    const retry={...input,attemptId:crypto.randomUUID(),accessToken:crypto.randomUUID()};
    expect((await createPayment({request:createRequest(retry),env})).status).toBe(200);
    expect(sql.prepare('SELECT status FROM payment_tests WHERE id=?').get(attemptId)!.status).toBe('failed');
    expect(sql.prepare('SELECT status FROM payment_tests WHERE id=?').get(retry.attemptId)!.status).toBe('pending');
  });
  it('runs the actual return-page script against the failed result: shows an error, retains cart and permits retry',async()=>{
    const {fetch,result}=await decline();
    const cart=JSON.stringify([{domain:'example.co.za',registrationPrice:75}]);
    const localValues=new Map([['cart_domains',cart]]);
    const sessionValues=new Map([['wdp_payment_attempt',JSON.stringify({attemptId,accessToken})]]);
    const makeStorage=(values:Map<string,string>)=>({getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)});
    const elements=new Map<string,any>();
    for (const id of ['result-title','result-message','check-payment','result-reference']) elements.set(id,{textContent:'',hidden:false,disabled:false,addEventListener:vi.fn()});
    vi.stubGlobal('document',{getElementById:(id:string)=>elements.get(id)});
    vi.stubGlobal('location',{search:`?attempt=${attemptId}&outcome=failure`});
    vi.stubGlobal('window',{addEventListener:vi.fn(),dispatchEvent:vi.fn()});
    vi.stubGlobal('localStorage',makeStorage(localValues));
    vi.stubGlobal('sessionStorage',makeStorage(sessionValues));
    fetch.mockResolvedValueOnce(new Response(JSON.stringify(result)));
    const source=readFileSync('src/scripts/payment-result.ts','utf8').replace(/^import .*;\r?\n/,'');
    runInNewContext(stripTypeScriptTypes(source),{clearPaidDomains,URLSearchParams,AbortSignal,Intl,JSON,Error,setTimeout,clearTimeout,fetch,document:globalThis.document,location:globalThis.location,window:globalThis.window,localStorage:globalThis.localStorage,sessionStorage:globalThis.sessionStorage});
    await vi.waitFor(()=>expect(elements.get('result-title').textContent).toBe('Payment unsuccessful'));
    expect(elements.get('result-message').textContent).toContain('Return to checkout to try again');
    expect(localValues.get('cart_domains')).toBe(cart);
    expect(JSON.parse(sessionValues.get('wdp_payment_attempt')!).completed).toBe(true);
    expect(elements.get('check-payment').disabled).toBe(false);
  });
});
