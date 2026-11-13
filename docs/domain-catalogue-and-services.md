# Domain pricing and purchased services

The approved retail catalogue is `src/lib/domains/catalogue.ts`. It currently contains only these annual prices (ZAR), updated by the owner on 2026-11-13:

| TLD | Category | Year 1 | Transfer | Year 2 | Year 3 | Year 4 | Year 5 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| .co.za | Other | 95 | 0 | 170 | 260 | 350 | 480 |
| .com | Popular | 210 | 235 | 460 | 730 | 950 | 1200 |

The owner corrected the pricing interpretation: each listed 1–5-year amount is the entire amount payable today for that term. Never add the years together. .co.za totals are **95 / 170 / 260 / 350 / 480**; .com totals are **210 / 460 / 730 / 950 / 1200**. The renewal caption follows the selection, e.g. **Renewal R730/3yrs** for .com over three years. A one-year registration retains the separate one-year renewal rate (.co.za R170, .com R460). Header, cart, order and service prices omit unnecessary zero cents.

Money is stored as integer cents. A free transfer is zero, not a missing price. Both TLDs have the Hot flag. Unlisted extensions can still be checked for availability, but have no Buy action or server-side checkout price. Transfer prices are displayed; automated transfers are not implemented by this change.

The domain tables, homepage offers, domain-search cart entries, checkout renewal labels and payment quotes use this catalogue. Existing browser carts are retained; checkout refreshes approved registration/renewal prices from the catalogue and blocks payment for unpriced extensions. Historical paid orders are not repriced.

## Setup before deploying

In D1 **wdp-db → Console**, execute `migrations/0004_order_price_snapshots.sql`. This adds one table and can safely be rerun. It does not alter existing orders or the reference sequences. Keep the existing bindings/secrets. Build, push and hard-refresh the domain and checkout pages after deployment.

New orders save their selected years, prepaid total, term price schedule, renewal charge and renewal period and transfer price in the same transactional batch as order creation. The payment server independently validates each integer period (1–5) and selected term amount. Retrying an order does not replace its snapshot. Older orders without selected years default to one year. Orders without a price snapshot display the current catalogue renewal price with an explicit label; their original paid registration amount stays unchanged. Renewal uses the selected term and price for multi-year purchases. Historical saved price snapshots are preserved.

## My Services

`/api/customer/services` requires a verified session and returns only that customer's paid test purchases, 25 orders per page. Each domain appears as **Domain Registration**. An ordered hosting add-on appears as **Starter Hosting**, R60/month. The dashboard Services count includes these paid purchase rows.

The page displays the renewal charge and period separately from the prepaid amount and term. The Manage button opens the saved order and its registrant/billing details. Test purchases are labelled **Test purchase / Not registered** (hosting: Not provisioned). The domain **Next due date** is at the end of the prepaid term, calculated from the original confirmed purchase date in South African time: one year for a one-year purchase, two years for a two-year purchase, etc. Hosting follows its monthly cycle. Leap-day/month-end anniversaries clamp to the last valid day of the target month. Older paid records without a confirmation timestamp fall back to the original order date. Refreshing the page or replaying a payment notification does not move the billing anniversary. This is a billing date, separate from the future registrar-confirmed registry expiry date. Registrar-confirmed service status, renewals and hosting activation remain future fulfilment work.

## Future spreadsheet import

An XLSX or CSV can be supplied when the remaining TLD prices are ready. Recommended columns: **TLD, Category, Registration (Year 1), Transfer, Renewal Year 2, Year 3, Year 4, Year 5, Hot**. Use numeric ZAR amounts, with `0` for a free action and a blank for an action not offered. The importer must validate duplicates, suffixes, unsupported periods and invalid/negative amounts, preview changes and report rejected rows before updating the catalogue. It must not rewrite saved order-price snapshots or consume production reference numbers.

## Checks

```powershell
npx vitest run src/lib/orders/__tests__ src/lib/accounts/__tests__ src/lib/payments/__tests__ --no-file-parallelism
npx wrangler pages functions build functions --outdir .wrangler/services-functions --compatibility-flags nodejs_compat
npm run build
```
