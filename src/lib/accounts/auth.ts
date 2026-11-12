import { betterAuth } from 'better-auth';
export interface AccountEnv {
  DB?: D1Database;
  WDP_ACCOUNTS_ENABLED?: string;
  AUTH_SECRET?: string;
  AUTH_BASE_URL?: string;
  AUTH_FROM_EMAIL?: string;
  RESEND_API_KEY?: string;
}
export class AccountError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function accountJson(value: unknown, status = 200) {
  return new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
}
export function accountFailure(error: unknown) {
  return error instanceof AccountError ? accountJson({error:error.message},error.status) : accountJson({error:'Account service unavailable. Please try again shortly.'},503);
}
export function createAuth(env: AccountEnv, waitUntil: (promise: Promise<unknown>)=>void) {
  if (env.WDP_ACCOUNTS_ENABLED !== 'true' || !env.DB || !env.AUTH_SECRET || env.AUTH_SECRET.length < 32 || !env.AUTH_BASE_URL || !env.RESEND_API_KEY || !env.AUTH_FROM_EMAIL)
    throw new AccountError(503,'Customer accounts are not configured yet. Please contact WDP.');
  const base = new URL(env.AUTH_BASE_URL);
  if (base.protocol !== 'https:' || base.origin !== env.AUTH_BASE_URL) throw new AccountError(503,'Account address is not configured correctly.');
  function send(to:string, subject:string, text:string) {
    // User approved Resend for verification/recovery email. Never log links or credentials.
    waitUntil(fetch('https://api.resend.com/emails',{
      method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json'},
      body:JSON.stringify({from:env.AUTH_FROM_EMAIL,to:[to],subject,text}),signal:AbortSignal.timeout(10000)
    }).then(response=>{if(!response.ok) throw new Error('Email delivery failed');}).catch(()=>{console.error('Account email delivery failed. Check Resend delivery status.');}));
  }
  return betterAuth({
    appName:'Web Design Pros',baseURL:base.origin,basePath:'/api/auth',secret:env.AUTH_SECRET,
    database:env.DB,trustedOrigins:[base.origin],
    user:{modelName:'wdp_auth_users'},
    session:{modelName:'wdp_auth_sessions',expiresIn:7*24*60*60,updateAge:24*60*60},
    account:{modelName:'wdp_auth_accounts',accountLinking:{enabled:false}},
    verification:{modelName:'wdp_auth_verifications'},
    emailAndPassword:{
      enabled:true,minPasswordLength:12,maxPasswordLength:128,requireEmailVerification:true,revokeSessionsOnPasswordReset:true,
      sendResetPassword:async({user,url})=>{send(user.email,'Reset your WDP password',`Use this link to reset your Web Design Pros password:\n\n${url}\n\nIf you did not request this, you can ignore this email.`);}
    },
    emailVerification:{
      sendOnSignUp:true,sendOnSignIn:true,autoSignInAfterVerification:true,expiresIn:3600,
      sendVerificationEmail:async({user,url})=>{send(user.email,'Verify your WDP email address',`Verify your email address to continue with Web Design Pros:\n\n${url}\n\nIf you did not create this account, you can ignore this email.`);}
    },
    rateLimit:{enabled:true,storage:'database',modelName:'wdp_auth_rate_limits',window:60,max:60,customRules:{
      '/sign-in/email':{window:60,max:5},'/sign-up/email':{window:60,max:5},'/request-password-reset':{window:60,max:3},'/send-verification-email':{window:60,max:3}
    }},
    advanced:{useSecureCookies:true,ipAddress:{ipAddressHeaders:['cf-connecting-ip']}}
  });
}
export async function requireCustomer(request:Request, env:AccountEnv, waitUntil:(p:Promise<unknown>)=>void) {
  const session = await createAuth(env,waitUntil).api.getSession({headers:request.headers});
  if (!session?.user?.emailVerified) throw new AccountError(401,'Please sign in to continue.');
  return session;
}
