import { paymentStatus } from '../../../src/lib/payments/handlers';
import type { PaymentEnv } from '../../../src/lib/payments/core';
export const onRequestGet: PagesFunction<PaymentEnv> = paymentStatus;
