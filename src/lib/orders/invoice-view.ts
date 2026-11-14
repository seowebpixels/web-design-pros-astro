import {rand} from '../domains/catalogue';
import type {invoiceDetail} from './invoices';
export type InvoiceDetail=ReturnType<typeof invoiceDetail>;
const date=(value:string|null)=>value?new Intl.DateTimeFormat('en-ZA',{dateStyle:'long',timeZone:'Africa/Johannesburg'}).format(new Date(value.replace(' ','T')+(value.endsWith('Z')?'':'Z'))):'—';
// Shared by the account page and PDF; both populate the existing invoice markup.
export function invoiceView(invoice:InvoiceDetail){
  const test=invoice.mode==='test',billing=invoice.billing;
  return {test,title:(test?'Test invoice ':'Invoice ')+invoice.reference+' | Web Design Pros',text:{
    'invoice-title':test?'Test invoice':'Invoice','invoice-reference':invoice.reference,'invoice-paid':test?'Test payment confirmed':'Paid',
    'invoice-seller':invoice.seller.name,'invoice-company-registration':invoice.seller.name+' · Company registration: '+invoice.seller.registrationNumber,
    'invoice-seller-contact':[invoice.seller.email,invoice.seller.website].join('\n'),
    'invoice-customer':[billing.firstName,billing.lastName].filter(Boolean).join(' '),'invoice-customer-company':billing.company,
    'invoice-customer-contact':[billing.address,[billing.city,billing.province,billing.postalCode].filter(Boolean).join(', '),billing.country,billing.email,billing.phone].filter(Boolean).join('\n'),
    'invoice-payment-label':invoice.orderCount>1?'Payments confirmed through':'Payment confirmed','invoice-issued':date(invoice.issuedAt),'invoice-payment-date':date(invoice.paidAt),'invoice-total':rand(invoice.total),
    'invoice-amount-paid-label':test?'Test amount confirmed':'Amount paid','invoice-amount-paid':rand(invoice.amountPaid),'invoice-balance':rand(invoice.balanceDue)
  },lines:invoice.lines.map(item=>[item.description,item.period,rand(item.amount)])};
}
