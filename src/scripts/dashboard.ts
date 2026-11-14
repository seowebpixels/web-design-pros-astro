import {accountRequest} from './account-client';
const status=document.getElementById('dashboard-status')!;
void accountRequest('/api/customer/profile').then(data=>{
  document.getElementById('dashboard-customer')!.textContent=data.user.name;
  const adminLink=document.getElementById('registration-admin-link');if(adminLink)adminLink.hidden=!data.isRegistrationAdmin;
  const name=document.getElementById('dashboard-profile-name'),address=document.getElementById('dashboard-profile-address');
  if(name)name.textContent=data.user.name;
  if(address)address.textContent=data.profile?[data.profile.company,data.profile.address,[data.profile.city,data.profile.province,data.profile.postalCode].filter(Boolean).join(', '),data.profile.country].filter(Boolean).join('\n'):'Add your billing details to complete your account.';
}).catch(()=>location.assign('/account/?next=dashboard'));
document.querySelectorAll<HTMLButtonElement>('[data-dashboard-logout]').forEach(button=>button.addEventListener('click',async()=>{
  const buttons=document.querySelectorAll<HTMLButtonElement>('[data-dashboard-logout]');buttons.forEach(value=>value.disabled=true);
  try{await accountRequest('/api/auth/sign-out',{});location.assign('/account/');}
  catch{status.textContent='Unable to sign out. Please try again.';document.getElementById('dashboard-logout-status')!.textContent=status.textContent;buttons.forEach(value=>value.disabled=false);}
}));
const orderCount=document.getElementById('dashboard-order-count');
if(orderCount)void accountRequest('/api/customer/orders').then(data=>{orderCount.textContent=String(data.orderCount);}).catch(()=>{orderCount.textContent='—';status.textContent='Your order count could not be loaded. You can retry from Orders.';});
const serviceCount=document.getElementById('dashboard-service-count');
if(serviceCount)void accountRequest('/api/customer/services').then(data=>{serviceCount.textContent=String(data.serviceCount);}).catch(()=>{serviceCount.textContent='—';status.textContent='Your service count could not be loaded. You can retry from Services.';});

const domainCount=document.getElementById('dashboard-domain-count');
if(domainCount)void accountRequest('/api/customer/domains').then(data=>{
  const showTestRecords=data.domainCount===0&&data.testDomainCount>0;
  domainCount.textContent=String(showTestRecords?data.testDomainCount:data.domainCount);
  const note=document.getElementById('dashboard-domain-note');
  if(note){note.hidden=!showTestRecords;note.textContent='Test registrations';}
  domainCount.closest('a')?.setAttribute('href','/dashboard/domains/?mode='+(showTestRecords?'test':'live'));
}).catch(()=>{domainCount.textContent='—';});
