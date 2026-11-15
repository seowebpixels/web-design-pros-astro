import {rand} from '../lib/domains/catalogue';
const params=new URLSearchParams(location.search),message=document.getElementById('renew-status')!,form=document.getElementById('renew-form') as HTMLFormElement,years=document.getElementById('renew-years') as HTMLSelectElement,pay=document.getElementById('renew-pay') as HTMLButtonElement;
let data:any,busy=false;
const date=(value:string)=>new Intl.DateTimeFormat('en-ZA',{dateStyle:'long',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z'));
function update(){const price=data.prices.find((p:any)=>p.years===Number(years.value));document.getElementById('renew-total')!.textContent=`${rand(price.cents)} due today`;const expiry=new Date(data.expiresOn+'T12:00:00Z'),day=expiry.getUTCDate();expiry.setUTCDate(1);expiry.setUTCFullYear(expiry.getUTCFullYear()+price.years);expiry.setUTCDate(Math.min(day,new Date(Date.UTC(expiry.getUTCFullYear(),expiry.getUTCMonth()+1,0)).getUTCDate()));document.getElementById('renew-next')!.textContent=`Expected expiry after renewal: ${date(expiry.toISOString().slice(0,10))}`;}
async function load(){
 try{
  const response=await fetch('/api/customer/renewals?'+new URLSearchParams({source:params.get('source')??'',domain:params.get('domain')??''}),{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(15000)});data=await response.json();if(!response.ok)throw new Error(data.error||'Unable to load renewal.');
  document.getElementById('renew-domain')!.textContent=data.domain;document.getElementById('renew-expiry')!.textContent=`Current expiry: ${date(data.expiresOn)}`;
  message.textContent=data.mode==='test'?'TEST RENEWAL · No money will be charged and no domain will be renewed.':'';
  if(data.pending){const link=document.getElementById('renew-order') as HTMLAnchorElement;link.hidden=false;link.href='/dashboard/orders/?order='+encodeURIComponent(data.pending.id);link.textContent='View existing renewal order →';message.textContent+=' A renewal order already exists. If payment is pending, resume it in the original browser tab or contact WDP. Do not start a second payment.';
   const saved=JSON.parse(sessionStorage.getItem('wdp_payment_attempt')||'null');if(saved?.attemptId!==data.pending.id||saved?.completed||data.pending.paymentStatus==='paid')return;
  }
  if(!data.available){message.textContent+=' Contact WDP to arrange renewal. Expired domains may require additional checks and fees.';return;}
  for(const price of data.prices){const option=document.createElement('option');option.value=String(price.years);option.textContent=`${rand(price.cents)}/${price.years}${price.years===1?'yr':'yrs'}`;years.append(option);}if(data.pending){years.value=String(data.pending.years);years.disabled=true;}update();form.hidden=false;
 }catch(error){message.textContent=error instanceof Error?error.message:'Unable to load renewal.';}
}
years.addEventListener('change',update);
form.addEventListener('submit',async event=>{
 event.preventDefault();if(busy||!form.reportValidity())return;busy=true;pay.disabled=true;message.textContent='Preparing your test renewal payment…';
 try{
  const selected=Number(years.value),price=data.prices.find((p:any)=>p.years===selected);let saved=JSON.parse(sessionStorage.getItem('wdp_payment_attempt')||'null');
  const key=[data.sourceOrderId,data.domain,data.expiresOn,selected].join('/');
  if(!saved||saved.completed||saved.renewalKey!==key){if(saved&&!saved.completed)throw new Error('Another payment is still pending in this tab. Resolve it before starting a renewal.');saved={attemptId:crypto.randomUUID(),accessToken:crypto.randomUUID(),renewalKey:key,kind:'renewal'};sessionStorage.setItem('wdp_payment_attempt',JSON.stringify(saved));}
  const response=await fetch('/api/payments/create',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({...saved,kind:'renewal',sourceOrderId:data.sourceOrderId,domain:data.domain,expiresOn:data.expiresOn,years:selected,quotedAmount:price.cents,termsAccepted:(document.getElementById('renew-terms') as HTMLInputElement).checked}),signal:AbortSignal.timeout(25000)}),result=await response.json();if(!response.ok)throw new Error(result.error||'Unable to start renewal payment.');
  const target=new URL(result.redirectUrl);if(target.protocol!=='https:'||!(target.hostname==='yoco.com'||target.hostname.endsWith('.yoco.com')))throw new Error('Invalid payment destination.');location.assign(target.href);
 }catch(error){message.textContent=error instanceof Error?error.message:'Unable to start payment. Check Orders before trying again.';busy=false;pay.disabled=false;}
});
void load();
