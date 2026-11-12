import { createPayment } from '../../../src/lib/payments/handlers';
import type { PaymentEnv } from '../../../src/lib/payments/core';
export const onRequestPost: PagesFunction<PaymentEnv> = createPayment;
