# Final launch pass — DC parked 15 November 2026

User decision: park domain checkout (DC) at its current tested state. Prioritise the missing public Services pages and the rest of the website. Return to this checklist before launch; do not treat DC as live-ready.

- Approve final TLD registration, transfer and renewal pricing. Only .co.za and .com have approved catalogue pricing; spreadsheet work remains.
- Deploy and configure the separate scheduled renewal reminder Worker. Manual reminder delivery was tested successfully, including eight accepted messages (seven reminders and one confirmation).
- Verify a repeated reminder run sends no duplicate emails. Completion of that manual check is not yet confirmed.
- Implement and verify live Yoco payments. Current checkout supports test payments only.
- Verify production domain, payment callbacks, account ownership/admin restrictions, PDF downloads and one complete live purchase.
- Review customer terms for registration, renewal and expired domains against the actual operating process.
- TrueHost reseller plan, migration, individual client cPanel provisioning and final hosting package pricing/storage remain separate unresolved hosting dependencies. Do not promise those facilities as already provisioned.

Current DC behaviour: manual registration/renewal recording; customer-consolidated registration completion email with one invoice PDF; renewal confirmation email with PDF; recorded expiry updates; uncertain Telegram deliveries held for deliberate review. Company invoice identity: Web Design Pros (Pty) Ltd; CIPC 2026/282129/07 in footer. No customer-facing VAT references.

Services show original purchase references, latest completed renewal price/term, purchased multi-year registration terms, coverage dates kept on one line and no-renewal-needed messaging outside the 30-day window.

Do not reset order sequences, repeat a paid renewal, change invoice design or enable live payments as part of building public Services pages.
