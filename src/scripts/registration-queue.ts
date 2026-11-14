import {rand} from '../lib/domains/catalogue';
const byId=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const list=byId('queue-items'),status=byId('queue-status'),mode=byId<HTMLSelectElement>('queue-mode'),filter=byId<HTMLSelectElement>('queue-filter'),refresh=byId<HTMLButtonElement>('queue-refresh'),more=byId<HTMLButtonElement>('queue-more');
let busy=false,nextBefore:number|null=null;
function node(tag:string,text='',className=''){const el=document.createElement(tag);el.textContent=text;if(className)el.className=className;return el;}
function field(label:string,type:string,value:string){const wrapper=node('label',label),input=document.createElement('input');input.type=type;input.value=value;wrapper.append(input);return{wrapper,input};}
function card(item:any){
  const article=node('article','','registration-card'),top=node('header','','registration-top'),title=node('div');
  title.append(node('p',item.reference),node('h2',item.domain),node('p',`${item.years} ${item.years===1?'year':'years'} · ${rand(item.cents)} paid`));
  const labels={pending:'Awaiting registration',registered:item.mode==='test'?'Test record saved':'Registration recorded',issue:'Needs attention'};
  top.append(title,node('span',labels[item.status as keyof typeof labels],'registration-badge'));article.append(top);
  const details=node('div','','registration-details'),customer=node('section');customer.append(node('h3','Customer'),node('p',item.customer.name),node('p',item.customer.email),node('small','Registrant details below belong to the saved purchase.'));
  const owner=node('section');owner.append(node('h3','Domain registrant'));for(const text of [item.registrant.name,item.registrant.company,item.registrant.email,item.registrant.phone,[item.registrant.address,item.registrant.city,item.registrant.province,item.registrant.postalCode,item.registrant.country].filter(Boolean).join(', ')])if(text)owner.append(node('p',text));details.append(customer,owner);article.append(details);
  const form=document.createElement('form');form.className='registration-form';
  const stateLabel=node('label','Registration status'),state=document.createElement('select');for(const [value,text] of [['pending','Awaiting registration'],['registered',item.mode==='test'?'Test registration recorded':'Registered in TrueHost'],['issue','Needs attention']]){const option=document.createElement('option');option.value=value;option.textContent=text;option.selected=value===item.status;state.append(option);}stateLabel.append(state);
  const reference=field('TrueHost reference','text',item.providerReference),registered=field('Registration date','date',item.registeredOn),expiry=field('Expiry date','date',item.expiresOn);reference.input.maxLength=120;
  const notesLabel=node('label','Internal notes','wide'),notes=document.createElement('textarea');notes.value=item.notes;notes.maxLength=2000;notesLabel.append(notes);
  const confirmation=node('label','','wide registration-confirm'),check=document.createElement('input');check.type='checkbox';confirmation.append(check,node('span',item.mode==='test'?'This is a practice record only. No domain has been purchased or registered.':'I have completed this registration in TrueHost and checked the registration and expiry dates.'));
  const actions=node('div','','wide registration-actions'),save=document.createElement('button');save.type='submit';save.textContent=item.mode==='test'?'Save test record':'Save registration';const message=node('p','','registration-message');message.setAttribute('role','status');actions.append(save,message);
  const updateFields=()=>{const complete=state.value==='registered';registered.input.required=complete;expiry.input.required=complete;reference.input.required=complete;check.required=complete;registered.input.disabled=!complete;expiry.input.disabled=!complete;notes.required=state.value==='issue';confirmation.hidden=!complete;};state.addEventListener('change',updateFields);updateFields();
  form.append(stateLabel,reference.wrapper,registered.wrapper,expiry.wrapper,notesLabel,confirmation,actions);article.append(form);
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(!form.reportValidity()||save.disabled)return;
    const controls=Array.from(form.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement|HTMLButtonElement>('input,select,textarea,button'));
    const payload={orderId:item.orderId,domain:item.domain,version:item.version,status:state.value,registeredOn:registered.input.value,expiresOn:expiry.input.value,providerReference:reference.input.value,notes:notes.value,confirmed:check.checked};controls.forEach(control=>control.disabled=true);message.textContent='Saving…';
    try{
      const response=await fetch('/api/admin/registrations',{method:'PUT',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)}),data=await response.json();
      if(!response.ok)throw new Error(data.error||'Unable to save. Refresh before retrying.');
      item.version=data.version;item.status=payload.status;item.registeredOn=payload.registeredOn;item.expiresOn=payload.expiresOn;item.providerReference=payload.providerReference;item.notes=payload.notes;
      top.querySelector('.registration-badge')!.textContent=labels[item.status as keyof typeof labels];
      const emailMessage=data.emailStatus==='waiting'?' The confirmation and invoice will be emailed once all domains in this order are registered.':data.emailStatus==='sent'?' Confirmation email accepted for sending.':data.emailStatus==='manual_review'?' Confirmation email needs manual review.':data.emailStatus==='pending'||data.emailStatus==='sending'?' Confirmation email is queued; delivery needs a retry.':'';
      message.textContent=(item.mode==='test'?'Test record saved. No domain was registered.':'Registration record saved.')+emailMessage;check.checked=false;
    }catch(error){message.textContent=error instanceof Error?error.message:'Unable to save. Refresh before retrying.';}
    finally{controls.forEach(control=>control.disabled=false);updateFields();}
  });return article;
}
async function load(append=false){
  if(busy)return;busy=true;refresh.disabled=true;more.disabled=true;mode.disabled=true;filter.disabled=true;status.textContent='Loading registration queue…';
  byId('queue-notice').textContent=mode.value==='test'?'TEST PURCHASES · Practise recording details here. Do not buy these domains in TrueHost.':'LIVE PURCHASES · Confirm payment, registrant and selected term before purchasing in TrueHost.';
  try{
    const query=new URLSearchParams({mode:mode.value,status:filter.value});if(append&&nextBefore)query.set('before',String(nextBefore));
    const response=await fetch('/api/admin/registrations?'+query,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(15000)}),data=await response.json();
    if(!response.ok)throw new Error(data.error||'Unable to load the queue.');
    if(!append)list.replaceChildren();for(const item of data.items)list.append(card(item));nextBefore=data.nextBefore;more.hidden=nextBefore===null;status.textContent='';
    if(!list.children.length)list.append(node('p','No paid domains match these filters.','queue-empty'));
  }catch(error){status.textContent=error instanceof Error?error.message:'Unable to load the queue.';}
  finally{busy=false;refresh.disabled=false;more.disabled=false;mode.disabled=false;filter.disabled=false;}
}
mode.addEventListener('change',()=>void load());filter.addEventListener('change',()=>void load());refresh.addEventListener('click',()=>void load());more.addEventListener('click',()=>void load(true));void load();
