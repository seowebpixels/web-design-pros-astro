import {accountRequest} from './account-client';
const profileKeys=['firstName','lastName','phone','company','address','city','province','postalCode','country'];
const form=document.getElementById('checkout-form') as HTMLFormElement;
const field=(key:string)=>form.elements.namedItem(key) as HTMLInputElement;
const password=document.getElementById('password') as HTMLInputElement;
const billing=document.getElementById('billing-fields') as HTMLFieldSetElement;
const notice=document.getElementById('login-status')!;
const login=document.getElementById('account-login') as HTMLButtonElement;
const logout=document.getElementById('account-logout') as HTMLButtonElement;
let customer:any=null;
let busy=false;
function saveDraft(){
  const draft=Object.fromEntries(profileKeys.map(key=>[key,field(key).value]));
  sessionStorage.setItem('wdp_billing_draft',JSON.stringify(draft));
}
function signedIn(value:any){
  customer=value;password.value='';password.disabled=true;password.required=false;
  field('email').value=value.user.email;field('email').disabled=true;
  document.getElementById('account-credentials')!.hidden=true;
  document.getElementById('account-choices')!.hidden=true;
  document.getElementById('account-note')!.textContent=`Signed in as ${value.user.name} (${value.user.email}).`;
  document.getElementById('account-note')!.hidden=false;
  login.hidden=true;logout.hidden=false;
  billing.hidden=false;billing.disabled=false;
  if(value.profile) for(const key of profileKeys)field(key).value=value.profile[key] || '';
  notice.textContent=value.profile?'Your saved billing details are ready. You can update them below.':'Complete your billing details to continue.';
}
export async function loadCheckoutAccount(){
  try{
    const draft=JSON.parse(sessionStorage.getItem('wdp_billing_draft') || 'null');
    if(draft)for(const key of profileKeys)if(typeof draft[key]==='string')field(key).value=draft[key];
  }catch{/* No usable draft. */}
  try{const response=await fetch('/api/customer/profile',{cache:'no-store',credentials:'same-origin'});if(response.ok)signedIn(await response.json());}catch{/* Existing checkout remains available. */}
}
login.addEventListener('click',async()=>{
  if(busy || !field('email').reportValidity() || !password.reportValidity())return;
  busy=true;login.disabled=true;notice.textContent='Signing in…';
  try{await accountRequest('/api/auth/sign-in/email',{email:field('email').value,password:password.value,callbackURL:'/checkout/'});signedIn(await accountRequest('/api/customer/profile'));}
  catch(error){notice.textContent=error instanceof Error?error.message:'Unable to sign in.';}
  finally{busy=false;login.disabled=false;}
});
logout.addEventListener('click',async()=>{
  if(busy)return;busy=true;logout.disabled=true;
  try{await accountRequest('/api/auth/sign-out',{});sessionStorage.removeItem('wdp_billing_draft');sessionStorage.removeItem('wdp_payment_attempt');location.reload();}
  catch(error){notice.textContent=error instanceof Error?error.message:'Unable to sign out.';busy=false;logout.disabled=false;}
});
export async function ensureCheckoutAccount(){
  if(!customer){
    const current=await fetch('/api/customer/profile',{cache:'no-store',credentials:'same-origin'});
    if(current.ok)signedIn(await current.json());
  }
  if(!customer){
    const mode=form.querySelector<HTMLInputElement>('input[name="account"]:checked')!.value;
    if(mode==='existing')throw new Error('Please log in before continuing.');
    saveDraft();
    await accountRequest('/api/auth/sign-up/email',{name:field('firstName').value+' '+field('lastName').value,email:field('email').value,password:password.value,callbackURL:'/checkout/'});
    password.value='';
    throw new Error('Check your inbox and verify your email address to continue. If you already have an account, select Login. Your cart and billing draft are saved.');
  }
  if(!form.reportValidity())throw new Error('Please complete your billing details.');
  const response=await fetch('/api/customer/profile',{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(profileKeys.map(key=>[key,field(key).value])))});
  const value=await response.json();if(!response.ok)throw new Error(value.error || 'Unable to save billing details.');
  sessionStorage.removeItem('wdp_billing_draft');
}
