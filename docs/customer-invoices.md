# Customer invoices and Billing

Billing now lists the signed-in customer's confirmed paid purchases, including historical saved orders. Each invoice reuses its existing WDP order reference. Reading or printing it does not allocate another sequence number, charge the customer, modify payments, or create a domain registration. Viewing invoices needs no new migration or Cloudflare setting. PDF email attachments require the settings documented in `docs/registration-emails.md`.

## Customer flow

Open **Dashboard → Billing → View invoice**. A paid order also links directly to its invoice from Orders. **Print / Save PDF** opens the browser print dialog; choose Save as PDF to download. The invoice contains WDP's supplied CIPC number **2026/282129/07**, the public business contact details, the original customer billing snapshot, domain registration term, item amounts, confirmed payment date, total, amount paid and zero balance due. The owner requested no VAT references in customer-facing content. Invoices, Billing, checkout and domain-pricing pages therefore omit that wording, and the invoice response omits the seller tax-status field. The company registration number remains in the invoice footer and the organization metadata identifies it as a CIPC number.

Multi-year domain amounts are complete term totals from the saved order. A three-year .com purchase at R730 is one R730 item, not R730 per year or a sum of separate yearly rates. Hosting, when selected, is the first-month amount included in that saved total; future monthly charges and domain renewals are not added to the invoice. The current catalogue is not consulted.

Test purchases show **Test invoice**, **Test payment confirmed** and an explicit no-money/no-registration notice, including when printed. Test and live purchase lists are separate. No live payment mode is enabled by this work. The private page and every invoice API request require a verified customer session; guessing another customer's invoice ID returns 404. Provider IDs, access hashes, registration notes and registrant details are excluded. Responses are not cached.

Only paid orders are treated as invoices in this milestone. Pending, cancelled/unconfirmed and failed checkout attempts are not presented as unpaid debts. The dashboard's Unpaid invoices count therefore remains zero; an unpaid/renewal invoice issuing workflow and refunds/credit notes are separate work. These invoices are views of durable order snapshots, not separately issued accounting documents with their own independent number sequence. Registration confirmations now attach the same invoice as a PDF; setup is in `docs/registration-emails.md`. Seller details are currently the fixed business details in `src/lib/orders/invoices.ts`; snapshot those details when a separate live invoice-issuing process is introduced.

## Verify after deployment

1. Sign in as a customer with a paid test purchase. Billing should show the saved WDP-TEST reference and historical total.
2. Open its invoice. Check billing address, registration term, hosting when selected, total, no-VAT wording and CIPC number.
3. Print/save as PDF. The customer portal menu and buttons are omitted, while the test notice is retained.
4. Sign in as another customer: the first customer's invoice must be inaccessible.

Focused automated tests cover payment confirmation gating, failed attempts, account isolation, no-cache headers, price/term totals, historical address preservation, item-total validation, pagination and stable numbering. The wider suite still has the previously identified domain-availability tests importing obsolete function names; this Billing change does not modify that implementation.
