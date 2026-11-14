const body=document.getElementById('domains-body')!,status=document.getElementById('domains-status')!,mode=document.getElementById('domains-mode') as HTMLSelectElement,refresh=document.getElementById('domains-refresh') as HTMLButtonElement,more=document.getElementById('domains-more') as HTMLButtonElement;
let busy=false,nextBefore:number|null=null;
function cell(text:string){const td=document.createElement('td');td.textContent=text;return td;}
function date(value:string|null){return value?new Intl.DateTimeFormat('en-ZA',{dateStyle:'long',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z')):'—';}
async function load(append=false){
  if(busy)return;busy=true;refresh.disabled=true;more.disabled=true;mode.disabled=true;status.textContent='Loading your domains…';
  try{
    const params=new URLSearchParams({mode:mode.value});if(append&&nextBefore)params.set('before',String(nextBefore));
    const response=await fetch('/api/customer/domains?'+params,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(15000)}),data=await response.json();if(!response.ok)throw new Error(data.error||'Unable to load your domains.');
    if(!append)body.replaceChildren();
    for(const domain of data.domains){const tr=document.createElement('tr'),name=cell(domain.domain),ref=document.createElement('small');ref.textContent=domain.reference;name.append(ref);const state=domain.mode==='test'?(domain.status==='registered'?'Test record · not registered':domain.status==='issue'?'Test record · needs attention':'Test purchase · not registered'):(domain.status==='registered'?'Registration recorded':domain.status==='issue'?'Registration needs attention':'Awaiting registration');const link=document.createElement('a');link.href='/dashboard/orders/?order='+encodeURIComponent(domain.orderId);link.textContent='View order';const action=cell('');action.append(link);tr.append(name,cell(date(domain.registeredOn)),cell(date(domain.expiresOn)),cell(state),action);body.append(tr);}
    if(!body.children.length){const tr=document.createElement('tr'),empty=cell('No domain purchases found.');empty.colSpan=5;tr.append(empty);body.append(tr);}
    nextBefore=data.nextBefore;more.hidden=nextBefore===null;status.textContent=mode.value==='test'?'Test dates are practice records. These domains have not been registered.':'';
  }catch(error){status.textContent=error instanceof Error?error.message:'Unable to load your domains.';}
  finally{busy=false;refresh.disabled=false;more.disabled=false;mode.disabled=false;}
}
mode.addEventListener('change',()=>void load());refresh.addEventListener('click',()=>void load());more.addEventListener('click',()=>void load(true));void load();
