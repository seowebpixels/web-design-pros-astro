const body=document.getElementById('services-body')!,status=document.getElementById('services-status')!;
const more=document.getElementById('services-more') as HTMLButtonElement,refresh=document.getElementById('services-refresh') as HTMLButtonElement;
let nextBefore:number|null=null,busy=false;
const money=(cents:number)=>new Intl.NumberFormat('en-ZA',{style:'currency',currency:'ZAR'}).format(cents/100);
function cell(text:string,className=''){const td=document.createElement('td');td.textContent=text;if(className)td.className=className;return td;}
function small(parent:HTMLElement,text:string){const el=document.createElement('small');el.textContent=text;parent.append(el);}
function row(service:any){
  const tr=document.createElement('tr'),product=cell(service.product,'product-name');small(product,service.reference);
  const domain=cell(service.domain,'domain-link'),price=cell(service.recurringCents===null?'To be confirmed':`${money(service.recurringCents)} / ${service.cycle==='Annual'?'year':'month'}`,'price-val');
  small(price,service.product==='Domain Registration'?`Paid ${money(service.paidCents)} · first year`:`Paid ${money(service.paidCents)} · first month`);
  if(service.priceSource==='current_catalogue')small(price,'Current renewal price');
  const due=cell(service.product==='Domain Registration'?'After registration':'After activation');
  const state=cell(''),badge=document.createElement('span');badge.className='status-badge pending';badge.textContent=service.status==='test_purchase'?'Test purchase':service.status==='pending_registration'?'Pending registration':'Pending setup';state.append(badge);
  if(service.status==='test_purchase')small(state,service.product==='Domain Registration'?'Not registered':'Not provisioned');
  const action=cell('','service-action'),link=document.createElement('a');link.className='table-manage-btn';link.href=`/dashboard/orders/?order=${encodeURIComponent(service.orderId)}`;link.textContent='Manage';link.setAttribute('aria-label',`Manage ${service.product} for ${service.domain}`);action.append(link);
  tr.append(product,domain,price,due,state,action);return tr;
}
async function load(append=false){
  if(busy)return;busy=true;more.disabled=true;refresh.disabled=true;status.textContent='Loading your services…';
  try{
    const response=await fetch('/api/customer/services'+(append&&nextBefore?`?before=${nextBefore}`:''),{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(15000)}),data=await response.json();
    if(response.status===401){location.assign('/account/?next=dashboard');return;}
    if(!response.ok)throw new Error(data.error||'Unable to load services.');
    if(!append)body.replaceChildren();for(const service of data.services)body.append(row(service));
    nextBefore=data.nextBefore;more.hidden=nextBefore===null;status.textContent='';
    if(!body.children.length){const tr=document.createElement('tr'),empty=cell('No paid services found.','empty-state');empty.colSpan=6;tr.append(empty);body.append(tr);}
  }catch(error){status.textContent=error instanceof Error?error.message:'Unable to load services. Please try again.';}
  finally{busy=false;more.disabled=false;refresh.disabled=false;}
}
more.addEventListener('click',()=>{void load(true);});refresh.addEventListener('click',()=>{void load();});void load();
