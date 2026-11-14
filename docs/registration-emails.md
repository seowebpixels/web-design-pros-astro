# Customer domain registration confirmations

## Enable on Cloudflare Pages

1. In **D1 → wdp-db → Console**, execute the complete contents of `migrations/0007_registration_emails.sql`. It only adds the confirmation delivery table and index. There are no leading SQL comments to strip when pasting into the dashboard.
2. Under Pages **Settings → Production → Variables and secrets**, add Text variables:
   - `WDP_REGISTRATION_EMAIL_ENABLED`: `true`
   - `WDP_REGISTRATION_TEST_EMAILS_ENABLED`: `true` while rehearsing test purchases. Disable this before production use; live confirmations use the first flag independently.
3. Keep the existing `RESEND_API_KEY`, `AUTH_FROM_EMAIL`, `AUTH_BASE_URL`, account settings and admin restrictions. No new secret or Resend domain is required. Commit/push and wait for deployment.

## Exercise

Choose one test purchase in the private Registration queue, enter sample dates/reference, select registered, confirm and save. Its verified WDP customer account email receives **TEST registration confirmation** with the domain, WDP reference, sample dates and a link to Domains. It explicitly says no domain was registered. No message goes to the registrant's possibly different email, Telegram, or an address supplied in the admin request.

Existing completed registrations are not automatically mailed on deployment. To rehearse one, open **Registration recorded** or **All paid domains**, then save that record again. Enabling notifications allows its first confirmation to be queued; subsequent notes/date edits and status toggles do not send another confirmation. New domains in the same order each receive their own email. Pending or issue statuses do not trigger a confirmation.

For live purchases, the subject is **Your domain is registered**, with the actual registration/expiry dates and WDP production reference. There is no registrar API call or live-payment switch in this feature.

## Delivery and recovery

The registration, audit entry and email queue entry commit in the same D1 transaction. A failed send leaves the registration saved. The Save response distinguishes provider acceptance from queued delivery; acceptance does not guarantee inbox delivery. Review bounces/suppressions in Resend when necessary.

`wdp_registration_emails` has a unique `(order_id,domain)` entry. The first confirmation payload and verified customer recipient are frozen for repeat-safe retries; later corrections do not silently rewrite an email that might already have been sent. Handle substantive corrections separately. Leases prevent ordinary concurrent sends, and Resend requests reuse a stable idempotency key. Uncertain sends older than 23 hours from the first attempt are held as `manual_review` to avoid resending outside Resend's 24-hour deduplication window.

Check status without exposing email payloads:

```sql
SELECT order_id, domain, status, attempts, last_error, sent_at
FROM wdp_registration_emails ORDER BY created_at DESC;
```

The existing protected `/api/internal/order-alerts` retry endpoint now also processes up to 20 due registration confirmations. Run `node scripts/retry-order-alerts.mjs` after at least one minute to retry a failed send. It reuses the private retry secret already saved in ignored `.dev.vars`. No automatic schedule has been configured. A later save of the same registered domain also attempts its due pending email. Turning off a notification flag pauses that mode's delivery. Never reset a `sent` or `manual_review` record without checking Resend first.

Tests mock all Resend calls. They cover per-domain messages, correct verified customer recipient, test/live wording, private-field exclusion, pending/unpaid restrictions, transaction revision checks, edits, concurrent delivery, failed-send recovery and old uncertain delivery holds.

Reference: https://resend.com/docs/dashboard/emails/idempotency-keys
