type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

// Called only with a response from the authenticated payment-status endpoint.
// The server supplies the paid domains, not a URL parameter or browser quote.
export function clearPaidDomains(
  payment: {status: string; paidDomains?: string[]},
  attempt: {cartCleared?: boolean; [key: string]: unknown},
  cartStorage: StorageLike,
  attemptStorage: StorageLike,
  notify: () => void,
) {
  if (payment.status !== 'paid' || attempt.cartCleared) return;
  if (!Array.isArray(payment.paidDomains) || !payment.paidDomains.length || payment.paidDomains.some(domain => typeof domain !== 'string' || !domain))
    throw new Error('Paid items could not be identified. Please check again.');
  const cart = JSON.parse(cartStorage.getItem('cart_domains') || '[]');
  if (!Array.isArray(cart)) throw new Error('Your cart could not be updated.');
  const paid = new Set(payment.paidDomains.map(domain => domain.toLowerCase()));
  const remaining = cart.filter(item => !item || typeof item.domain !== 'string' || !paid.has(item.domain.toLowerCase()));
  cartStorage.setItem('cart_domains', JSON.stringify(remaining));
  notify();
  // Remember completion so refreshing an old receipt never clears a new cart.
  attempt.cartCleared = true;
  attemptStorage.setItem('wdp_payment_attempt', JSON.stringify(attempt));
}
