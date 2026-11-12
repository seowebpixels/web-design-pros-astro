import { paymentWebhook } from '../../../src/lib/payments/handlers';
import type { PaymentEnv } from '../../../src/lib/payments/core';
export const onRequestPost: PagesFunction<PaymentEnv> = paymentWebhook;
