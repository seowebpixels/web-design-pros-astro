import {describe,expect,it} from 'vitest';
import {domainCatalogue,priceForHostname,termPriceCents,cartTermCents,rand} from '../../domains/catalogue';
import {quote} from '../../payments/core';
describe('approved retail domain catalogue',()=>{
  it('uses only the two approved TLDs and keeps free transfer as zero',()=>{
    expect(domainCatalogue.map(price=>price.tld)).toEqual(['co.za','com']);
    expect(priceForHostname('EXAMPLE.CO.ZA')).toMatchObject({category:'Other',registrationCents:9500,transferCents:0,renewalCents:17000,years:1});
    expect(priceForHostname('example.com')).toMatchObject({category:'Popular',registrationCents:21000,transferCents:23500,renewalCents:46000,years:1});
    expect(priceForHostname('example.org')).toBeNull();expect(priceForHostname('example.com.evil')).toBeNull();
  });
  it('uses catalogue registration prices on the server and rejects unpriced extensions',()=>{
    const input={domains:['example.com'],hosting:false,termsAccepted:true,quotedAmount:21000};
    expect(quote(input).amount).toBe(21000);expect(()=>quote({...input,domains:['example.org']})).toThrow('Pricing');
    expect(()=>quote({...input,quotedAmount:1})).toThrow('prices have changed');
  });
  it('adds each separate annual charge when prepaying a term',()=>{
    expect([1,2,3,4,5].map(years=>termPriceCents(domainCatalogue[0],years))).toEqual([9500,26500,52500,87500,135500]);
    expect([1,2,3,4,5].map(years=>termPriceCents(domainCatalogue[1],years))).toEqual([21000,67000,140000,235000,355000]);
    expect(cartTermCents({domain:'example.com',selectedYears:2,registrationPrice:1})).toBe(67000);
    expect(rand(67000)).toBe('R670');
  });
  it('prices mixed terms on the server and refuses tampered periods or totals',()=>{
    const input={domains:[{domain:'example.co.za',years:2},{domain:'example.com',years:3}],hosting:false,termsAccepted:true,quotedAmount:166500};
    const result=quote(input);expect(result.amount).toBe(166500);expect(JSON.parse(result.cart).domains.find(item=>item.domain==='example.com')).toMatchObject({cents:140000,years:3});
    expect(()=>quote({...input,quotedAmount:1})).toThrow('prices have changed');
    for(const years of [0,6,-1,1.5,'2',null])expect(()=>quote({...input,domains:[{domain:'example.com',years}]})).toThrow('between 1 and 5');
  });
});
