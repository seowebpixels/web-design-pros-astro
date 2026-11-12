# WDP customer accounts

This adds verified customer accounts, login/logout, password recovery and saved billing details. Accounts are real; payments still use the existing Yoco test engine. Domain registration, invoices and fulfilment are a later milestone. The old sample users/domains/services/invoices remain untouched and are no longer displayed in customer dashboards.

## Cloudflare setup

1. Open D1 **wdp-db → Console** and execute all of `migrations/0002_customer_accounts.sql`. This only adds tables and indexes. Do not execute the older root `schema.sql`, which drops tables. Keep the existing Pages binding **DB → wdp-db**, and the separate **WDP_PAYMENT_DB → wdp-payment-tests** binding.
2. Generate an account secret from the project terminal:

   ```powershell
   node scripts/create-account-secret.mjs
   notepad .dev.vars
   ```

   Copy only the value after `AUTH_SECRET=` into Cloudflare as an encrypted secret named **AUTH_SECRET**. Do not paste it into chat or commit `.dev.vars`. The helper preserves an existing secret and all other local settings.
3. In Pages **Settings → Variables and secrets → Production**, retain the existing Resend and payment settings and add:

   | Name | Type | Value |
   | --- | --- | --- |
   | AUTH_SECRET | Secret | Generated value from step 2 |
   | AUTH_BASE_URL | Text | `https://web-design-pros-astro.pages.dev` (no trailing slash) |
   | AUTH_FROM_EMAIL | Text | `Web Design Pros <enquiries@send.webdesignpros.co.za>` |
   | WDP_ACCOUNTS_ENABLED | Text | `true` |

   The sender must be verified in the existing Resend account. This uses the same sending domain as the enquiry integration. Resend receives the customer's address and verification/reset link, as approved by the site owner.
4. Install dependencies if transferring these files to another checkout (`npm install`), then build, commit and push the account changes. Cloudflare must deploy root `functions/` and static `dist/client` as before. `wrangler.json` includes `nodejs_compat`; retain it. Environment changes take effect on the next deployment.
5. Start with a new test customer at `/account/` or checkout. Verify the email link, complete billing details, then run another test payment. No real card or money is involved.

## Check the journey

- New email: checkout saves the validated billing details against the newly created account before sending a verification link. Sign-in/payment stay blocked until verified. On return, billing details are pre-populated even if the link opens a new tab. The cart stays in that browser. Passwords are never stored in browser drafts. A duplicate signup cannot replace an existing customer's billing details.
- Existing verified customer: login reveals saved billing details; a second customer cannot access the first customer's profile.
- Forgot password: generic confirmation avoids disclosing registered addresses; emailed reset tokens are single use. Reset revokes existing sessions. Passwords require at least 8 characters and are hashed by Better Auth.
- Logout: invalidates the session. Direct `/dashboard/` navigation redirects to login. Customer dashboard totals start empty until real orders/services/invoices are implemented.
- Payment success still clears only the paid cart items, based on the verified payment status. Cancelling keeps the cart.

Use customer test addresses you control when checking actual email delivery. Review Resend delivery status if an email does not arrive. Email links are sensitive and should not be shared in screenshots. Auth endpoints have database-backed rate limiting and same-origin POST checks; secure HttpOnly session cookies are used.

## Verification

```powershell
npx vitest run src/lib/accounts/__tests__/accounts.test.ts src/lib/payments/__tests__ --no-file-parallelism
npx wrangler pages functions build functions --outdir .wrangler/account-functions --compatibility-flags nodejs_compat
npm run build
```

Tests mock email delivery and exercise SQLite through a D1-shaped adapter. A real Cloudflare deployment and inbox check remain necessary. Existing domain-checker tests have unrelated missing-export failures; these account changes do not modify the checker.

Before switching the public domain, update AUTH_BASE_URL to the final HTTPS origin and redeploy. Old host cookies do not transfer to the new domain; customers sign in again. Payment live-mode enablement, durable orders, final availability checks and fulfilment remain separate work. Dependency audit findings in the existing build/test toolchain also need review before launch.

References: [Better Auth Cloudflare guide](https://better-auth.com/docs/guides/cloudflare), [email/password authentication](https://better-auth.com/docs/authentication/email-password).
