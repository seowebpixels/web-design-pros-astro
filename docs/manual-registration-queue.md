# Manual domain registration queue

## Enable

1. In D1 **wdp-db → Console**, execute the whole `migrations/0006_domain_registration_queue.sql`. It adds domain registration records and an append-only audit table; it does not modify the old sample domain/service tables, accounts, payment credentials or order sequence.
2. In Cloudflare Pages **Production → Variables and secrets**, add Text values `WDP_REGISTRATION_QUEUE_ENABLED=true` and `WDP_REGISTRATION_ADMIN_EMAIL=admin@webdesignpros.co.za`.
3. Build, commit, push and wait for the Pages deployment. Keep existing settings/bindings, including the email/Telegram flags. This does not enable live payments.
4. Create/sign into the WDP account for **admin@webdesignpros.co.za** through `/account/` and verify that email. Check Spam if needed. An ordinary customer account is not an administrator, and the configured email alone is insufficient without a verified signed-in session. No shared admin password or public secret is added.
5. Open `/dashboard/registrations/`. The dashboard's **Registration queue** link appears only for the configured administrator. Page middleware and every API read/write independently check the administrator account; hiding the link is not the access control.

## Work an order

The default view is **Test purchases → Awaiting registration**. Only verified paid orders appear. A separate row is shown for each domain, with the WDP reference, term, amount, customer's billing name/email and the immutable registrant details supplied at purchase. Filters include Needs attention, Registration recorded and All paid domains. Pages contain up to 25 orders; Load more continues through older orders.

For a **real live order**, buy the requested term in TrueHost using the saved registrant details. Enter the actual registration date, actual registry expiry date and TH reference. Confirm the purchase is complete and save. A problem such as an unavailable name can be recorded under Needs attention, with an internal note; this does not issue refunds or substitute another domain automatically. Fixes are version-checked, and every successful change records actor, timestamp and before/after values in `wdp_registration_audit`. A stale edit returns 409 so another browser cannot silently overwrite a newer record.

For a **test order**, use the same form as a rehearsal. The button and confirmation explicitly describe a test record. Saving never purchases a domain, calls a registrar, provisions hosting, sends a customer registration email or relabels a test purchase as a real registered domain. Do not buy a test domain in TH. Live purchases remain empty until a separate live-payment implementation exists.

## Customer view

The customer's Domains page lists only their own paid domain purchases. It shows registration/expiry dates when recorded and separates test/live purchases. Internal notes, TH references, audit data, other customers and administrator controls are not exposed. Test entries always say **not registered**, including records used for rehearsal. The dashboard's registered-domain count includes only live recorded registrations.

My Services also shows recorded registration status and a separate registry expiry date. The existing **Next due date** remains the purchase-based billing anniversary for the selected term, as previously requested; it is not silently replaced by the registry expiry date. Hosting is unaffected. The order's fulfilment summary says `domains_registered` (or `test_domains_recorded`) only after all its domains are recorded; this does not imply hosting has been provisioned.

New paid-order email/Telegram alerts include a queue link after this feature is enabled. It contains no token or personal data and still requires administrator sign-in. Already-queued alert payloads are retained for retry idempotency. Existing test orders are visible in the queue but do not trigger fresh alerts simply from opening the screen.

## Verification

Automated tests use in-memory databases and mocked email/payment requests. They cover administrator access, CSRF, invalid/missing dates, unpaid/non-purchased domains, per-domain completion, issue notes, customer isolation, safe test labels, concurrent edits and audit consistency. No test makes a registrar purchase or sends customer mail.
