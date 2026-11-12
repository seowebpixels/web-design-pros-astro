import { PaymentError, hash, json, paymentRedirect, quote, readBody, requireTest, uuid, verifyWebhook, type PaymentEnv } from './core';

type Context = {request:Request; env:PaymentEnv};
type Row = {id:string; access_hash:string; cart_json:string; amount:number; checkout_id:string|null; redirect_url:string|null; status:string};
function failure(error: unknown) {
  return error instanceof PaymentError ? json({error:error.message},error.status) : json({error:'Payment service unavailable. Please retry shortly.'},503);
}
export async function createPayment({request,env}: Context) {
  try {
    const db = requireTest(env);
    if (request.headers.get('origin') !== new URL(request.url).origin) throw new PaymentError(403,'Request not permitted.');
    if (!request.headers.get('content-type')?.includes('application/json')) throw new PaymentError(415,'JSON required.');
    let input: any;
    try { input = JSON.parse(await readBody(request)); } catch (e) { if (e instanceof PaymentError) throw e; throw new PaymentError(400,'Invalid request.'); }
    if (!uuid(input?.attemptId) || !uuid(input?.accessToken)) throw new PaymentError(400,'Invalid payment attempt.');
    const {amount,cart} = quote(input);
    const accessHash = await hash(input.accessToken);
    await db.prepare('INSERT OR IGNORE INTO payment_tests (id,access_hash,cart_json,amount) VALUES (?,?,?,?)').bind(input.attemptId,accessHash,cart,amount).run();
    const order = await db.prepare('SELECT * FROM payment_tests WHERE id=?').bind(input.attemptId).first<Row>();
    if (!order || order.access_hash !== accessHash || order.cart_json !== cart || order.amount !== amount) throw new PaymentError(409,'This payment attempt belongs to another cart. Start a new attempt.');
    if (order.status === 'paid') throw new PaymentError(409,'This test payment is already confirmed.');
    if (order.redirect_url && paymentRedirect(order.redirect_url)) return json({redirectUrl:order.redirect_url,attemptId:order.id});
    // All URLs and references are fixed by the server. Passwords and card data are never accepted.
    const origin = new URL(request.url).origin;
    const result = await fetch('https://payments.yoco.com/api/checkouts', {
      method:'POST', signal:AbortSignal.timeout(15000), headers:{'Authorization':`Bearer ${env.YOCO_TEST_SECRET_KEY}`,'Content-Type':'application/json','Idempotency-Key':order.id},
      body:JSON.stringify({amount,currency:'ZAR',successUrl:`${origin}/payment/result/?outcome=success&attempt=${order.id}`,cancelUrl:`${origin}/payment/result/?outcome=cancel&attempt=${order.id}`,failureUrl:`${origin}/payment/result/?outcome=failure&attempt=${order.id}`,metadata:{wdpTestAttempt:order.id},externalId:order.id})
    });
    if (!result.ok) throw new PaymentError(502,'Unable to start test payment. Please retry; your cart is unchanged.');
    const checkout: any = await result.json();
    if (typeof checkout.id !== 'string' || checkout.processingMode !== 'test' || !paymentRedirect(checkout.redirectUrl)) throw new PaymentError(502,'The payment provider did not return a valid test checkout.');
    await db.prepare('UPDATE payment_tests SET checkout_id=?,redirect_url=? WHERE id=?').bind(checkout.id,checkout.redirectUrl,order.id).run();
    return json({redirectUrl:checkout.redirectUrl,attemptId:order.id});
  } catch (error) { return failure(error); }
}
export async function paymentStatus({request,env}: Context) {
  try {
    const db = requireTest(env);
    const id = new URL(request.url).searchParams.get('attempt');
    const token = request.headers.get('authorization')?.replace(/^Bearer /,'');
    if (!uuid(id) || !uuid(token)) throw new PaymentError(404,'Payment attempt not found.');
    const order = await db.prepare('SELECT * FROM payment_tests WHERE id=? AND access_hash=?').bind(id,await hash(token)).first<Row>();
    if (!order) throw new PaymentError(404,'Payment attempt not found.');
    return json({status:order.status,amount:order.amount,currency:'ZAR',mode:'test',reference:order.id,paidDomains:order.status === 'paid' ? JSON.parse(order.cart_json).domains.map((item: {domain:string}) => item.domain) : []});
  } catch(error) { return failure(error); }
}
export async function paymentWebhook({request,env}: Context) {
  try {
    const db = requireTest(env);
    const raw = await readBody(request,64000);
    if (!await verifyWebhook(request,raw,env.YOCO_TEST_WEBHOOK_SECRET!)) throw new PaymentError(403,'Invalid signature.');
    let event: any;
    try { event = JSON.parse(raw); } catch { throw new PaymentError(400,'Invalid event.'); }
    if (!['payment.succeeded','payment.failed'].includes(event?.type)) return json({received:true});
    const payload = event.payload;
    if (payload?.mode !== 'test') throw new PaymentError(400,'Only test payments are accepted.');
    const checkoutId = payload?.metadata?.checkoutId;
    if (typeof checkoutId !== 'string') throw new PaymentError(400,'Missing checkout reference.');
    const order = await db.prepare('SELECT * FROM payment_tests WHERE checkout_id=?').bind(checkoutId).first<Row>();
    // A notification can beat the create-checkout database update. A non-2xx response requests retry.
    if (!order) throw new PaymentError(503,'Checkout is not ready. Retry this notification.');
    if (payload.currency !== 'ZAR' || payload.amount !== order.amount || typeof payload.id !== 'string') throw new PaymentError(400,'Payment does not match order.');
    if (event.type === 'payment.succeeded' && payload.status === 'succeeded') {
      await db.prepare("UPDATE payment_tests SET status='paid',payment_id=? WHERE id=? AND status!='paid'").bind(payload.id,order.id).run();
    } else if (event.type === 'payment.failed' && payload.status === 'failed') {
      await db.prepare("UPDATE payment_tests SET status='failed' WHERE id=? AND status!='paid'").bind(order.id).run();
    }
    // Replayed notifications are harmless; paid is never downgraded. No fulfilment is triggered in test mode.
    return json({received:true});
  } catch(error) { return failure(error); }
}
