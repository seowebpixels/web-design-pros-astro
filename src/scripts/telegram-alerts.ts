type Alert={orderId:string;reference:string;state:string;attempts:number;reviewRequired:boolean};
const element=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const panel=element('telegram-alerts'),list=element('telegram-items'),status=element('telegram-status'),mode=element<HTMLSelectElement>('queue-mode'),filter=element<HTMLSelectElement>('telegram-filter'),refresh=element<HTMLButtonElement>('telegram-refresh'),more=element<HTMLButtonElement>('telegram-more');
const labels:Record<string,string>={pending:'Waiting to send / retry',sending:'Sending — please wait',sent:'Delivery confirmed',received:'Marked received by you',uncertain:'Delivery uncertain — automatic retries paused',rejected:'Delivery failed — review required'};
let busy=false,nextBefore:number|null=null;
function node(tag:string,text:string){const item=document.createElement(tag);item.textContent=text;return item;}
function card(item:Alert){
  const article=node('article','');article.className='telegram-item';article.append(node('h3',item.reference),node('p',labels[item.state]??'Needs review'),node('small',`${item.attempts} delivery ${item.attempts===1?'attempt':'attempts'}`));
  if(item.reviewRequired){
    article.append(node('p','If this reference is already in Telegram, choose Mark received. Retry only if you have checked that it is missing; an earlier request may still arrive.'));
    const form=document.createElement('form'),label=node('label','');label.className='telegram-confirm';const check=document.createElement('input');check.type='checkbox';check.required=true;label.append(check,node('span','I checked this WDP reference in Telegram.'));form.append(label);
    const actions=node('div','');actions.className='telegram-actions';
    for(const [action,text] of [['received','Mark received'],['retry','Retry Telegram']]){
      const button=document.createElement('button');button.type='button';button.textContent=text;
      button.addEventListener('click',async()=>{
        if(busy||!form.reportValidity())return;busy=true;const buttons=Array.from(panel.querySelectorAll<HTMLButtonElement>('button'));buttons.forEach(value=>value.disabled=true);status.textContent=action==='retry'?'Trying Telegram once…':'Marking received…';
        try{
          const response=await fetch('/api/admin/telegram-alerts',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({orderId:item.orderId,attempts:item.attempts,action,confirmed:true}),signal:AbortSignal.timeout(30000)}),data=await response.json();
          if(!response.ok)throw new Error(data.error||'Unable to update the alert. Refresh before trying again.');
          const message=action==='received'?'Marked received. No message was sent.':data.alert.state==='sent'?'Telegram confirmed delivery.':data.alert.reviewRequired?'Delivery is still unconfirmed. Automatic retries remain paused. Check the chat before taking another action.':'Telegram rejected this attempt temporarily; the alert is waiting to retry.';
          busy=false;await load();status.textContent=message;
        }catch(error){status.textContent=(error instanceof Error?error.message:'Unable to complete the alert action.')+' Refresh alerts before trying again.';}
        finally{busy=false;buttons.forEach(value=>value.disabled=false);updateDemo();}
      });actions.append(button);
    }
    form.append(actions);article.append(form);
  }
  return article;
}
async function load(append=false){
  if(busy)return;busy=true;refresh.disabled=true;more.disabled=true;filter.disabled=true;status.textContent='Loading Telegram alerts…';
  try{
    const query=new URLSearchParams({mode:mode.value,filter:filter.value});if(append&&nextBefore)query.set('before',String(nextBefore));
    const response=await fetch('/api/admin/telegram-alerts?'+query,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(15000)}),data=await response.json();
    if(!response.ok)throw new Error(data.error||'Unable to load alerts.');panel.hidden=false;
    if(!append)list.replaceChildren();for(const item of data.items)list.append(card(item));
    nextBefore=data.nextBefore;more.hidden=nextBefore===null;status.textContent=list.children.length?'':filter.value==='review'?'No Telegram alerts need review.':'No Telegram alerts for these purchases.';
  }catch(error){if(!panel.hidden)status.textContent=error instanceof Error?error.message:'Unable to load alerts.';}
  finally{busy=false;refresh.disabled=false;more.disabled=false;filter.disabled=false;}
}
// Isolated practice state: never calls an API or touches a real alert/cart.
let demoState='idle',demoAttempts=0;
const demoStatus=element('telegram-demo-status');
function updateDemo(){for(const id of ['auto','received','retry'])element<HTMLButtonElement>('telegram-demo-'+id).disabled=demoState!=='uncertain';}
element('telegram-demo-timeout').addEventListener('click',()=>{demoState='uncertain';demoAttempts=1;demoStatus.textContent='PRACTICE · Delivery uncertain. Automatic retries paused. Attempts: 1.';updateDemo();});
element('telegram-demo-auto').addEventListener('click',()=>{demoStatus.textContent=`PRACTICE · Automatic retry skipped. Still awaiting review. Attempts: ${demoAttempts}.`;});
element('telegram-demo-received').addEventListener('click',()=>{demoState='received';demoStatus.textContent=`PRACTICE · Marked received. No message sent. Attempts: ${demoAttempts}.`;updateDemo();});
element('telegram-demo-retry').addEventListener('click',()=>{demoState='sent';demoAttempts++;demoStatus.textContent=`PRACTICE · One deliberate retry succeeded. Attempts: ${demoAttempts}.`;updateDemo();});
mode.addEventListener('change',()=>void load());filter.addEventListener('change',()=>void load());refresh.addEventListener('click',()=>void load());more.addEventListener('click',()=>void load(true));void load();
