import { AccountError } from './auth';
const required = ['firstName','lastName','phone','address','city','province','postalCode','country'] as const;
export function validateProfile(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AccountError(400,'Please enter your billing details.');
  const input = body as Record<string,unknown>, result: Record<string,string> = {};
  for (const key of [...required,'company'] as const) {
    const value = input[key];
    if (typeof value !== 'string' || value.trim().length > 200 || /[\u0000-\u001f]/.test(value)) throw new AccountError(400,'Please check your billing details.');
    result[key] = value.trim();
    if (required.includes(key as any) && !result[key]) throw new AccountError(400,'Please complete all required billing details.');
  }
  return result;
}
