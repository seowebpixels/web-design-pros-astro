import {rand} from '../lib/domains/catalogue';
const status=document.getElementById('renewal-admin-status')!,panel=document.getElementById('renewal-admin')!,list=document.getElementById('renewal-items')!,mode=document.getElementById('renewal-mode') as HTMLSelectElement,refresh=document.getElementById('renewal-refresh') as HTMLButtonElement,more=document.getElementById('renewal-more') as HTMLButtonElement;
let busy=false,next:number|null=null;
function el(tag:string,text=''){const node=document.createElement(tag);node.textContent=text;return node;}
function card(item:any){
 const form=document.createElement('form');form.append(el('p',item.reference),el('h2',item.domain),el('p',`${item.customer} · ${rand(item.cents)} paid · ${item.years} year(s)`),el('p',`Previous expiry: ${item.expiresOn} · Expected new expiry: ${item.expectedExpiresOn}`));
 const expiryLabel=el('label','Actual TrueHost expiry date'),expiry=document.createElement('input');expiry.type='date';expiry.required=true;expiry.value=item.expectedExpiresOn;expiryLabel.append(expiry);
 const refLabel=el('label','TrueHost renewal reference'),ref=document.createElement('input');ref.required=true;ref.maxLength=120;refLabel.append(ref);
 const confirmation=el('label'),check=document.createElement('input');check.type='checkbox';check.required=true;confirmation.append(check,el('span',item.mode==='test'?'Practice only. I have not renewed this domain in TrueHost.':'I completed the renewal in TrueHost and checked the new expiry date.'));
 const save=document.createElement('button');save.type='submit';save.textContent=item.mode==='test'?'Save test renewal':'Confirm renewal';const message=el('p');message.setAttribute('role','status');form.append(expiryLabel,refLabel,confirmation,save,message);
 if(item.currentExpiresOn!==item.expiresOn){save.disabled=true;message.textContent='The original domain expiry has changed. Contact WDP to reconcile this renewal.';}
 form.addEventListener('submit',async event=>{event.preventDefault();if(save.disabled||!form.reportValidity())return;save.disabled=true;message.textContent='Saving renewal…';try{
  const response=await fetch('/api/admin/renewals',{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId:item.orderId,version:item.version,expiresOn:expiry.value,providerReference:ref.value,confirmed:check.checked}),signal:AbortSignal.timeout(120000)}),data=await response.json();if(!response.ok)throw new Error(data.error||'Unable to save renewal.');message.textContent='Renewal recorded. '+(data.email==='sent'?'Confirmation email accepted for sending.':'Confirmation email queued; check the reminder job for delivery.');expiry.disabled=true;ref.disabled=true;check.disabled=true;
 }catch(error){message.textContent=error instanceof Error?error.message:'Unable to save. Refresh before trying again.';}});return form;
}
async function load(append=false){if(busy)return;busy=true;refresh.disabled=true;more.disabled=true;mode.disabled=true;
 try{
  const params=new URLSearchParams({mode:mode.value});if(append&&next)params.set('before',String(next));
  const response=await fetch('/api/admin/renewals?'+params,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(15000)}),data=await response.json();if(!response.ok)throw new Error(data.error||'Unable to load renewal queue.');panel.hidden=false;
  status.textContent=mode.value==='test'?'TEST RENEWALS · Practice only. Do not renew these domains in TrueHost.':'Confirm actual renewal completion before saving.';
  if(!append)list.replaceChildren();for(const item of data.items)list.append(card(item));if(!list.children.length)list.append(el('p','No paid renewals awaiting confirmation.'));next=data.nextBefore;more.hidden=next===null;
  document.getElementById('renewal-mail-status')!.textContent=data.mail.length?'Renewal emails awaiting delivery: '+data.mail.reduce((n:number,row:any)=>n+row.total,0):'No renewal emails awaiting delivery.';
 }catch(error){panel.hidden=true;status.textContent=error instanceof Error?error.message:'Unable to load renewal queue.';}finally{busy=false;refresh.disabled=false;more.disabled=false;mode.disabled=false;}}
refresh.addEventListener('click',()=>void load());mode.addEventListener('change',()=>void load());more.addEventListener('click',()=>void load(true));void load();
