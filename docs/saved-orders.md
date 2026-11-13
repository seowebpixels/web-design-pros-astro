# Saved customer orders (test mode)

This milestone saves a purchase before creating its test payment and displays it in the signed-in customer's order history. It does not enable live payments, register domains, provision hosting, generate invoices or send order-confirmation emails. Those remain subsequent milestones.

## Deploy in this order

1. In Cloudflare D1 **wdp-db → Console**, execute `migrations/0003_customer_orders.sql`. It adds two tables and an index; existing accounts and sample data are untouched. The file starts with SQL, not a comment, so Cloudflare's single-line paste cannot comment out the whole migration.
2. Keep both existing bindings: **DB → wdp-db** and **WDP_PAYMENT_DB → wdp-payment-tests**. No new secrets, flags or payment-database migration are needed. Accounts must remain enabled and configured.
3. Build and push the code as usual. Wait for a successful Cloudflare Pages deployment, then hard-refresh checkout before testing. An already open checkout tab running the older script must be refreshed to send its registrant selection.
4. Log in, choose a domain and optional R60 Starter hosting, check billing/registrant details and accept the terms. Continue to payment. A `WDP-TEST-0000001` style order reference is allocated before redirect. Cancelling keeps that order awaiting confirmation, since the return URL cannot prove a bank's result.
5. Finish a test payment. Verified payment status updates the saved order and clears only paid cart domains. The confirmation page links to **My orders** at `/dashboard/orders/`. Open an order to see the immutable item, billing and registrant snapshots. No test order provisions services, so the existing Domains/Services dashboard lists stay empty.
6. Repeat Continue/retry after an uncertain provider response: the same attempt should keep its order reference. Test another account: it must not see the first customer's orders. Older payments from before this migration do not automatically become orders.

## References and retries

- Test references are sequential `WDP-TEST-0000001`, `WDP-TEST-0000002`, etc.
- The production sequence is reserved at **2412**, formatting as **WDP-0002412**, then **WDP-0002413**. No code in this milestone allocates a live reference. Tests use in-memory databases and cannot consume the deployed production sequence.
- Order allocation and counter advancement run in one transactional D1 batch, with `(mode, sequence)` unique. Reusing the same attempt ID does not advance the counter. Numbers are assigned when the order is created, so an unpaid/abandoned order still has a reference. Numbers are not recycled; a gapless paid-order list is not promised.
- A payment attempt cannot be reused for different customers, prices, billing or registrant snapshots. Editing purchase details creates a new browser attempt identity. The browser stores a digest of the purchase identity, not a plaintext address in its payment-attempt fingerprint.
- The provider receives only the amount, currency, internal references and return URLs. Personal billing/registrant snapshots stay with WDP. Passwords/card details are not accepted by the payment/order endpoint.
- The existing terms link is recorded with the acceptance timestamp. Replace it with WDP's approved terms and policy version before launch; legal drafting remains deferred.

## Payment consistency

Payment records remain in the separate sandbox database. A verified webhook first updates that record, then updates the customer order. If the second write fails, the endpoint returns an error so the provider can redeliver; replay repairs the order without a duplicate. A private payment-status check also repairs an interrupted order update using the persisted verified payment record. Paid status is never downgraded by a later failure event.

There is no cross-database transaction, scheduled reconciliation or automatic stale-order expiry in this milestone. Reconciliation, multi-attempt customer recovery, final domain availability checks, price/tax policy and abuse protection remain pre-live work. Order-status labels do not imply fulfilment.

## Checks

```powershell
npx vitest run src/lib/orders/__tests__ src/lib/accounts/__tests__ src/lib/payments/__tests__ --no-file-parallelism
npx wrangler pages functions build functions --outdir .wrangler/order-functions --compatibility-flags nodejs_compat
npm run build
```

Customer endpoints use verified sessions, enforce ownership for both list and detail queries, return `no-store`, and expose neither private status-access hashes nor provider credentials. History loads 25 records at a time. Customer-detail snapshots are only returned for the authenticated owner.

Reference: [D1 database batch API](https://developers.cloudflare.com/d1/worker-api/d1-database/).
