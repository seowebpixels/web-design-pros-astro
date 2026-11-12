import { describe, expect, it } from 'vitest';
import { clearPaidDomains } from '../cart';

function storage(initial: Record<string,string> = {}) {
  const values = new Map(Object.entries(initial));
  return {getItem:(key:string)=>values.get(key) ?? null,setItem:(key:string,value:string)=>{values.set(key,value);}};
}
const paid = {status:'paid',paidDomains:['paid.co.za']};
describe('cart after verified payment',()=>{
  it('removes paid domains and immediately notifies the header',()=>{
    const local=storage({cart_domains:JSON.stringify([{domain:'paid.co.za'}])}),session=storage();let notified=0;
    clearPaidDomains(paid,{},local,session,()=>notified++);
    expect(JSON.parse(local.getItem('cart_domains')!)).toEqual([]); expect(notified).toBe(1);
    expect(JSON.parse(session.getItem('wdp_payment_attempt')!).cartCleared).toBe(true);
  });
  it('preserves domains added separately during payment',()=>{
    const local=storage({cart_domains:JSON.stringify([{domain:'PAID.co.za'},{domain:'another.com',registrationPrice:200}])});
    clearPaidDomains(paid,{},local,storage(),()=>{});
    expect(JSON.parse(local.getItem('cart_domains')!)).toEqual([{domain:'another.com',registrationPrice:200}]);
  });
  it.each(['pending','failed','cancelled'])('does not change the cart when status is %s',(status)=>{
    const local=storage({cart_domains:'[{"domain":"paid.co.za"}]'}),session=storage();
    clearPaidDomains({...paid,status},{},local,session,()=>{throw new Error('must not notify');});
    expect(local.getItem('cart_domains')).toBe('[{"domain":"paid.co.za"}]');
    expect(session.getItem('wdp_payment_attempt')).toBeNull();
  });
  it('does not clear newly added items when revisiting a completed receipt',()=>{
    const local=storage({cart_domains:'[{"domain":"paid.co.za"}]'}),session=storage();
    clearPaidDomains(paid,{},local,session,()=>{});
    local.setItem('cart_domains','[{"domain":"paid.co.za"}]');
    clearPaidDomains(paid,JSON.parse(session.getItem('wdp_payment_attempt')!),local,session,()=>{throw new Error('must not notify');});
    expect(local.getItem('cart_domains')).toBe('[{"domain":"paid.co.za"}]');
  });
  it('retains the cart and permits retry if storage is blocked',()=>{
    const attempt: {cartCleared?:boolean}={};
    const blocked={getItem:()=> '[{"domain":"paid.co.za"}]',setItem:()=>{throw new Error('Storage blocked');}};
    expect(()=>clearPaidDomains(paid,attempt,blocked,storage(),()=>{})).toThrow('Storage blocked');
    expect(attempt.cartCleared).toBeUndefined();
  });
  it('does not clear anything without the server-provided paid items',()=>{
    const local=storage({cart_domains:'[{"domain":"paid.co.za"}]'});
    expect(()=>clearPaidDomains({status:'paid'},{},local,storage(),()=>{})).toThrow('identified');
    expect(local.getItem('cart_domains')).toBe('[{"domain":"paid.co.za"}]');
  });
});
