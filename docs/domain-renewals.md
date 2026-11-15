# Domain renewals — sandbox rollout

Existing purchases, reference sequences and registration records are retained. No live payments are enabled. Domain expiry changes only after the verified WDP administrator records a paid renewal completed through TrueHost. Test renewals are practice records only.

## Deploy incrementally

1. Run `migrations/0008_domain_renewals.sql` in **wdp-db**, not the sandbox payment database. This is additive. Paste the complete SQL statements without adding a leading `--` comment in the one-line Cloudflare console.
2. Deploy the code through the existing GitHub / Cloudflare Pages workflow.
3. Set `WDP_RENEWALS_ENABLED=true` in Pages Production and redeploy. Test registered domains get a **Renew domain** link under My Domains. The existing Registration Queue links to the separate renewal queue. Server permissions restrict that queue to the same verified administrator.
4. Set `WDP_RENEWAL_EMAIL_ENABLED=true` and, for the sandbox exercise only, `WDP_RENEWAL_TEST_EMAILS_ENABLED=true`. Existing Resend and PDF settings are reused. Redeploy after setting variables. No emails are sent by adding these files alone.

Prices come from the current server catalogue, not the browser or an old registration price. One-year renewal uses the annual renewal amount. Multi-year amounts are the approved complete-term prices. Unknown TLDs and expired domains require contact with WDP, with no self-service payment. There is no auto-charge or card storage.

## Exercise the full flow

* Use a paid **test** purchase whose registration has been recorded with a future expiry.
* My Domains → Renew domain → select 1–5 years, check total and expected expiry, accept terms, pay using the provider's test card.
* Payment confirmation must leave the original expiry and new-domain cart unchanged. The renewal appears in Orders/Billing and generates the existing owner alerts, labelled renewal.
* A second browser must not create another order for the same domain/source/expiry. Resume an unpaid renewal in the original tab. If the provider checkout expired or the access token was lost, contact the administrator to reconcile it; this version deliberately does not create an automatic second checkout.
* Admin: Registration Queue → Open renewal queue → complete the manual test record. Confirm the TrueHost reference and exact expected new expiry. Do not actually buy a test renewal.
* My Domains and Services show the updated original record, with no duplicate service/domain. The customer receives a renewal confirmation and PDF using the existing invoice layout. A repeated confirmation does not extend the date again or send a second email.
* A client account must receive 403 from the admin API even when using the queue URL. A different customer's domain cannot be quoted for renewal.

## Reminder job

The job queues a reminder in the 30-day, 7-day and 1-day windows before the **recorded** expiry. It sends at most one per window/domain/expiry. If a domain is first seen inside the 7-day window, it sends that window only, not a backlog. Renewed records and paid renewals awaiting fulfilment suppress stale reminders. Expired domains never use normal checkout prices; redemption needs manual review.

Run `node scripts/run-renewal-reminders.mjs` to exercise the deployed endpoint. It reads the existing retry secret from ignored `.dev.vars` and prints counts only. To practise reminders, use a dedicated test registration with expiry within 30 days. Never alter a real domain expiry for testing.

For unattended reminders deploy the separate scheduled Worker:

```
npx wrangler deploy --config workers/wrangler.renewals.jsonc
npx wrangler secret put WDP_ORDER_ALERT_RETRY_SECRET --config workers/wrangler.renewals.jsonc
```

Enter the existing retry secret in the private prompt. The Worker calls the Pages endpoint hourly; it does not change the Pages deployment target. Each run delivers up to 20 queued emails. Confirm Worker logs and Resend delivery status. The cron is not deployed by `npm run build` or a normal Pages push. Pending counts are shown in the private renewal queue. Ambiguous deliveries older than the provider idempotency window are held for review instead of automatically resent. Registration confirmation emails and their consolidated invoices remain separate.

Before production: approve final renewal prices and terms, enable the separate live payment implementation, update the scheduled Worker's site origin, disable sandbox email sending and test end-to-end again. Existing live sequence starts at WDP-0002412 and is not reset here. Hosting prices are unchanged by this domain-only change.
