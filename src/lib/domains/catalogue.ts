export interface DomainPrice {tld:string;category:string;hot:boolean;years:number;registrationCents:number;transferCents:number;renewalCents:number}
// Owner-approved retail prices. Keep money as integer cents; unlisted TLDs have no checkout price.
export const domainCatalogue:readonly DomainPrice[]=[
  {tld:'co.za',category:'Other',hot:true,years:1,registrationCents:7500,transferCents:0,renewalCents:12500},
  {tld:'com',category:'Popular',hot:true,years:1,registrationCents:20000,transferCents:23000,renewalCents:26500}
];
const longestSuffixFirst=[...domainCatalogue].sort((a,b)=>b.tld.length-a.tld.length);
export function priceForHostname(hostname:string):DomainPrice|null{
  const name=hostname.toLowerCase().replace(/\.$/,'');
  return longestSuffixFirst.find(price=>name.endsWith('.'+price.tld))??null;
}
export const rand=(cents:number)=>`R${(cents/100).toFixed(cents%100?2:0)}`;
