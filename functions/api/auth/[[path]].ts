import { accountFailure, createAuth, AccountError, type AccountEnv } from '../../../src/lib/accounts/auth';
import { readBody } from '../../../src/lib/payments/core';
import { validateProfile } from '../../../src/lib/accounts/profile';
export const onRequest: PagesFunction<AccountEnv> = async context => {
  try {
    if (!['GET','POST'].includes(context.request.method)) return new Response(null,{status:405,headers:{Allow:'GET, POST'}});
    if (context.request.method === 'POST' && context.request.headers.get('origin') !== context.env.AUTH_BASE_URL) throw new AccountError(403,'Request not permitted.');
    let request = context.request;
    let initialProfile:Record<string,string>|undefined;
    if (request.method === 'POST') {
      const body=await readBody(request,16000);
      if(new URL(request.url).pathname.replace(/\/$/,'')==='/api/auth/sign-up/email') {
        let input;
        try{input=JSON.parse(body);}catch{throw new AccountError(400,'Invalid account request.');}
        if(input && Object.hasOwn(input,'billingProfile')) initialProfile=validateProfile(input.billingProfile);
      }
      request = new Request(request.url,{method:'POST',headers:request.headers,body});
    }
    const response = await createAuth(context.env,p=>context.waitUntil(p),initialProfile).handler(request);
    const headers = new Headers(response.headers); headers.set('cache-control','no-store');
    return new Response(response.body,{status:response.status,headers});
  } catch(error) { return accountFailure(error); }
};
