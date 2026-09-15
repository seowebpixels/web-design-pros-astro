/**
 * POST /api/enquiry
 *
 * Cloudflare Pages Function for WDP Growth Modal enquiries. The Astro site
 * remains fully static; Cloudflare deploys this file separately as a dynamic
 * endpoint. Email is sent through Resend's HTTPS API, not SMTP.
 */

interface Env {
  RESEND_API_KEY: string;
  ENQUIRY_TO_EMAIL?: string;
  ENQUIRY_FROM_EMAIL?: string;
}

interface PagesFunctionContext {
  request: Request;
  env: Env;
}

interface EnquiryPayload {
  source?: unknown;
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  business?: unknown;
  need?: unknown;
  goal?: unknown;
  timeframe?: unknown;
  budget?: unknown;
  website?: unknown;
}

const NEEDS: Record<string, string> = {
  leads: 'Lead Generation',
  sales: 'Online Sales',
  brand: 'Brand Visibility',
};

const GOALS: Record<string, string> = {
  '2x': 'Double Monthly Revenue',
  automation: 'Automate Inquiries',
  launch: 'Launch New Product',
};

const TIMEFRAMES: Record<string, string> = {
  asap: 'Immediate (ASAP)',
  '1month': 'Within 1 Month',
  '3months': '1–3 Months',
};

const BUDGETS: Record<string, string> = {
  starter: 'R10,000 – R25,000',
  growth: 'R25,000 – R50,000',
  custom: 'R50,000+',
};

function json(body: { ok: boolean; error?: string }, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function text(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

function isAllowed(map: Record<string, string>, value: string): boolean {
  return Object.prototype.hasOwnProperty.call(map, value);
}

export async function onRequestPost({ request, env }: PagesFunctionContext): Promise<Response> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return json({ ok: false, error: 'Please submit the form again.' }, 415);
  }

  const declaredSize = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredSize) && declaredSize > 20_000) {
    return json({ ok: false, error: 'The submission is too large.' }, 413);
  }

  let payload: EnquiryPayload;
  try {
    payload = (await request.json()) as EnquiryPayload;
  } catch {
    return json({ ok: false, error: 'Please submit the form again.' }, 400);
  }

  // Bots commonly fill this hidden field. Return a neutral success response so
  // the endpoint does not teach automated senders how the filter works.
  if (text(payload.website, 200)) {
    return json({ ok: true });
  }

  const source = text(payload.source, 40);
  const name = text(payload.name, 100);
  const email = text(payload.email, 254).toLowerCase();
  const phone = text(payload.phone, 40);
  const business = text(payload.business, 120);
  const need = text(payload.need, 30);
  const goal = text(payload.goal, 30);
  const timeframe = text(payload.timeframe, 30);
  const budget = text(payload.budget, 30);

  if (
    source !== 'growth-modal' ||
    name.length < 2 ||
    !isEmail(email) ||
    phone.length < 7 ||
    !isAllowed(NEEDS, need) ||
    !isAllowed(GOALS, goal) ||
    !isAllowed(TIMEFRAMES, timeframe) ||
    !isAllowed(BUDGETS, budget)
  ) {
    return json({ ok: false, error: 'Please check the form and complete every required field.' }, 400);
  }

  if (!env.RESEND_API_KEY) {
    return json({ ok: false, error: 'Email delivery is temporarily unavailable.' }, 503);
  }

  const to = env.ENQUIRY_TO_EMAIL || 'info@webdesignpros.co.za';
  const from =
    env.ENQUIRY_FROM_EMAIL ||
    'Web Design Pros Website <enquiries@send.webdesignpros.co.za>';

  const message = [
    'A new Growth Check enquiry was submitted on Web Design Pros.',
    '',
    `Name: ${name}`,
    `Email: ${email}`,
    `Phone: ${phone}`,
    `Business: ${business || 'Not provided'}`,
    '',
    `Need: ${NEEDS[need]}`,
    `Goal: ${GOALS[goal]}`,
    `Time frame: ${TIMEFRAMES[timeframe]}`,
    `Budget: ${BUDGETS[budget]}`,
    '',
    `Submitted: ${new Date().toISOString()}`,
  ].join('\n');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: email,
        subject: `New Growth Check enquiry — ${business || name}`,
        text: message,
      }),
      signal: controller.signal,
    });

    if (!resendResponse.ok) {
      return json({ ok: false, error: 'We could not send your request right now. Please try again.' }, 502);
    }

    return json({ ok: true });
  } catch {
    return json({ ok: false, error: 'We could not send your request right now. Please try again.' }, 502);
  } finally {
    clearTimeout(timeout);
  }
}

export async function onRequest(): Promise<Response> {
  return new Response(
    JSON.stringify({ ok: false, error: 'Method not allowed.' }),
    {
      status: 405,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        allow: 'POST',
      },
    },
  );
}
