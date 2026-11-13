import {ensureCheckoutAccount,loadCheckoutAccount} from './checkout-account';
import {priceForHostname,termPriceCents,validYears,rand} from '../lib/domains/catalogue';
type CartItem = { domain: string; registrationPrice: number; renewalPrice: number | null; selectedYears: number };
const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const money = (value:number)=>rand(Math.round(value*100));
const status = byId('checkout-status');
let cart: CartItem[] = [];
const form = byId<HTMLFormElement>('checkout-form');
let paymentBusy = false;
const hosting = byId<HTMLInputElement>('hosting');
const account = () => form.querySelector<HTMLInputElement>('input[name="account"]:checked')!.value;
const extras = () => hosting.checked ? 60 : 0;
const total = () => cart.reduce((sum, item) => sum + item.registrationPrice, 0) + extras();
function loadCart() {
  try {
    const value = JSON.parse(localStorage.getItem('cart_domains') || '[]');
    if (!Array.isArray(value)) throw new Error('Invalid cart');
    cart = value.filter(item => item && typeof item.domain === 'string' && /^[a-z0-9.-]+$/i.test(item.domain) && Number.isFinite(item.registrationPrice) && item.registrationPrice > 0).map(item => {const price=priceForHostname(item.domain),years=validYears(item.selectedYears)?item.selectedYears:1;return {...item,selectedYears:years,registrationPrice:price?termPriceCents(price,years)/100:item.registrationPrice,renewalPrice:price?price.renewalCents/100:null};});
    if (cart.length !== value.length) status.textContent = 'Some cart items could not be read. Please search for those domains again.';
    else if(JSON.stringify(cart)!==JSON.stringify(value)){try{localStorage.setItem('cart_domains',JSON.stringify(cart));window.dispatchEvent(new Event('cart-updated'));}catch{status.textContent='Updated prices are shown below, but your browser could not save the cart.';}}
  } catch { cart = []; status.textContent = 'Your saved cart could not be read. Please add your domains again.'; }
}
function saveCart(next:CartItem[]){
  try{localStorage.setItem('cart_domains',JSON.stringify(next));}catch{status.textContent='Your browser could not save this change. Please enable browser storage and retry.';return false;}
  cart=next;window.dispatchEvent(new Event('cart-updated'));render();return true;
}
function lockCart(locked:boolean){
  hosting.disabled=locked;
  byId('cart-items').querySelectorAll<HTMLButtonElement|HTMLSelectElement>('button,select').forEach(control=>control.disabled=locked||control.dataset.unpriced==='true');
  byId<HTMLButtonElement>('empty-cart').disabled=locked;
}
function summaryRow(label: string, price: number) {
  const row = document.createElement('div'); row.className = 'summary-row';
  const name = document.createElement('span'); name.textContent = label;
  const amount = document.createElement('span'); amount.textContent = money(price);
  row.append(name, amount); return row;
}
function render() {
  byId('empty').hidden = cart.length > 0;
  byId('checkout-body').hidden = cart.length === 0;
  const items = byId('cart-items'); items.replaceChildren();
  const summary = byId('summary-items'); summary.replaceChildren();
  cart.forEach((item, index) => {
    const row = document.createElement('div'); row.className = 'cart-row';
    const description = document.createElement('div');description.className='cart-description';
    const name = document.createElement('strong'); name.textContent = item.domain;
    const detail = document.createElement('small');detail.textContent='Domain Registration';description.append(name,detail);
    const price=document.createElement('div');price.className='cart-price';
    const catalogue=priceForHostname(item.domain),select=document.createElement('select');select.setAttribute('aria-label',`Registration period for ${item.domain}`);select.disabled=paymentBusy||!catalogue;if(!catalogue){select.dataset.unpriced='true';const option=document.createElement('option');option.textContent='Price unavailable';select.append(option);}
    if(catalogue)for(let years=1;years<=5;years++){const option=document.createElement('option');option.value=String(years);option.textContent=`${money(termPriceCents(catalogue,years)/100)} / ${years} ${years===1?'year':'years'}`;option.selected=years===item.selectedYears;select.append(option);}
    select.addEventListener('change',()=>{
      if(!catalogue||paymentBusy)return;
      const years=Number(select.value);if(!validYears(years))return;
      const next=cart.map((value,i)=>i===index?{...value,selectedYears:years,registrationPrice:termPriceCents(catalogue,years)/100}:value);
      if(!saveCart(next))render();
      byId('cart-items').querySelectorAll('select')[index]?.focus();
    });
    const renewal=document.createElement('small');renewal.textContent=catalogue?`Year 2 renewal: ${money(catalogue.renewalCents/100)} / year`:'Renewal price to be confirmed';price.append(select,renewal);
    if(item.selectedYears>1){const included=document.createElement('small');included.className='term-included';included.textContent='Year 2 is included in this total';price.append(included);}
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'remove';remove.disabled=paymentBusy;remove.title='Remove domain';remove.setAttribute('aria-label', `Remove ${item.domain}`);remove.innerHTML='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/></svg>';
    remove.addEventListener('click', () => {
      if(paymentBusy||!saveCart(cart.filter((_,i)=>i!==index)))return;
      (byId('cart-items').querySelector('button') || byId('empty').querySelector('a'))?.focus();
    });
    row.append(description,price,remove);items.append(row);summary.append(summaryRow(`${item.domain} · ${item.selectedYears} ${item.selectedYears===1?'year':'years'}`,item.registrationPrice));
  });
  if (hosting.checked) summary.append(summaryRow('Starter hosting with email · first month', 60));
  byId('total').textContent = money(total());
}
hosting.addEventListener('change', render);
byId('empty-cart').addEventListener('click',()=>{if(!paymentBusy)saveCart([]);});
form.querySelectorAll<HTMLInputElement>('input[name="account"]').forEach(radio => radio.addEventListener('change', () => {
  byId('login-status').textContent = '';
  const existing = account() === 'existing';
  byId('account-login').hidden = !existing;
  const billingFields = byId<HTMLFieldSetElement>('billing-fields');
  billingFields.hidden = existing;
  billingFields.disabled = existing;
  byId('account-note').hidden = existing;
  byId('password-help').hidden = existing;
  byId('owner-source').textContent = existing
    ? 'Use my saved account details for the domain owner'
    : 'Use my billing details for the domain owner';
  const password = byId<HTMLInputElement>('password'); password.minLength = existing ? 1 : 8; password.autocomplete = existing ? 'current-password' : 'new-password'; password.value = '';
  byId('password-help').textContent = existing ? '' : 'At least 8 characters';
  byId('account-note').textContent = existing ? 'Sign in to use your saved account details.' : 'Create your account as part of checkout. When you continue, we will email you a link to verify your address before payment.';
}));
byId<HTMLInputElement>('same-owner').addEventListener('change', event => {
  const same = (event.target as HTMLInputElement).checked;
  const fields = byId<HTMLFieldSetElement>('owner-fields'); fields.hidden = same; fields.disabled = same;
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (paymentBusy || !cart.length || !form.reportValidity()) return;
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const paymentStatus=byId('payment-status');
  paymentBusy = true;lockCart(true); submit.disabled = true; paymentStatus.textContent = 'Checking your account…';
  try {
    if(cart.some(item=>!priceForHostname(item.domain)))throw new Error('Pricing is currently available for .co.za and .com only. Remove unpriced domains or contact WDP before continuing.');
    const billingProfile=await ensureCheckoutAccount();
    paymentStatus.textContent = 'Preparing secure payment…';
    const ownerField=(name:string)=>(form.elements.namedItem(name) as HTMLInputElement).value;
    const registrant=byId<HTMLInputElement>('same-owner').checked?{sameAsBilling:true}:{sameAsBilling:false,name:ownerField('ownerName'),email:ownerField('ownerEmail'),phone:ownerField('ownerPhone'),company:ownerField('ownerCompany'),address:ownerField('ownerAddress'),city:ownerField('ownerCity'),province:ownerField('ownerProvince'),postalCode:ownerField('ownerPostalCode'),country:ownerField('ownerCountry')};
    const payload = {domains:cart.map(item=>({domain:item.domain,years:item.selectedYears})), hosting:hosting.checked, termsAccepted:byId<HTMLInputElement>('terms').checked, quotedAmount:Math.round(total()*100),registrant};
    // Include purchase details in retry identity without retaining personal data in session storage.
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({payload,billingProfile})));
    const fingerprint = Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
    let saved;
    try { saved = JSON.parse(sessionStorage.getItem('wdp_payment_attempt') || 'null'); } catch { saved = null; }
    if (!saved || saved.fingerprint !== fingerprint || saved.completed) saved = {attemptId:crypto.randomUUID(), accessToken:crypto.randomUUID(), fingerprint};
    sessionStorage.setItem('wdp_payment_attempt',JSON.stringify(saved));
    // WDP saves the cart and registrant snapshot; passwords/card details are never sent here.
    const response = await fetch('/api/payments/create', {
      method:'POST', headers:{'Content-Type':'application/json'}, signal:AbortSignal.timeout(20000),
      body:JSON.stringify({...payload, attemptId:saved.attemptId, accessToken:saved.accessToken})
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Unable to start payment. Please try again.');
    const destination = new URL(result.redirectUrl);
    if (destination.protocol !== 'https:' || !(destination.hostname === 'yoco.com' || destination.hostname.endsWith('.yoco.com'))) throw new Error('Invalid payment destination.');
    window.location.assign(destination.href);
  } catch(error) {
    status.textContent = error instanceof Error && error.name === 'TimeoutError'
      ? 'Payment setup timed out. Retry to resume the same payment attempt.'
      : error instanceof Error ? error.message : 'Unable to start payment. Please try again.';
    paymentStatus.textContent=status.textContent;
    paymentStatus.focus({preventScroll:true});
    paymentStatus.scrollIntoView({block:'center'});
  } finally { paymentBusy = false;lockCart(false); submit.disabled = false; }
});
window.addEventListener('storage', event => {
  if (event.key !== 'cart_domains' && event.key !== null) return;
  status.textContent = 'Your cart changed in another tab. Please review your order again.';
  loadCart(); render();
});
loadCart(); render();

void loadCheckoutAccount();
