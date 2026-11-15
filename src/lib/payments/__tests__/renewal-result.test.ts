import {afterEach,describe,expect,it,vi} from 'vitest';
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
describe('renewal payment receipt',()=>{
 it('finishes the renewal attempt without removing anything from the new-domain cart',async()=>{
  const nodes=new Map<string,any>();const node=(id:string)=>{if(!nodes.has(id))nodes.set(id,{textContent:'',hidden:false,disabled:false,addEventListener:vi.fn(),href:''});return nodes.get(id);};
  const attempt={kind:'renewal',attemptId:'test-attempt',accessToken:'test-access'},session={getItem:vi.fn(()=>JSON.stringify(attempt)),setItem:vi.fn()},cart={getItem:vi.fn(),setItem:vi.fn()};
  vi.stubGlobal('document',{getElementById:node});vi.stubGlobal('location',{search:'?attempt=test-attempt&outcome=success'});vi.stubGlobal('sessionStorage',session);vi.stubGlobal('localStorage',cart);vi.stubGlobal('window',{addEventListener:vi.fn(),dispatchEvent:vi.fn()});
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({kind:'renewal',status:'paid',reference:'WDP-TEST-0000002',amount:17000,paidDomains:[]}))));
  await import('../../../scripts/payment-result');
  await vi.waitFor(()=>expect(node('check-payment').hidden).toBe(true));
  expect(cart.getItem).not.toHaveBeenCalled();expect(cart.setItem).not.toHaveBeenCalled();expect(JSON.parse(session.setItem.mock.calls[0][1]).completed).toBe(true);
  expect(node('result-message').textContent).toContain('expiry date has not changed');expect(node('result-return').href).toBe('/dashboard/domains/');
 });
});
