import {describe,it,expect,vi,afterEach} from 'vitest';
import {readFileSync} from 'node:fs';
import {invoiceHtml,invoiceAttachment} from '../invoice-pdf';
import {invoiceDetail} from '../invoices';
const invoice=()=>invoiceDetail({id:'purchase-id',mode:'test',sequence:1,payment_status:'paid',paid_at:'2026-11-14 10:00:00',created_at:'2026-11-14 09:00:00',amount:73000,currency:'ZAR',cart_json:JSON.stringify({domains:[{domain:'example.com',years:3,cents:73000}]}),billing_json:JSON.stringify({firstName:'<img src="https://evil.test/">',lastName:'Customer',email:'customer@example.com',address:'Original street'})} as any);
function environment(){
  const template=readFileSync('src/pages/dashboard/invoice.astro','utf8').replace(/^---[\s\S]*?---/,'').replace(/<img src=\{logo.src\}[^>]+>/,'<img src="/_astro/logo.avif" alt="Web Design Pros">');
  const assets=vi.fn(async(request:Request)=>new Response(new URL(request.url).pathname==='/dashboard/invoice/'?'<html><head><title>Invoice</title><link rel="stylesheet" href="/_astro/invoice.css"></head><body>'+template+'</body></html>':new URL(request.url).pathname.endsWith('.css')?'body {color:black}':'logo',{headers:{'content-type':'image/avif'}}));
  return {AUTH_BASE_URL:'https://wdp.test',ASSETS:{fetch:assets},WDP_PDF_ACCOUNT_ID:'a'.repeat(32),WDP_PDF_API_TOKEN:'private-pdf-token'};
}
afterEach(()=>vi.restoreAllMocks());
describe('existing invoice PDF attachment',()=>{
  it('uses the original invoice and safe text, preserving styles, dates, totals and company footer',async()=>{
    const env=environment(),html=await invoiceHtml(env,invoice());
    expect(html).toContain('WDP-TEST-0000001');expect(html).toContain('Domain registration: example.com');expect(html).toContain('3 years');expect(html).toContain('R730');expect(html).toContain('14 November 2026');expect(html).toContain('2026/282129/07');expect(html.match(/Web Design Pros \(Pty\) Ltd/g)).toHaveLength(2);expect(html).toContain('background:#000000');expect(html).toContain('@media print');expect(html).toContain('data:image/avif;base64,');
    expect(html).toContain('&lt;img src=');expect(html).not.toMatch(/<script|<iframe|<DashboardLayout/i);expect(html).not.toContain('Loading your invoice');expect(html).not.toContain('No VAT');
    for(const [request] of env.ASSETS.fetch.mock.calls){expect(new URL(request.url).origin).toBe('https://wdp.test');expect([...request.headers]).toEqual([]);}
  });
  it('sends only the populated HTML to the fixed renderer and encodes the attachment',async()=>{
    const env=environment(),fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('%PDF-1.7\nsample'));
    const attachment=await invoiceAttachment(env,invoice());
    expect(attachment.filename).toBe('WDP-TEST-0000001.pdf');expect(atob(attachment.content)).toBe('%PDF-1.7\nsample');
    const [url,options]=fetch.mock.calls[0];expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/'+env.WDP_PDF_ACCOUNT_ID+'/browser-run/pdf');
    const payload=JSON.parse(options!.body as string);expect(payload).not.toHaveProperty('url');expect(payload.html).not.toContain('private-pdf-token');expect(payload.pdfOptions).toMatchObject({printBackground:true,preferCSSPageSize:true,displayHeaderFooter:false});
  });
  it.each(['{}','<html>Error</html>'])('rejects a non-PDF response instead of emailing a broken attachment',async(body)=>{
    vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(body));await expect(invoiceAttachment(environment(),invoice())).rejects.toThrow('pdf_render');
  });
  it('bounds attachment storage and rejects external stylesheet or image sources',async()=>{
    vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('%PDF-'+ 'x'.repeat(900000)));await expect(invoiceAttachment(environment(),invoice())).rejects.toThrow('pdf_size');
    const env=environment();env.ASSETS.fetch.mockImplementation(async()=>new Response('<html><head><title>Invoice</title><link rel="stylesheet" href="https://other.test/x.css"></head><body>'+readFileSync('src/pages/dashboard/invoice.astro','utf8').replace(/^---[\s\S]*?---/,'')+'</body></html>'));
    await expect(invoiceHtml(env,invoice())).rejects.toThrow('pdf_asset');
  });
});
