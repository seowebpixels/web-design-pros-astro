# WDP test payments

This is a sandbox integration for exploring the real hosted payment journey. It cannot accept live keys or live webhook events. It creates **test-payment attempts**, not customer accounts, registrations, invoices, hosting or fulfilment tasks. Billing details/passwords are not sent to the payment API or saved. Paid domains are removed from the browser cart only after verified payment; unpaid and newly added domains remain.

## Cloudflare Pages setup

1. Create a D1 database named `wdp-payment-tests` in the same Cloudflare account as `web-design-pros-astro`. Keep this separate from any customer database. In its SQL console, run `migrations/0001_payment_tests.sql`. Do not run the older root `schema.sql`: it drops tables.
2. In the Pages project's Settings → Bindings, add a D1 binding named **WDP_PAYMENT_DB** pointing to that database. Configure the environment you actually deploy to (the main pages.dev address uses Production, despite payments being in test mode).
3. Under Variables and Secrets add:
   - `YOCO_TEST_SECRET_KEY`: encrypted secret, obtained from Yoco Checkout API settings, beginning `sk_test_`.
   - `WDP_PAYMENT_TEST_ENABLED`: text variable `true`.
4. Push the code and wait for deployment. Until the webhook secret is also configured, payment creation fails closed with a helpful message.
5. Register **one** Yoco test webhook at `https://web-design-pros-astro.pages.dev/api/payments/webhook`. Request the `payment.succeeded` event. Use the test key to call `POST https://payments.yoco.com/api/webhooks` with `{ "name": "WDP test payments", "url": "https://web-design-pros-astro.pages.dev/api/payments/webhook", "events": ["payment.succeeded"] }`. Save its returned `whsec_` secret securely; it is returned only once. Use the helper below instead of pasting keys into commands.
6. Add the returned secret to Cloudflare as **YOCO_TEST_WEBHOOK_SECRET** (encrypted secret). Redeploy after changing bindings/secrets.

`scripts/register-yoco-test-webhook.mjs` securely prompts for the key without echoing it. Run it in your own terminal, after deploying the endpoint. It writes the webhook secret into ignored `.dev.vars`, preserving existing settings. Add that secret to Cloudflare yourself; do not paste secrets in chat, commit them, or put them in PUBLIC_ variables. The helper lists existing webhooks first and refuses to create a duplicate if this URL is already registered. If the webhook exists and its secret is lost, deliberately delete/replace it in Yoco before rerunning.

```powershell
node scripts/register-yoco-test-webhook.mjs
```

## Exercise the journey

Search for a priced domain, open checkout, select **new customer**, enter sample details, accept the terms and continue to payment. Use the current test-card instructions shown in Yoco's account/developer testing guide, never a real card. The gateway is initially shown without custom branding so we can inspect its actual supported experience.

Try success, decline and cancel. Return URLs all go to `/payment/result/`, but success is shown only after a signed, matching **test** webhook. The browser polls for up to 30 seconds, then offers Check again. A pending result is not proof of failure; do not pay again until resolved. Paid domains are removed after verified payment. Cancelled, failed and pending attempts keep their cart. Unsaved form entries do not persist across navigation. Account sign-in remains unavailable until authentication is implemented.

On success, D1 should show `status = 'paid'`, the expected amount in cents and the provider payment ID. Repeat notifications do not cause fulfilment or duplicate updates. Amount/currency mismatches, stale/forged signatures and live-mode events are rejected. Unknown checkout events return 503 to allow redelivery if notification beats persistence.

Cancel does not mark the order paid or assume the bank failed. Retry uses the same attempt/provider idempotency key; a completed test attempt starts fresh on the next checkout. To test a cancelled/expired provider session afresh, first check D1/Yoco that it is unpaid, then remove `wdp_payment_attempt` from this tab's session storage. No automatic expiry/reconciliation is implemented yet.

## Verification and deployment

```powershell
npx vitest run
npx wrangler pages functions build functions --outdir .wrangler/payment-functions
npm run build
```

Astro 7's Cloudflare adapter produces a Workers server, whereas this existing project is deployed as **Pages static files plus root `functions/`**. Payment routes deliberately live in root `functions/api/payments` to match the deployed domain checker/enquiry architecture. `public/_routes.json` already includes `/api/*`. Do not deploy Astro's `dist/server` as a Pages worker or change deployment targets during this test.

Before accepting real money, separately implement authenticated customers, durable customer orders, final domain availability checks, fulfilment/notification handling, reconciliation, price/tax policy and abuse protection. This implementation deliberately has no live-mode switch.

Official references:
- https://developer.yoco.com/guides/online-payments/accepting-a-payment
- https://developer.yoco.com/api-reference/checkout-api/checkout/create-checkout
- https://developer.yoco.com/guides/online-payments/webhooks/verifying-the-events
- https://developer.yoco.com/api-reference/checkout-api/webhooks/register-webhook
