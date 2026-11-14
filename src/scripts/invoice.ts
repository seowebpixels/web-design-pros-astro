import {accountRequest} from './account-client';
import {invoiceView} from '../lib/orders/invoice-view';
const element=(id:string)=>document.getElementById(id)!;
const status=element('invoice-status'),paper=element('invoice-paper'),print=element('invoice-print') as HTMLButtonElement;
const set=(id:string,value:string)=>{element(id).textContent=value;};
async function load(){
  const id=new URLSearchParams(location.search).get('invoice');
  if(!id){status.textContent='Choose an invoice from Billing.';return;}
  try{
    const {invoice}=await accountRequest('/api/customer/invoices?invoice='+encodeURIComponent(id));
    const view=invoiceView(invoice);
    for(const [id,value] of Object.entries(view.text))set(id,value);
    element('invoice-test-note').hidden=!view.test;
    const body=element('invoice-lines');body.replaceChildren();
    for(const values of view.lines){const row=document.createElement('tr');for(const value of values){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}body.append(row);}
    element('invoice-order').setAttribute('href','/dashboard/orders/?order='+encodeURIComponent(invoice.id));element('invoice-back').setAttribute('href','/dashboard/billing/?mode='+invoice.mode);
    document.title=view.title;paper.hidden=false;print.disabled=false;status.textContent='';
  }catch(error){status.textContent=error instanceof Error?error.message:'Unable to load your invoice.';}
}
print.addEventListener('click',()=>{if(!paper.hidden)window.print();});void load();
