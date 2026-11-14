import {accountFailure} from '../../../src/lib/accounts/auth';
import {requireRegistrationAdmin} from '../../../src/lib/orders/registrations';
import type {AccountEnv} from '../../../src/lib/accounts/auth';
export const onRequest:PagesFunction<AccountEnv>=async context=>{
  try{await requireRegistrationAdmin(context.request,context.env,p=>context.waitUntil(p));return await context.next();}
  catch(error){return accountFailure(error);}
};
