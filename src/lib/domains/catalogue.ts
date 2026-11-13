export interface DomainPrice {tld:string;category:string;hot:boolean;years:number;registrationCents:number;transferCents:number;renewalCents:number;yearlyPricesCents:readonly number[]}
// Owner-approved retail prices. Keep money as integer cents; unlisted TLDs have no checkout price.
export const domainCatalogue:readonly DomainPrice[]=[
  {tld:'co.za',category:'Other',hot:true,years:1,registrationCents:9500,transferCents:0,renewalCents:17000,yearlyPricesCents:[9500,17000,26000,35000,48000]},
  {tld:'com',category:'Popular',hot:true,years:1,registrationCents:21000,transferCents:23500,renewalCents:46000,yearlyPricesCents:[21000,46000,73000,95000,120000]}
];
const longestSuffixFirst=[...domainCatalogue].sort((a,b)=>b.tld.length-a.tld.length);
export function priceForHostname(hostname:string):DomainPrice|null{
  const name=hostname.toLowerCase().replace(/\.$/,'');
  return longestSuffixFirst.find(price=>name.endsWith('.'+price.tld))??null;
}
export const rand=(cents:number)=>`R${(cents/100).toFixed(cents%100?2:0)}`;
export const validYears=(value:unknown):value is number=>typeof value==='number'&&Number.isInteger(value)&&value>=1&&value<=5;
export function termPriceCents(price:DomainPrice,years:number){
  if(!validYears(years))throw new RangeError('Choose a registration period between 1 and 5 years.');
  return price.yearlyPricesCents.slice(0,years).reduce((sum,amount)=>sum+amount,0);
}
export function cartTermCents(item:{domain:string;selectedYears?:unknown;registrationPrice?:unknown}){
  const price=priceForHostname(item.domain),years=validYears(item.selectedYears)?item.selectedYears:1;
  return price?termPriceCents(price,years):Math.round((Number(item.registrationPrice)||0)*100);
}
