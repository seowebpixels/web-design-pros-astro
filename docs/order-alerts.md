# Paid-order email and Telegram alerts

Owner-approved recipient: **info@webdesignpros.co.za**. Email uses the existing Resend account/sender. Telegram uses a dedicated bot and the owner's private chat. Alerts contain only the WDP reference, domain names, selected periods, payment total and hosting choice. Customer names, addresses, contact details, passwords, payment access tokens and card data are not sent in these alerts. The private registration queue is a separate next step; these alerts do not register domains or mark them active.

## Setup

1. In **wdp-db → Console**, execute `migrations/0005_order_alerts.sql` in full. It adds a delivery table/index without replacing accounts/orders. Keep the separate payment DB unchanged.
2. In Telegram open the verified **@BotFather**, send `/newbot`, choose a name and an available username ending in `bot`. Keep the token private. Open your own new bot and press Start.
3. From the project folder run `node scripts/setup-telegram-alerts.mjs`. Paste the token at the hidden prompt (nothing appears), press Enter. Send the unique connection code the helper displays into your private chat with the bot; press Enter in the terminal. It identifies only that private chat, saves settings in ignored `.dev.vars`, and sends a harmless setup message. Use a new dedicated bot with no existing webhook; do not remove another integration's webhook. Never paste tokens or `.dev.vars` into chat/GitHub/screenshots.
4. Open `.dev.vars` locally in Notepad. In Cloudflare Pages **Production → Variables and secrets**, add:

| Name | Type | Value |
|---|---|---|
| WDP_ORDER_EMAIL_ENABLED | Text | true |
| WDP_ORDER_TELEGRAM_ENABLED | Text | true |
| WDP_ORDER_TEST_ALERTS_ENABLED | Text | true while exercising sandbox orders |
| WDP_ORDER_ALERT_EMAIL | Text | info@webdesignpros.co.za |
| WDP_TELEGRAM_BOT_TOKEN | Secret | helper's saved value |
| WDP_TELEGRAM_CHAT_ID | Secret | helper's saved value |
| WDP_ORDER_ALERT_RETRY_SECRET | Secret | helper's saved value |

Keep `RESEND_API_KEY` and `AUTH_FROM_EMAIL` as already configured. Build/push/redeploy. Settings affect the next deployment. These flags do not enable live payments.

## Verify

Make one **new** test purchase using the provider test card. After verified payment, both channels should show `TEST paid order WDP-TEST-… — do not register`. Neither cancelling nor opening a success URL sends a paid alert. Payment notification replays do not ordinarily send again. This does not send customer order-confirmation emails.

The existing provider webhook verifies signature, amount/currency/mode and saves paid status before queuing alerts. Delivery is tracked separately per channel, with a one-minute lease and retry delay. A failed alert returns 503 to the provider webhook to request redelivery; it never reverses payment. Email/Telegram are attempted independently. The customer's payment-status page reads the saved payment and remains available during an alert outage. Disabling a channel pauses delivery; disabling test alerts also pauses queued test deliveries.

## Check delivery and recover

In **wdp-db** run `SELECT order_id, channel, status, attempts, last_error, sent_at FROM wdp_order_alerts ORDER BY created_at DESC LIMIT 20;`. `sent` means the provider accepted it, not proof the human read it or that email avoided spam. Error values never contain secrets/provider response bodies. This endpoint does not backfill historical paid orders automatically.

Provider webhook retries are finite. For continued independent retries, configure a trusted scheduler to POST every five minutes to `https://web-design-pros-astro.pages.dev/api/internal/order-alerts` with `Authorization: Bearer <WDP_ORDER_ALERT_RETRY_SECRET>` stored as a secret. Never put the secret in the URL. The endpoint handles up to 20 due deliveries; repeatedly call it for larger backlogs. A scheduler is **not** provisioned by this change. Until one is configured, check the table and use the retry helper when needed.

Resend's idempotency window is 24 hours; an uncertain email retry after 23 hours is held as `manual_review` for checking Resend before any deliberate resend. Telegram has no idempotency key: a timeout or crash after acceptance but before recording success can produce a duplicate on retry. Match the WDP reference and fulfil the purchase only once. Repeated signed events and concurrent invocations normally reuse the same channel record and lease.

Official references: [Telegram Bot API](https://core.telegram.org/bots/api#sendmessage), [Resend send email](https://resend.com/docs/api-reference/emails/send-email), [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys).
