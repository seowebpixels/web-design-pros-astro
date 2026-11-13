import {describe,expect,it} from 'vitest';
import {domainCatalogue,priceForHostname} from '../../domains/catalogue';
import {quote} from '../../payments/core';
describe('approved retail domain catalogue',()=>{
  it('uses only the two approved TLDs and keeps free transfer as zero',()=>{
    expect(domainCatalogue.map(price=>price.tld)).toEqual(['co.za','com']);
    expect(priceForHostname('EXAMPLE.CO.ZA')).toMatchObject({category:'Other',registrationCents:7500,transferCents:0,renewalCents:12500,years:1});
    expect(priceForHostname('example.com')).toMatchObject({category:'Popular',registrationCents:20000,transferCents:23000,renewalCents:26500,years:1});
    expect(priceForHostname('example.org')).toBeNull();expect(priceForHostname('example.com.evil')).toBeNull();
  });
  it('uses catalogue registration prices on the server and rejects unpriced extensions',()=>{
    const input={domains:['example.com'],hosting:false,termsAccepted:true,quotedAmount:20000};
    expect(quote(input).amount).toBe(20000);expect(()=>quote({...input,domains:['example.org']})).toThrow('Pricing');
    expect(()=>quote({...input,quotedAmount:1})).toThrow('prices have changed');
  });
});
