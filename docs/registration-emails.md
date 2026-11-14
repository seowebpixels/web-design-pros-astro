# Customer domain registration confirmations

## Enable on Cloudflare Pages

1. In **D1 → wdp-db → Console**, execute the complete contents of `migrations/0007_registration_emails.sql`. It only adds the confirmation delivery table and index. There are no leading SQL comments to strip when pasting into the dashboard.
2. Under Pages **Settings → Production → Variables and secrets**, add Text variables:
   - `WDP_REGISTRATION_EMAIL_ENABLED`: `true`
   - `WDP_REGISTRATION_TEST_EMAILS_ENABLED`: `true` while rehearsing test purchases. Disable this before production use; live confirmations use the first flag independently.
3. Keep the existing `RESEND_API_KEY`, `AUTH_FROM_EMAIL`, `AUTH_BASE_URL`, account settings and admin restrictions. PDF attachments also require the renderer settings below; no new Resend domain is required. Commit/push and wait for deployment.

## Exercise

Create several paid test orders under ONE customer account. These can be old or new purchases. Register all but one domain: no customer confirmation should be sent. A missing, pending or issue registration in ANY paid order for that client holds delivery. Register the last outstanding domain: ONE email lists the newly completed orders and their domains, with ONE consolidated invoice PDF listing all purchases and the combined paid total.

Grouping uses the verified customer ID, not a supplied email address. Different clients are independent. Test and live purchases are separate pools, so old practice orders do not block real registrations. Failed/unpaid checkout attempts do not block delivery. There is no age cutoff: old paid orders are checked too.

Orders already owned by a sent confirmation are excluded from later emails. A later purchase starts the next group; this is not a one-email-for-life rule. Resaving, retries and concurrent final saves do not send extra confirmations. Registration dates, expiry dates and original invoice details are snapshotted together inside the final registration transaction. The existing invoice design is reused. One combined invoice uses the earliest included WDP reference, lists every original order reference on its items, and does not allocate another order number.

Historical per-domain/per-order queue records are retained and never rewritten or automatically resent. Those orders are treated as already covered to avoid duplicate invoices; historical unsent/uncertain messages still require manual review. Their unregistered domains DO still hold the client's completion gate. New client-wide confirmations do not send on deployment without a registration save.

For live purchases, the subject is **Your domain registrations are complete**. Tests retain an explicit no-money/no-registration message. There is no live-payment switch or registrar API in this feature.

## Delivery and recovery

The registration, audit entry and email queue entry commit in the same D1 transaction. A failed send leaves the registration saved. The Save response distinguishes provider acceptance from queued delivery; acceptance does not guarantee inbox delivery. Review bounces/suppressions in Resend when necessary.

`wdp_registration_emails` keeps its existing `(order_id,domain)` key: a client batch uses its earliest uncovered order and that order's first domain as a stable storage key. Its `scope: client` payload records ALL included order IDs. An atomic coverage check prevents a later save from allocating a second batch for those orders. No migration or new setting is needed.

Before its first email attempt, a waiting batch can absorb new paid orders for the same client once their domains are registered. Readiness is checked at queuing, claiming and just before sending. If a purchase arrives during PDF rendering, delivery pauses; a final concurrent completion causes one bounded recheck. After the first Resend attempt the request stays immutable, with the same attachments and idempotency key. Uncertain attempts older than 23 hours are held as `manual_review` rather than risking a duplicate outside Resend's 24-hour window.

One combined invoice is rendered and saved with its exact email request. If new purchases join before the first email attempt, its membership key changes and the PDF is rebuilt to include them. Once a send has been attempted, retries reuse the identical PDF. The combined stored message is limited to 1.8 MB to stay within D1's row limit; oversize mail stays pending with `pdf_size`. Review it manually instead of resetting delivery records.

Check status without exposing email payloads:

```sql
SELECT order_id, domain, status, attempts, last_error, sent_at
FROM wdp_registration_emails ORDER BY created_at DESC;
```

The existing protected `/api/internal/order-alerts` retry endpoint now also processes up to 20 due registration confirmations. Run `node scripts/retry-order-alerts.mjs` after at least one minute to retry a failed send. If a worker stopped during rendering, allow three minutes for its delivery lease to expire. It reuses the private retry secret already saved in ignored `.dev.vars`. No automatic schedule has been configured. A later save of the same registered domain also attempts its due pending email. Turning off a notification flag pauses that mode's delivery. Never reset a `sent` or `manual_review` record without checking Resend first.

Tests mock all Resend calls. They cover multi-domain/client completion, four separate old/new orders, independent clients, later purchases, issue/pending holds, concurrent final saves across orders, purchases arriving during PDF rendering, historical per-domain suppression, correct verified customer recipient, test/live wording, private-field exclusion, pending/unpaid restrictions, transaction revision checks, edits, concurrent delivery, failed-send recovery and old uncertain delivery holds.

Reference: https://resend.com/docs/dashboard/emails/idempotency-keys

## PDF invoice attachment

New confirmations attach the same invoice available in Billing, rendered from the deployed `/dashboard/invoice/` page and its print styles. No redesign, extra invoice number or new order sequence is created. It uses the saved purchase totals and billing details. Test invoices remain labelled as tests.

Before testing:

1. Find the Cloudflare account ID for the account hosting WDP (32 hexadecimal characters, not a D1 database ID).
2. In My Profile → API Tokens → Create Token → Custom Token, create an account token with **Browser Run: Edit**, restricted to that WDP account. Keep it private.
3. In Pages → Settings → Variables and secrets → Production, add `WDP_PDF_ACCOUNT_ID` as Text and `WDP_PDF_API_TOKEN` as an encrypted Secret. Keep existing Resend and registration-email flags. Browser Run must be available on the account; check its usage allowance. No browser binding or database migration is required.
4. Deploy after saving the settings. Do a NEW test purchase, then record its registration in the private queue. The customer's ONE confirmation should contain exactly ONE `<WDP reference>.pdf` listing every newly completed purchase in that client group. Compare it to Billing → the same invoice → Print / Save PDF.

The site fetches its static invoice template, CSS and logo through Pages ASSETS, fills text safely and removes scripts. No customer session, cookie, password or public invoice link goes to the renderer. The user explicitly approved sending invoice billing/purchase details to Cloudflare for PDF generation. Only the invoice's public font providers may be contacted during rendering.

PDF failures leave registration saved and email pending; a new confirmation is never sent without its required attachment. The complete email and PDF are persisted before sending, so retries reuse the same attachment and Resend idempotency key. Rendering failures do not start the 23-hour uncertain-send clock. PDFs are limited to 900 KB before base64 encoding for bounded D1 storage.

Existing sent emails are never resent. Older per-domain confirmations retain their audit record but are held for manual review, without automatic delivery or retroactive attachments. Use a new purchase for the attachment test.

For pending messages, run `node scripts/retry-order-alerts.mjs` after at least one minute. Error codes: `pdf_configuration` (missing settings), `pdf_asset`/`pdf_template` (deployed invoice asset problem), `pdf_render` (renderer error), `pdf_size` (PDF too large). No sensitive provider responses are logged. No automatic retry schedule is configured.

References:
- https://developers.cloudflare.com/browser-run/quick-actions/pdf-endpoint/
- https://developers.cloudflare.com/browser-run/pricing/
- https://developers.cloudflare.com/pages/functions/api-reference/
- https://resend.com/docs/api-reference/emails/send-email

The invoice company details and footer use **Web Design Pros (Pty) Ltd**, registration **2026/282129/07**. Billing groups finalized purchases under the same frozen combined invoice as the email, and invoice links from any included order resolve to that invoice. Previously sent historical invoices are preserved.
