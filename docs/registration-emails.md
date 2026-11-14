# Customer domain registration confirmations

## Enable on Cloudflare Pages

1. In **D1 → wdp-db → Console**, execute the complete contents of `migrations/0007_registration_emails.sql`. It only adds the confirmation delivery table and index. There are no leading SQL comments to strip when pasting into the dashboard.
2. Under Pages **Settings → Production → Variables and secrets**, add Text variables:
   - `WDP_REGISTRATION_EMAIL_ENABLED`: `true`
   - `WDP_REGISTRATION_TEST_EMAILS_ENABLED`: `true` while rehearsing test purchases. Disable this before production use; live confirmations use the first flag independently.
3. Keep the existing `RESEND_API_KEY`, `AUTH_FROM_EMAIL`, `AUTH_BASE_URL`, account settings and admin restrictions. PDF attachments also require the renderer settings below; no new Resend domain is required. Commit/push and wait for deployment.

## Exercise

Choose a NEW two-domain test purchase in the private Registration queue. Enter sample dates/reference, select registered, confirm and save the first domain: no email should be sent. Save the last domain as registered. Its verified WDP customer account email receives **TEST registration confirmation** only after every domain in the SAME paid order is registered. The one message lists all purchased domains with their sample dates, WDP reference, a link to Domains and one full-order PDF invoice attachment. It explicitly says no domain was registered. No message goes to the registrant's possibly different email, Telegram, or an address supplied in the admin request.

Separate purchases are independent, even for the same customer. An unfinished order does not hold up a completed order. Any pending, missing or issue domain in an order holds that order's confirmation. Registration dates and expiry dates for every domain are captured in the transaction that completes the last registration. The invoice itself is unchanged.

Resaving, correcting dates/notes, retrying, or recording domains concurrently does not send extra confirmations. Existing completed registrations are not automatically emailed on deployment. Historical orders with any old per-domain queue record do not receive a new order-level email. Old sent rows remain for audit; old pending/uncertain per-domain messages are held for manual review, never rewritten or automatically sent. Use a NEW purchase to test this change.

For live purchases, the subject is **Your domain is registered** or **Your domains are registered**, with the actual registration/expiry dates and WDP production reference. There is no registrar API call or live-payment switch in this feature.

## Delivery and recovery

The registration, audit entry and email queue entry commit in the same D1 transaction. A failed send leaves the registration saved. The Save response distinguishes provider acceptance from queued delivery; acceptance does not guarantee inbox delivery. Review bounces/suppressions in Resend when necessary.

`wdp_registration_emails` retains its existing `(order_id,domain)` key, with the order's first domain as the single canonical queue key for new order confirmations. No migration is required. A transaction-level check refuses to insert another queue row for an order that already has any notification history. The order confirmation payload and verified customer recipient are frozen for repeat-safe retries; later corrections do not silently rewrite an email that might already have been sent. Handle substantive corrections separately. Leases prevent ordinary concurrent sends, and Resend requests reuse a stable idempotency key. Uncertain sends older than 23 hours from the first attempt are held as `manual_review` to avoid resending outside Resend's 24-hour deduplication window.

Check status without exposing email payloads:

```sql
SELECT order_id, domain, status, attempts, last_error, sent_at
FROM wdp_registration_emails ORDER BY created_at DESC;
```

The existing protected `/api/internal/order-alerts` retry endpoint now also processes up to 20 due registration confirmations. Run `node scripts/retry-order-alerts.mjs` after at least one minute to retry a failed send. It reuses the private retry secret already saved in ignored `.dev.vars`. No automatic schedule has been configured. A later save of the same registered domain also attempts its due pending email. Turning off a notification flag pauses that mode's delivery. Never reset a `sent` or `manual_review` record without checking Resend first.

Tests mock all Resend calls. They cover multi-domain completion, independent orders, issue/pending holds, concurrent final saves, historical per-domain suppression, correct verified customer recipient, test/live wording, private-field exclusion, pending/unpaid restrictions, transaction revision checks, edits, concurrent delivery, failed-send recovery and old uncertain delivery holds.

Reference: https://resend.com/docs/dashboard/emails/idempotency-keys

## PDF invoice attachment

New confirmations attach the same invoice available in Billing, rendered from the deployed `/dashboard/invoice/` page and its print styles. No redesign, extra invoice number or new order sequence is created. It uses the saved purchase totals and billing details. Test invoices remain labelled as tests.

Before testing:

1. Find the Cloudflare account ID for the account hosting WDP (32 hexadecimal characters, not a D1 database ID).
2. In My Profile → API Tokens → Create Token → Custom Token, create an account token with **Browser Run: Edit**, restricted to that WDP account. Keep it private.
3. In Pages → Settings → Variables and secrets → Production, add `WDP_PDF_ACCOUNT_ID` as Text and `WDP_PDF_API_TOKEN` as an encrypted Secret. Keep existing Resend and registration-email flags. Browser Run must be available on the account; check its usage allowance. No browser binding or database migration is required.
4. Deploy after saving the settings. Do a NEW test purchase, then record its registration in the private queue. The customer's confirmation should contain `<WDP reference>.pdf`. Compare it to Billing → the same invoice → Print / Save PDF.

The site fetches its static invoice template, CSS and logo through Pages ASSETS, fills text safely and removes scripts. No customer session, cookie, password or public invoice link goes to the renderer. The user explicitly approved sending invoice billing/purchase details to Cloudflare for PDF generation. Only the invoice's public font providers may be contacted during rendering.

PDF failures leave registration saved and email pending; a new confirmation is never sent without its required attachment. The complete PDF and email request are persisted before sending, so retries reuse the same attachment bytes and Resend idempotency key. Rendering failures do not start the 23-hour uncertain-send clock. PDFs are limited to 900 KB before base64 encoding for bounded D1 storage.

Existing sent emails are never resent. Older per-domain confirmations retain their audit record but are held for manual review, without automatic delivery or retroactive attachments. Use a new purchase for the attachment test.

For pending messages, run `node scripts/retry-order-alerts.mjs` after at least one minute. Error codes: `pdf_configuration` (missing settings), `pdf_asset`/`pdf_template` (deployed invoice asset problem), `pdf_render` (renderer error), `pdf_size` (PDF too large). No sensitive provider responses are logged. No automatic retry schedule is configured.

References:
- https://developers.cloudflare.com/browser-run/quick-actions/pdf-endpoint/
- https://developers.cloudflare.com/browser-run/pricing/
- https://developers.cloudflare.com/pages/functions/api-reference/
- https://resend.com/docs/api-reference/emails/send-email
