type CartItem = { domain: string; registrationPrice: number; renewalPrice: number | null; selectedYears: number };
const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const money = (value: number) => new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(value);
const status = byId('checkout-status');
let cart: CartItem[] = [];
let signedIn = false;
let paymentOpen = false;
const form = byId<HTMLFormElement>('checkout-form');
const dialog = byId<HTMLDialogElement>('yoco');
const hosting = byId<HTMLInputElement>('hosting');
const emailService = byId<HTMLInputElement>('email-service');
const account = () => form.querySelector<HTMLInputElement>('input[name="account"]:checked')!.value;
const extras = () => (hosting.checked ? 49 : 0) + (emailService.checked ? 29 : 0);
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
  if (hosting.checked) summary.append(summaryRow('Starter hosting · first month', 49));
  if (emailService.checked) summary.append(summaryRow('Business email · first month', 29));
  byId('total').textContent = money(total());
}
hosting.addEventListener('change', render); emailService.addEventListener('change', render);
form.querySelectorAll<HTMLInputElement>('input[name="account"]').forEach(radio => radio.addEventListener('change', () => {
  signedIn = false; byId('login-status').textContent = '';
  const existing = account() === 'existing';
  byId('demo-login').hidden = !existing;
  const password = byId<HTMLInputElement>('password'); password.minLength = existing ? 1 : 8; password.autocomplete = existing ? 'current-password' : 'new-password'; password.value = '';
  byId('password-help').textContent = existing ? 'Sample password only · preview sign-in below' : 'At least 8 characters · preview only';
  byId('account-note').textContent = existing ? 'Preview signing in without leaving checkout. Enter sample credentials and billing details; no real account is accessed.' : 'Create your account as part of checkout. Use a made-up password for this preview.';
}));
form.querySelectorAll('input[type="email"], #password').forEach(input => input.addEventListener('input', () => { signedIn = false; byId('login-status').textContent = ''; }));
byId('demo-login').addEventListener('click', () => {
  const email = form.elements.namedItem('email') as HTMLInputElement;
  const password = byId<HTMLInputElement>('password');
  if (!email.reportValidity() || !password.reportValidity()) return;
  signedIn = true; byId('login-status').textContent = 'Demo sign-in complete. Continue with your billing details below.';
});
byId<HTMLInputElement>('same-owner').addEventListener('change', event => {
  const same = (event.target as HTMLInputElement).checked;
  const fields = byId<HTMLFieldSetElement>('owner-fields'); fields.hidden = same; fields.disabled = same;
});
form.addEventListener('submit', event => {
  event.preventDefault();
  if (!cart.length || !form.reportValidity()) return;
  if (account() === 'existing' && !signedIn) { status.textContent = 'Please use Preview sign-in before continuing.'; byId('demo-login').focus(); return; }
  status.textContent = ''; paymentOpen = true;
  byId('payment-total').textContent = `Demo total: ${money(total())}`;
  dialog.showModal();
});
function closePayment(message: string) { paymentOpen = false; dialog.close(); status.textContent = message; }
byId('failure').addEventListener('click', () => closePayment('Mock payment failed. Your cart and details are still here; you can try again.'));
byId('cancel').addEventListener('click', () => closePayment('Mock payment cancelled. You can continue whenever you are ready.'));
dialog.addEventListener('close', () => { if (paymentOpen) { paymentOpen = false; status.textContent = 'Mock payment cancelled. Your cart is unchanged.'; } });
byId('success').addEventListener('click', () => {
  closePayment(''); byId('checkout-body').hidden = true;
  byId('confirmation-detail').textContent = `${cart.length} domain${cart.length === 1 ? '' : 's'} · ${money(total())} · Simulated payment received; registration would be pending.`;
  byId('confirmation').hidden = false; byId('confirmation').focus();
  byId<HTMLInputElement>('password').value = ''; signedIn = false;
});
byId('restart').addEventListener('click', () => { byId('confirmation').hidden = true; render(); form.querySelector<HTMLInputElement>('input[type="email"]')?.focus(); });
window.addEventListener('storage', event => {
  if (event.key !== 'cart_domains' && event.key !== null) return;
  if (dialog.open) closePayment('Your cart changed in another tab. Please review your order again.');
  byId('confirmation').hidden = true; loadCart(); render();
});
loadCart(); render();
