import { validateDomain } from '../domains/validateDomain';

export interface PaymentEnv {
  WDP_PAYMENT_TEST_ENABLED?: string;
  YOCO_TEST_SECRET_KEY?: string;
  YOCO_TEST_WEBHOOK_SECRET?: string;
  WDP_PAYMENT_DB?: D1Database;
}
export class PaymentError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {status, headers: {'content-type':'application/json', 'cache-control':'no-store', 'x-content-type-options':'nosniff'}});
}
export function requireTest(env: PaymentEnv) {
  if (env.WDP_PAYMENT_TEST_ENABLED !== 'true' || !env.YOCO_TEST_SECRET_KEY?.startsWith('sk_test_') || !env.YOCO_TEST_WEBHOOK_SECRET?.startsWith('whsec_') || !env.WDP_PAYMENT_DB)
    throw new PaymentError(503, 'Test payments are not configured yet. Please contact WDP.');
  return env.WDP_PAYMENT_DB;
}
export async function readBody(request: Request, limit = 16000) {
  if (Number(request.headers.get('content-length')) > limit) throw new PaymentError(413, 'Request too large.');
  const reader = request.body?.getReader();
  if (!reader) throw new PaymentError(400, 'Request body required.');
  let size = 0; const chunks: Uint8Array[] = [];
  for (;;) {
    const {done, value} = await reader.read(); if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); throw new PaymentError(413, 'Request too large.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}
export async function hash(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2,'0')).join('');
}
export const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const prices: Record<string, number> = {'co.za':7500,'org.za':9500,'com':20000,'org':20000,'net':20000,'shop':20000,'info':20000,'biz':20000,'co.uk':20000,'io':20000};
export function quote(input: any) {
  if (!Array.isArray(input.domains) || input.domains.length < 1 || input.domains.length > 10 || typeof input.hosting !== 'boolean' || input.termsAccepted !== true)
    throw new PaymentError(400, 'Select 1–10 domains and accept the Terms of Service.');
  const domains = input.domains.map((domain: unknown) => {
    if (typeof domain !== 'string') throw new PaymentError(400, 'Invalid domain.');
    const result = validateDomain(domain.toLowerCase());
    if (!result.valid || !result.hostname) throw new PaymentError(400, 'Invalid domain.');
    const suffix = Object.keys(prices).sort((a,b) => b.length-a.length).find(s => result.hostname!.endsWith(`.${s}`));
    if (!suffix) throw new PaymentError(400, 'This domain extension is not available for checkout.');
    return {domain:result.hostname, cents:prices[suffix]};
  }).sort((a: any,b: any) => a.domain.localeCompare(b.domain));
  if (new Set(domains.map((d: any) => d.domain)).size !== domains.length) throw new PaymentError(400, 'Remove duplicate domains.');
  const amount = domains.reduce((sum: number,d: any) => sum+d.cents, input.hosting ? 6000 : 0);
  if (input.quotedAmount !== amount) throw new PaymentError(409, 'Your cart prices have changed. Search for your domains again before paying.');
  return {amount, cart:JSON.stringify({domains,hosting:input.hosting})};
}
export function paymentRedirect(value: unknown): value is string {
  try { const url = new URL(String(value)); return url.protocol === 'https:' && (url.hostname === 'yoco.com' || url.hostname.endsWith('.yoco.com')) && !url.username && !url.password && !url.port; } catch { return false; }
}
export async function verifyWebhook(request: Request, raw: string, secret: string, now = Date.now()) {
  const id = request.headers.get('webhook-id');
  const timestamp = request.headers.get('webhook-timestamp');
  if (!id || !timestamp || !/^\d+$/.test(timestamp) || Math.abs(now/1000-Number(timestamp)) > 180) return false;
  try {
    const key = await crypto.subtle.importKey('raw', Uint8Array.from(atob(secret.slice(6)), c => c.charCodeAt(0)), {name:'HMAC',hash:'SHA-256'}, false, ['verify']);
    const content = new TextEncoder().encode(`${id}.${timestamp}.${raw}`);
    for (const part of (request.headers.get('webhook-signature') || '').split(' ')) {
      if (!part.startsWith('v1,')) continue;
      try {
        const signature = Uint8Array.from(atob(part.slice(3)), c => c.charCodeAt(0));
        if (await crypto.subtle.verify('HMAC', key, signature, content)) return true;
      } catch { /* Ignore malformed signatures; another v1 signature may be valid. */ }
    }
  } catch { return false; }
  return false;
}
