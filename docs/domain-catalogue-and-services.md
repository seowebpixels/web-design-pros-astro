# Domain pricing and purchased services

The approved retail catalogue is `src/lib/domains/catalogue.ts`. It currently contains only these one-year prices (ZAR):

| TLD | Category | Registration | Transfer | Renewal |
| --- | --- | ---: | ---: | ---: |
| .co.za | Other | 75 | 0 | 125 |
| .com | Popular | 200 | 230 | 265 |

Money is stored as integer cents. A free transfer is zero, not a missing price. Both TLDs have the Hot flag. Unlisted extensions can still be checked for availability, but have no Buy action or server-side checkout price. Transfer prices are displayed; automated transfers are not implemented by this change.

The domain tables, homepage offers, domain-search cart entries, checkout renewal labels and payment quotes use this catalogue. Existing browser carts are retained; checkout refreshes approved registration/renewal prices from the catalogue and blocks payment for unpriced extensions. Historical paid orders are not repriced.

## Setup before deploying

In D1 **wdp-db → Console**, execute `migrations/0004_order_price_snapshots.sql`. This adds one table and can safely be rerun. It does not alter existing orders or the reference sequences. Keep the existing bindings/secrets. Build, push and hard-refresh the domain and checkout pages after deployment.

New orders save their quoted registration, renewal and transfer prices in the same transactional batch as order creation. Retrying an order does not replace its snapshot. Older orders without a snapshot display the current catalogue renewal price with an explicit label; their original paid registration amount stays unchanged.

## My Services

`/api/customer/services` requires a verified session and returns only that customer's paid test purchases, 25 orders per page. Each domain appears as **Domain Registration**. An ordered hosting add-on appears as **Starter Hosting**, R60/month. The dashboard Services count includes these paid purchase rows.

The page displays the annual renewal charge separately from the first-year amount paid. The Manage button opens the saved order and its registrant/billing details. Test purchases are labelled **Test purchase / Not registered** (hosting: Not provisioned). Due dates say **After registration** or **After activation**: a payment timestamp is not evidence of a registry registration/expiry date. No domain is marked Active and no date is invented. Registrar-confirmed service status, expiry dates, renewals and hosting activation remain future fulfilment work.

## Future spreadsheet import

An XLSX or CSV can be supplied when the remaining TLD prices are ready. Recommended columns: **TLD, Category, Registration, Transfer, Renewal, Years, Hot**. Use numeric ZAR amounts, with `0` for a free action and a blank for an action not offered. The importer must validate duplicates, suffixes, unsupported periods and invalid/negative amounts, preview changes and report rejected rows before updating the catalogue. It must not rewrite saved order-price snapshots or consume production reference numbers.

## Checks

```powershell
npx vitest run src/lib/orders/__tests__ src/lib/accounts/__tests__ src/lib/payments/__tests__ --no-file-parallelism
npx wrangler pages functions build functions --outdir .wrangler/services-functions --compatibility-flags nodejs_compat
npm run build
```
