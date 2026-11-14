import {accountRequest} from './account-client';
import {rand} from '../lib/domains/catalogue';
const element=(id:string)=>document.getElementById(id)!;
const status=element('invoice-status'),paper=element('invoice-paper'),print=element('invoice-print') as HTMLButtonElement;
const set=(id:string,value:string)=>{element(id).textContent=value;};
function date(value:string|null){return value?new Intl.DateTimeFormat('en-ZA',{dateStyle:'long',timeZone:'Africa/Johannesburg'}).format(new Date(value.replace(' ','T')+(value.endsWith('Z')?'':'Z'))):'—';}
async function load(){
  const id=new URLSearchParams(location.search).get('invoice');
  if(!id){status.textContent='Choose an invoice from Billing.';return;}
  try{
    const {invoice}=await accountRequest('/api/customer/invoices?invoice='+encodeURIComponent(id)),test=invoice.mode==='test';
    set('invoice-title',test?'Test invoice':'Invoice');set('invoice-reference',invoice.reference);set('invoice-paid',test?'Test payment confirmed':'Paid');element('invoice-test-note').hidden=!test;
    set('invoice-seller',invoice.seller.name);set('invoice-company-registration','Registration number: '+invoice.seller.registrationNumber);
    set('invoice-seller-contact',[invoice.seller.address,invoice.seller.email,invoice.seller.phone,invoice.seller.website].join('\n'));
    const billing=invoice.billing;set('invoice-customer',[billing.firstName,billing.lastName].filter(Boolean).join(' '));set('invoice-customer-company',billing.company);
    set('invoice-customer-contact',[billing.address,[billing.city,billing.province,billing.postalCode].filter(Boolean).join(', '),billing.country,billing.email,billing.phone].filter(Boolean).join('\n'));
    set('invoice-issued',date(invoice.issuedAt));set('invoice-payment-date',date(invoice.paidAt));
    const body=element('invoice-lines');body.replaceChildren();
    for(const item of invoice.lines){const row=document.createElement('tr');for(const value of [item.description,item.period,rand(item.amount)]){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}body.append(row);}
    set('invoice-total',rand(invoice.total));set('invoice-amount-paid-label',test?'Test amount confirmed':'Amount paid');set('invoice-amount-paid',rand(invoice.amountPaid));set('invoice-balance',rand(invoice.balanceDue));
    element('invoice-order').setAttribute('href','/dashboard/orders/?order='+encodeURIComponent(invoice.id));element('invoice-back').setAttribute('href','/dashboard/billing/?mode='+invoice.mode);
    document.title=(test?'Test invoice ':'Invoice ')+invoice.reference+' | Web Design Pros';paper.hidden=false;print.disabled=false;status.textContent='';
  }catch(error){status.textContent=error instanceof Error?error.message:'Unable to load your invoice.';}
}
print.addEventListener('click',()=>{if(!paper.hidden)window.print();});void load();
