export {};
const params = new URLSearchParams(location.search);
const attempt = params.get('attempt');
const outcome = params.get('outcome');
const title = document.getElementById('result-title')!;
const message = document.getElementById('result-message')!;
const button = document.getElementById('check-payment') as HTMLButtonElement;
let polls = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let busy = false;
async function check() {
  if (busy) return;
  busy = true; button.disabled = true; clearTimeout(timer);
  try {
    const saved = JSON.parse(sessionStorage.getItem('wdp_payment_attempt') || 'null');
    if (!attempt || saved?.attemptId !== attempt || !saved?.accessToken) {
      title.textContent = 'Payment status unavailable';
      message.textContent = 'Open this page in the same browser tab used for payment, or contact WDP. This address alone does not confirm a payment.';
      return;
    }
    const response = await fetch(`/api/payments/status?attempt=${encodeURIComponent(attempt)}`,{headers:{Authorization:`Bearer ${saved.accessToken}`},cache:'no-store',signal:AbortSignal.timeout(10000)});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Unable to check payment.');
    document.getElementById('result-reference')!.textContent = `Reference: ${result.reference}`;
    if (result.status === 'paid') {
      title.textContent = 'Test payment confirmed';
      message.textContent = `The payment provider confirmed ${new Intl.NumberFormat('en-ZA',{style:'currency',currency:'ZAR'}).format(result.amount/100)}. Your cart is kept so you can test again.`;
      button.hidden = true; saved.completed = true; sessionStorage.setItem('wdp_payment_attempt',JSON.stringify(saved));
    } else if (result.status === 'failed') {
      title.textContent = 'Payment unsuccessful'; message.textContent = 'Your cart is unchanged. Return to checkout to try again.';
      saved.completed = true; sessionStorage.setItem('wdp_payment_attempt',JSON.stringify(saved));
    } else {
      title.textContent = outcome === 'cancel' ? 'Payment not completed' : 'Awaiting payment confirmation';
      message.textContent = outcome === 'cancel' ? 'You returned without completing payment. Your cart is unchanged. If you paid before returning, wait for confirmation before trying again.' : 'We have not received verified payment confirmation yet. Please do not pay again while this is being checked.';
      if (++polls < 15) timer = setTimeout(check,2000);
    }
  } catch(error) {
    title.textContent = 'Unable to confirm payment'; message.textContent = error instanceof Error ? error.message : 'Please check again or contact WDP.';
  } finally { busy = false; button.disabled = false; }
}
button.addEventListener('click',() => {polls=0; void check();});
window.addEventListener('pagehide',()=>clearTimeout(timer));
void check();
