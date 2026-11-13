import {ensureCheckoutAccount,loadCheckoutAccount} from './checkout-account';
type CartItem = { domain: string; registrationPrice: number; renewalPrice: number | null; selectedYears: number };
const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const money = (value: number) => new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(value);
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
    cart = value.filter(item => item && typeof item.domain === 'string' && /^[a-z0-9.-]+$/i.test(item.domain) && Number.isFinite(item.registrationPrice) && item.registrationPrice > 0).map(item => ({...item, selectedYears: 1, renewalPrice: Number.isFinite(item.renewalPrice) && item.renewalPrice > 0 ? item.renewalPrice : null}));
    if (cart.length !== value.length) status.textContent = 'Some cart items could not be read. Please search for those domains again.';
  } catch { cart = []; status.textContent = 'Your saved cart could not be read. Please add your domains again.'; }
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
    const description = document.createElement('div');
    const name = document.createElement('strong'); name.textContent = item.domain;
    const detail = document.createElement('small'); detail.textContent = `1 year registration · ${item.renewalPrice ? `Renews at ${money(item.renewalPrice)} / year` : 'Renewal price to be confirmed'}`;
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'remove'; remove.textContent = 'Remove'; remove.setAttribute('aria-label', `Remove ${item.domain}`);
    remove.addEventListener('click', () => {
      const next = cart.filter((_, i) => i !== index);
      try { localStorage.setItem('cart_domains', JSON.stringify(next)); } catch { status.textContent = 'Your browser could not save this change. Please enable browser storage and retry.'; return; }
      cart = next; window.dispatchEvent(new Event('cart-updated')); render();
      (byId('cart-items').querySelector('button') || byId('empty').querySelector('a'))?.focus();
    });
    description.append(name, detail, remove);
    const price = document.createElement('strong'); price.textContent = money(item.registrationPrice);
    row.append(description, price); items.append(row); summary.append(summaryRow(item.domain, item.registrationPrice));
  });
  if (hosting.checked) summary.append(summaryRow('Starter hosting with email · first month', 60));
  byId('total').textContent = money(total());
}
hosting.addEventListener('change', render);
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
  paymentBusy = true; submit.disabled = true; paymentStatus.textContent = 'Checking your account…';
  try {
    const billingProfile=await ensureCheckoutAccount();
    paymentStatus.textContent = 'Preparing secure payment…';
    const ownerField=(name:string)=>(form.elements.namedItem(name) as HTMLInputElement).value;
    const registrant=byId<HTMLInputElement>('same-owner').checked?{sameAsBilling:true}:{sameAsBilling:false,name:ownerField('ownerName'),email:ownerField('ownerEmail'),phone:ownerField('ownerPhone'),company:ownerField('ownerCompany'),address:ownerField('ownerAddress'),city:ownerField('ownerCity'),province:ownerField('ownerProvince'),postalCode:ownerField('ownerPostalCode'),country:ownerField('ownerCountry')};
    const payload = {domains:cart.map(item=>item.domain), hosting:hosting.checked, termsAccepted:byId<HTMLInputElement>('terms').checked, quotedAmount:Math.round(total()*100),registrant};
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
  } finally { paymentBusy = false; submit.disabled = false; }
});
window.addEventListener('storage', event => {
  if (event.key !== 'cart_domains' && event.key !== null) return;
  status.textContent = 'Your cart changed in another tab. Please review your order again.';
  loadCart(); render();
});
loadCart(); render();

void loadCheckoutAccount();
