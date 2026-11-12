import { requireCustomer, type AccountEnv } from '../../src/lib/accounts/auth';
export const onRequest: PagesFunction<AccountEnv> = async context => {
  try {
    await requireCustomer(context.request,context.env,p=>context.waitUntil(p));
    const response = await context.next();
    const headers = new Headers(response.headers); headers.set('cache-control','private, no-store');
    return new Response(response.body,{status:response.status,headers});
  } catch {
    return new Response(null,{status:303,headers:{Location:'/account/?next=dashboard','cache-control':'no-store'}});
  }
};
