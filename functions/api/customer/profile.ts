import { accountJson, accountFailure, AccountError, requireCustomer, type AccountEnv } from '../../../src/lib/accounts/auth';
import { validateProfile } from '../../../src/lib/accounts/profile';
import { readBody } from '../../../src/lib/payments/core';
export const onRequestGet: PagesFunction<AccountEnv> = async context => {
  try {
    const session = await requireCustomer(context.request,context.env,p=>context.waitUntil(p));
    const row = await context.env.DB!.prepare('SELECT profile_json FROM wdp_customer_profiles WHERE auth_user_id=?').bind(session.user.id).first<{profile_json:string}>();
    return accountJson({user:{name:session.user.name,email:session.user.email},profile:row?JSON.parse(row.profile_json):null});
  } catch(error) {return accountFailure(error);}
};
export const onRequestPut: PagesFunction<AccountEnv> = async context => {
  try {
    if (context.request.headers.get('origin') !== context.env.AUTH_BASE_URL) throw new AccountError(403,'Request not permitted.');
    if (!context.request.headers.get('content-type')?.includes('application/json')) throw new AccountError(415,'JSON required.');
    const session = await requireCustomer(context.request,context.env,p=>context.waitUntil(p));
    let body;
    try {body=JSON.parse(await readBody(context.request,12000));} catch {throw new AccountError(400,'Please check your billing details.');}
    const profile = validateProfile(body);
    await context.env.DB!.prepare('INSERT INTO wdp_customer_profiles (auth_user_id,profile_json) VALUES (?,?) ON CONFLICT(auth_user_id) DO UPDATE SET profile_json=excluded.profile_json,updated_at=CURRENT_TIMESTAMP').bind(session.user.id,JSON.stringify(profile)).run();
    return accountJson({profile});
  } catch(error) {return accountFailure(error);}
};
