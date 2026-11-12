import { accountFailure, createAuth, AccountError, type AccountEnv } from '../../../src/lib/accounts/auth';
import { readBody } from '../../../src/lib/payments/core';
export const onRequest: PagesFunction<AccountEnv> = async context => {
  try {
    if (!['GET','POST'].includes(context.request.method)) return new Response(null,{status:405,headers:{Allow:'GET, POST'}});
    if (context.request.method === 'POST' && context.request.headers.get('origin') !== context.env.AUTH_BASE_URL) throw new AccountError(403,'Request not permitted.');
    let request = context.request;
    if (request.method === 'POST') request = new Request(request.url,{method:'POST',headers:request.headers,body:await readBody(request,16000)});
    const response = await createAuth(context.env,p=>context.waitUntil(p)).handler(request);
    const headers = new Headers(response.headers); headers.set('cache-control','no-store');
    return new Response(response.body,{status:response.status,headers});
  } catch(error) { return accountFailure(error); }
};
