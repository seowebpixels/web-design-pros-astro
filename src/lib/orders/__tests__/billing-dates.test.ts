import {describe,expect,it} from 'vitest';
import {nextBillingDate,purchasedServices} from '../services';
import type {OrderRow} from '../core';
describe('purchase-based billing dates',()=>{
  it('adds one calendar year, including a leap year in between',()=>{
    expect(nextBillingDate('2026-11-13 10:00:00','Annual')).toBe('2027-11-13');
    expect(nextBillingDate('2023-11-13 10:00:00','Annual')).toBe('2024-11-13');
    expect(nextBillingDate('2024-02-29 10:00:00','Annual')).toBe('2025-02-28');
  });
  it('uses the South African purchase date around UTC midnight',()=>{
    expect(nextBillingDate('2026-11-13 23:30:00','Annual')).toBe('2027-11-14');
    expect(nextBillingDate('2026-11-14T01:30:00+02:00','Annual')).toBe('2027-11-14');
  });
  it('keeps hosting monthly and clamps month-end dates',()=>{
    expect(nextBillingDate('2026-11-13 10:00:00','Monthly')).toBe('2026-12-13');
    expect(nextBillingDate('2027-01-31 10:00:00','Monthly')).toBe('2027-02-28');
  });
  it('uses original confirmed payment rather than order creation or the current date',()=>{
    const order={id:'test',sequence:1,mode:'test',payment_status:'paid',created_at:'2026-11-10 10:00:00',paid_at:'2026-11-13 10:00:00',cart_json:JSON.stringify({domains:[{domain:'example.com',cents:20000}],hosting:false})} as OrderRow;
    expect(purchasedServices(order)[0].nextDueDate).toBe('2027-11-13');
    expect(purchasedServices({...order,paid_at:null})[0].nextDueDate).toBe('2027-11-10');
    expect(nextBillingDate('invalid','Annual')).toBeNull();
  });
});
