import {accountRequest} from './account-client';
import {rand} from '../lib/domains/catalogue';
const body=document.getElementById('billing-body')!,status=document.getElementById('billing-status')!,mode=document.getElementById('billing-mode') as HTMLSelectElement,refresh=document.getElementById('billing-refresh') as HTMLButtonElement,more=document.getElementById('billing-more') as HTMLButtonElement;
const initial=new URLSearchParams(location.search).get('mode');if(initial==='live'||initial==='test')mode.value=initial;
let busy=false,nextBefore:number|null=null;
function cell(text:string){const td=document.createElement('td');td.textContent=text;return td;}
function date(value:string){return new Intl.DateTimeFormat('en-ZA',{dateStyle:'long',timeZone:'Africa/Johannesburg'}).format(new Date(value.replace(' ','T')+(value.endsWith('Z')?'':'Z')));}
async function load(append=false){
  if(busy)return;busy=true;refresh.disabled=true;more.disabled=true;mode.disabled=true;status.textContent='Loading your invoices…';
  try{
    const params=new URLSearchParams({mode:mode.value});if(append&&nextBefore)params.set('before',String(nextBefore));
    const data=await accountRequest('/api/customer/invoices?'+params);
    if(!append)body.replaceChildren();
    for(const invoice of data.invoices){
      const tr=document.createElement('tr'),reference=cell(''),link=document.createElement('a');link.href='/dashboard/invoice/?invoice='+encodeURIComponent(invoice.id);link.textContent=invoice.reference;reference.append(link);
      const state=cell(''),badge=document.createElement('span');badge.className='invoice-paid';badge.textContent=invoice.mode==='test'?'Test payment confirmed':'Paid';state.append(badge);
      const action=cell(''),view=document.createElement('a');view.href=link.href;view.textContent='View invoice';action.append(view);tr.append(reference,cell(date(invoice.issuedAt)),cell(rand(invoice.amount)),state,action);body.append(tr);
    }
    document.getElementById('billing-count')!.textContent=String(data.invoiceCount);document.getElementById('billing-paid')!.textContent=rand(data.totalPaid);
    document.getElementById('billing-paid-label')!.textContent=mode.value==='test'?'Test payments confirmed':'Payments confirmed';
    document.getElementById('billing-notice')!.hidden=mode.value!=='test';
    nextBefore=data.nextBefore;more.hidden=nextBefore===null;status.textContent=body.children.length?'':'No invoices yet. Confirmed purchases will appear here.';
  }catch(error){status.textContent=error instanceof Error?error.message:'Unable to load your invoices.';}
  finally{busy=false;refresh.disabled=false;more.disabled=false;mode.disabled=false;}
}
mode.addEventListener('change',()=>void load());refresh.addEventListener('click',()=>void load());more.addEventListener('click',()=>void load(true));void load();
