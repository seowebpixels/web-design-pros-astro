import {rand} from '../lib/domains/catalogue';
const byId=(id:string)=>document.getElementById(id)!;
const list=byId('orders-list'),detail=byId('order-detail'),status=byId('orders-status');
const refresh=byId('orders-refresh') as HTMLButtonElement,more=byId('orders-more') as HTMLButtonElement;
const id=new URLSearchParams(location.search).get('order');
let nextBefore:number|null=null,busy=false;
const money=(cents:number)=>rand(cents);
function node(tag:string,text:string,className=''){const el=document.createElement(tag);el.textContent=text;if(className)el.className=className;return el;}
function date(value:string){return new Intl.DateTimeFormat('en-ZA',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value.replace(' ','T')+'Z'));}
function state(order:any){return order.paymentStatus==='paid'?(order.mode==='test'?'Test payment confirmed':'Payment confirmed'):order.paymentStatus==='failed'?'Payment unsuccessful':'Awaiting payment confirmation';}
function items(order:any){
  const ul=document.createElement('ul');
  for(const item of order.items.domains)ul.append(node('li',`${item.domain} · ${item.years??1} ${(item.years??1)===1?'year':'years'} registration · ${money(item.cents)}`));
  if(order.items.hosting)ul.append(node('li','Starter hosting with email · first month R60.00 · R60.00 monthly thereafter'));
  return ul;
}
function contact(title:string,value:any,billing=false){
  const section=document.createElement('section');section.append(node('h3',title));
  const dl=document.createElement('dl');
  for(const [label,text] of [['Name',billing?`${value.firstName} ${value.lastName}`:value.name],['Email',value.email],['Phone',value.phone],['Organisation',value.company||'—'],['Address',[value.address,value.city,value.province,value.postalCode,value.country].join('\n')]])dl.append(node('dt',label),node('dd',text));
  section.append(dl);return section;
}
function card(order:any,full=false){
  const article=node('article','','order-card');
  const heading=node('h2','');const link=document.createElement('a');link.href=`/dashboard/orders/?order=${encodeURIComponent(order.id)}`;link.textContent=order.reference;heading.append(link);article.append(heading);
  const meta=node('div','','order-meta');meta.append(node('span',date(order.createdAt)),node('strong',money(order.amount)));article.append(meta,node('p',state(order),'order-state'),items(order));
  if(order.paymentStatus==='paid'){
    article.append(node('p',order.mode==='test'?'Payment confirmed. This test order does not provision domains or hosting.':'Payment confirmed. View Services and Domains for activation details.'));
    const invoice=document.createElement('a');invoice.href='/dashboard/invoice/?invoice='+encodeURIComponent(order.id);invoice.textContent='View invoice →';article.append(invoice);
  }
  else if(order.paymentStatus==='pending')article.append(node('p','If you have already paid, wait for confirmation before trying again.'));
  if(full){
    if(order.paidAt)article.append(node('p',`Confirmed ${date(order.paidAt)}`));
    const contacts=node('div','','order-contacts');contacts.append(contact('Billing details at purchase',order.billing,true),contact('Domain registrant at purchase',order.registrant));article.append(contacts);
    article.append(node('p',`Terms accepted ${date(order.terms.acceptedAt)}`));
  }
  return article;
}
async function load(append=false){
  if(busy)return;busy=true;refresh.disabled=true;more.disabled=true;status.textContent='Loading your orders…';
  try{
    const query=id?`?order=${encodeURIComponent(id)}`:append&&nextBefore?`?before=${nextBefore}`:'';
    const response=await fetch('/api/customer/orders'+query,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(15000)});
    const value=await response.json();
    if(response.status===401){location.assign('/account/?next=dashboard');return;}
    if(!response.ok)throw new Error(value.error||'Unable to load orders.');
    if(id){list.hidden=true;detail.hidden=false;detail.replaceChildren(card(value.order,true));byId('orders-back').hidden=false;more.hidden=true;status.textContent='';}
    else{
      if(!append)list.replaceChildren();for(const order of value.orders)list.append(card(order));
      nextBefore=value.nextBefore;more.hidden=nextBefore===null;
      status.textContent=list.children.length?'':'No orders yet. Your next checkout will appear here.';
    }
  }catch(error){status.textContent=error instanceof Error?error.message:'Unable to load orders. Please try again.';}
  finally{busy=false;refresh.disabled=false;more.disabled=false;}
}
refresh.addEventListener('click',()=>{void load();});more.addEventListener('click',()=>{void load(true);});void load();
