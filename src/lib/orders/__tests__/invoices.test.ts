import {describe,it,expect} from 'vitest';
import {consolidatedInvoice} from '../invoices';
import type {OrderRow} from '../core';

function purchase(sequence:number,cents:number,years=1):OrderRow{return {id:'purchase-'+sequence,sequence,mode:'test',payment_status:'paid',paid_at:'2026-11-'+(10+sequence)+' 10:00:00',created_at:'2026-11-01 10:00:00',amount:cents,currency:'ZAR',cart_json:JSON.stringify({domains:[{domain:'example'+sequence+'.com',cents,years}]}),billing_json:JSON.stringify({firstName:'Buyer',lastName:'Customer',address:'Saved address '+sequence})} as OrderRow;}
describe('one invoice for a client completion group',()=>{
  it('lists all original purchases and complete-term amounts under one stable reference',()=>{
    const first=purchase(1,73000,3),second=purchase(2,9500),invoice=consolidatedInvoice([second,first],'2026-11-14 12:00:00');
    expect(invoice).toMatchObject({id:first.id,reference:'WDP-TEST-0000001',issuedAt:'2026-11-14 12:00:00',paidAt:second.paid_at,orderCount:2,total:82500,amount:82500,amountPaid:82500,balanceDue:0,billing:{address:'Saved address 2'},seller:{name:'Web Design Pros (Pty) Ltd',registrationNumber:'2026/282129/07'}});
    expect(invoice.lines).toEqual([{description:'Domain registration: example1.com · WDP-TEST-0000001',period:'3 years',amount:73000},{description:'Domain registration: example2.com · WDP-TEST-0000002',period:'1 year',amount:9500}]);
    expect(invoice.sourceOrders.map(order=>order.reference)).toEqual(['WDP-TEST-0000001','WDP-TEST-0000002']);
  });
  it('keeps a single-purchase invoice unchanged apart from the legal company name',()=>{
    const order=purchase(1,21000),invoice=consolidatedInvoice([order],'2026-11-14 12:00:00');
    expect(invoice.issuedAt).toBe(order.paid_at);expect(invoice.lines[0].description).toBe('Domain registration: example1.com');expect(invoice.orderCount).toBe(1);
  });
  it('refuses empty, duplicate, mixed-mode or unpaid groups',()=>{
    expect(()=>consolidatedInvoice([],'2026-11-14')).toThrow('could not be verified');
    expect(()=>consolidatedInvoice([purchase(1,21000),purchase(1,21000)],'2026-11-14')).toThrow('could not be verified');
    expect(()=>consolidatedInvoice([purchase(1,21000),{...purchase(2,21000),mode:'live'}],'2026-11-14')).toThrow('could not be verified');
    expect(()=>consolidatedInvoice([{...purchase(1,21000),payment_status:'pending'}],'2026-11-14')).toThrow('Invoice not found');
  });
  it('rejects unsafe combined totals',()=>{
    expect(()=>consolidatedInvoice([purchase(1,Number.MAX_SAFE_INTEGER),purchase(2,Number.MAX_SAFE_INTEGER)],'2026-11-14')).toThrow('totals could not be verified');
  });
});
