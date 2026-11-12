type CartItem = { domain: string; registrationPrice: number; renewalPrice: number | null; selectedYears: number };
const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const money = (value: number) => new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(value);
const status = byId('checkout-status');
let cart: CartItem[] = [];
const form = byId<HTMLFormElement>('checkout-form');
const dialog = byId<HTMLDialogElement>('yoco');
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
  byId('account-note').textContent = existing ? 'Sign in to use your saved account details.' : 'Create your account as part of checkout.';
}));
form.querySelectorAll('input[type="email"], #password').forEach(input => input.addEventListener('input', () => { byId('login-status').textContent = ''; }));
byId('account-login').addEventListener('click', () => {
  const email = form.elements.namedItem('email') as HTMLInputElement;
  const password = byId<HTMLInputElement>('password');
  if (!email.reportValidity() || !password.reportValidity()) return;
  byId('login-status').textContent = 'Account sign-in is not available yet. Please contact WDP for help with your account.';
});
byId<HTMLInputElement>('same-owner').addEventListener('change', event => {
  const same = (event.target as HTMLInputElement).checked;
  const fields = byId<HTMLFieldSetElement>('owner-fields'); fields.hidden = same; fields.disabled = same;
});
form.addEventListener('submit', event => {
  event.preventDefault();
  if (!cart.length || !form.reportValidity()) return;
  if (account() === 'existing') { status.textContent = 'Account sign-in is not available yet. Please contact WDP to continue with your order.'; byId('account-login').focus(); return; }
  status.textContent = '';
  dialog.showModal();
});
window.addEventListener('storage', event => {
  if (event.key !== 'cart_domains' && event.key !== null) return;
  if (dialog.open) dialog.close();
  status.textContent = 'Your cart changed in another tab. Please review your order again.';
  loadCart(); render();
});
loadCart(); render();
