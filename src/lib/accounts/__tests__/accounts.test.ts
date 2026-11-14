import {afterEach,describe,expect,it,vi} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createAuth,requireCustomer,type AccountEnv} from '../auth';
import {onRequestGet,onRequestPut} from '../../../../functions/api/customer/profile';
import {onRequest as authEndpoint} from '../../../../functions/api/auth/[[path]]';
import {onRequest as dashboard} from '../../../../functions/dashboard/_middleware';
import {createPayment} from '../../payments/handlers';

function setup(){
  const sql=new DatabaseSync(':memory:');
  sql.exec('CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,email TEXT); INSERT INTO users VALUES (\'usr_01\',\'Sample owner\',\'sample@example.com\');');
  sql.exec(readFileSync('migrations/0002_customer_accounts.sql','utf8'));
  function prepare(query:string,args:any[]=[]):any{
    const run=()=>{const statement=sql.prepare(query);const rows=statement.columns().length?statement.all(...args):[];const result=statement.columns().length?{changes:0,lastInsertRowid:0}:statement.run(...args);return{results:rows,success:true,meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid)}};};
    return{bind:(...values:any[])=>prepare(query,values),all:async()=>run(),run:async()=>run(),first:async()=>sql.prepare(query).get(...args)??null};
  }
  const database={prepare,batch:async(statements:any[])=>Promise.all(statements.map(statement=>statement.all())),exec:async(query:string)=>sql.exec(query),dump:async()=>new ArrayBuffer(0)};
  const env={DB:database,WDP_ACCOUNTS_ENABLED:'true',AUTH_SECRET:'test-only-auth-secret-is-long-and-not-a-real-secret',AUTH_BASE_URL:'https://wdp.test',AUTH_FROM_EMAIL:'WDP <accounts@example.com>',RESEND_API_KEY:'test-only'} as unknown as AccountEnv;
  const tasks:Promise<unknown>[]=[];const waitUntil=(p:Promise<unknown>)=>tasks.push(p);
  const mail:any[]=[];
  vi.spyOn(globalThis,'fetch').mockImplementation(async(url,options)=>{expect(String(url)).toBe('https://api.resend.com/emails');mail.push(JSON.parse(options!.body as string));return new Response('{"id":"test-email"}',{status:200});});
  const auth=createAuth(env,waitUntil);
  const request=(path:string,body?:unknown,cookie='')=>new Request('https://wdp.test/api/auth/'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Origin:'https://wdp.test','cf-connecting-ip':'192.0.2.8',...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const cookie=(response:Response)=>response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
  async function register(email:string){return auth.handler(request('sign-up/email',{name:'Test customer',email,password:'test-password-long-enough',callbackURL:'/checkout/'}));}
  async function verify(email:string){await Promise.all(tasks);const emailMessage=mail.find(message=>message.to[0]===email);const link=emailMessage.text.match(/https:\/\/\S+/)[0];return auth.handler(new Request(link));}
  const context=(request:Request)=>({request,env,waitUntil}) as any;
  return {sql,env,auth,mail,request,cookie,register,verify,context,waitUntil,tasks};
}
afterEach(()=>vi.restoreAllMocks());
describe('customer accounts',()=>{
  it('does not enable accounts without configured secrets',()=>{expect(()=>createAuth({},()=>{})).toThrow('not configured');});
  it('saves signup billing details before sending verification and returns them in a new browser tab',async()=>{
    const app=setup();
    const billingProfile={firstName:'New',lastName:'Customer',phone:'0100000000',company:'',address:'Sample street',city:'Test city',province:'Test province',postalCode:'0000',country:'South Africa'};
    vi.mocked(fetch).mockImplementationOnce(async(_url,options)=>{
      const saved=app.sql.prepare('SELECT profile_json FROM wdp_customer_profiles').get()!;
      expect(JSON.parse(saved.profile_json as string)).toEqual(billingProfile);
      app.mail.push(JSON.parse(options!.body as string));
      return new Response('{"id":"test-email"}',{status:200});
    });
    const request=app.request('sign-up/email',{name:'New Customer',email:'new@example.com',password:'Abcd1234',callbackURL:'/checkout/',billingProfile});
    expect((await authEndpoint(app.context(request))).status).toBe(200);
    const cookie=app.cookie(await app.verify('new@example.com'));
    // A fresh request represents the verification tab: no browser draft is supplied.
    const response=await onRequestGet(app.context(new Request('https://wdp.test/api/customer/profile',{headers:{Cookie:cookie}})));
    expect(response.status).toBe(200);expect((await response.json()).profile).toEqual(billingProfile);
  });
  it('does not overwrite billing details through a duplicate unauthenticated signup',async()=>{
    const app=setup();
    const profile={firstName:'Original',lastName:'Customer',phone:'0100000000',company:'',address:'Sample street',city:'Test city',province:'Test province',postalCode:'0000',country:'South Africa'};
    const signup=(billingProfile:unknown)=>authEndpoint(app.context(app.request('sign-up/email',{name:'Customer',email:'same@example.com',password:'Abcd1234',callbackURL:'/checkout/',billingProfile})));
    expect((await signup(profile)).status).toBe(200);
    await signup({...profile,firstName:'Changed'});
    const saved=app.sql.prepare('SELECT profile_json FROM wdp_customer_profiles').get()!;
    expect(JSON.parse(saved.profile_json as string)).toEqual(profile);
    expect(app.sql.prepare('SELECT COUNT(*) AS n FROM wdp_auth_users').get()!.n).toBe(1);
  });
  it('rejects incomplete signup billing details before creating an account',async()=>{
    const app=setup();
    const response=await authEndpoint(app.context(app.request('sign-up/email',{name:'Customer',email:'new@example.com',password:'Abcd1234',billingProfile:{firstName:'Incomplete'}})));
    expect(response.status).toBe(400);expect(app.mail).toHaveLength(0);
    expect(app.sql.prepare('SELECT COUNT(*) AS n FROM wdp_auth_users').get()!.n).toBe(0);
  });
  it('accepts eight-character passwords and rejects seven for signup and password reset',async()=>{
    const app=setup();
    const signup=(email:string,password:string)=>app.auth.handler(app.request('sign-up/email',{name:'Test customer',email,password,callbackURL:'/checkout/'}));
    expect((await signup('short@example.com','Abcd123')).status).toBe(400);
    expect((await signup('eight@example.com','Abcd1234')).status).toBe(200);
    await app.verify('eight@example.com');app.mail.length=0;
    await app.auth.handler(app.request('request-password-reset',{email:'eight@example.com',redirectTo:'https://wdp.test/account/'}));
    await Promise.all(app.tasks);
    const link=app.mail[0].text.match(/https:\/\/\S+/)[0];
    const redirect=await app.auth.handler(new Request(link));
    const token=new URL(redirect.headers.get('location')!).searchParams.get('token');
    expect((await app.auth.handler(app.request('reset-password',{token,newPassword:'New1234'}))).status).toBe(400);
    expect((await app.auth.handler(app.request('reset-password',{token,newPassword:'New12345'}))).status).toBe(200);
  });
  it('creates separate auth records, hashes passwords, requires verification and issues secure session cookies',async()=>{
    const app=setup();const response=await app.register('new@example.com');
    expect(response.status).toBe(200);
    const credential=app.sql.prepare('SELECT password FROM wdp_auth_accounts').get()!;
    expect(credential.password).not.toBe('test-password-long-enough');
    expect(app.sql.prepare('SELECT COUNT(*) AS n FROM users').get()!.n).toBe(1);
    expect((await app.auth.handler(app.request('sign-in/email',{email:'new@example.com',password:'test-password-long-enough'}))).status).toBe(403);
    const verified=await app.verify('new@example.com');expect(verified.status).toBe(302);
    expect(verified.headers.get('set-cookie')).toMatch(/HttpOnly/i);expect(verified.headers.get('set-cookie')).toMatch(/Secure/i);
    const session=await requireCustomer(app.request('get-session',undefined,app.cookie(verified)),app.env,app.waitUntil);
    expect(session.user.email).toBe('new@example.com');
    expect(session.user.emailVerified).toBe(true);
  });
  it('rejects bad passwords and foreign origins',async()=>{
    const app=setup();await app.register('new@example.com');await app.verify('new@example.com');
    expect((await app.auth.handler(app.request('sign-in/email',{email:'new@example.com',password:'wrong-password'}))).status).toBe(401);
    const request=app.request('sign-in/email',{email:'new@example.com',password:'test-password-long-enough'});
    request.headers.set('origin','https://evil.test');expect((await authEndpoint(app.context(request))).status).toBe(403);
  });
  it('isolates saved billing profiles using the session owner and protects dashboard access',async()=>{
    const app=setup();await app.register('first@example.com');const first=app.cookie(await app.verify('first@example.com'));
    await app.register('second@example.com');const second=app.cookie(await app.verify('second@example.com'));
    const profile={firstName:'First',lastName:'Customer',phone:'0100000000',company:'',address:'Sample street',city:'Test city',province:'Test province',postalCode:'0000',country:'South Africa',auth_user_id:'usr_01'};
    const put=new Request('https://wdp.test/api/customer/profile',{method:'PUT',headers:{Origin:'https://wdp.test','Content-Type':'application/json',Cookie:first},body:JSON.stringify(profile)});
    expect((await onRequestPut(app.context(put))).status).toBe(200);
    const get=(cookie:string)=>onRequestGet(app.context(new Request('https://wdp.test/api/customer/profile',{headers:{Cookie:cookie}})));
    expect((await (await get(first)).json()).profile.firstName).toBe('First');
    expect((await (await get(second)).json()).profile).toBeNull();
    expect((await get('')).status).toBe(401);
    expect((await dashboard({...app.context(new Request('https://wdp.test/dashboard/')),next:()=>{throw new Error('must not serve');}})).status).toBe(303);
    const signedIn=await dashboard({...app.context(new Request('https://wdp.test/dashboard/',{headers:{Cookie:first}})),next:async()=>new Response('Customer dashboard')});
    expect(signedIn.status).toBe(200);expect(signedIn.headers.get('cache-control')).toContain('no-store');
  });
  it('resets passwords with an emailed single-use token, revokes sessions and allows logout',async()=>{
    const app=setup();await app.register('new@example.com');const original=app.cookie(await app.verify('new@example.com'));
    app.mail.length=0;
    expect((await app.auth.handler(app.request('request-password-reset',{email:'new@example.com',redirectTo:'https://wdp.test/account/'}))).status).toBe(200);
    await Promise.all(app.tasks);
    const email=app.mail.find(message=>message.subject==='Reset your WDP password');expect(email).toBeDefined();
    const resetLink=new URL(email.text.match(/https:\/\/\S+/)[0]);
    const response=await app.auth.handler(new Request(resetLink));
    const token=new URL(response.headers.get('location')!).searchParams.get('token');expect(token).toBeTruthy();
    expect((await app.auth.handler(app.request('reset-password',{token,newPassword:'replacement-password-long'}))).status).toBe(200);
    expect((await app.auth.handler(app.request('reset-password',{token,newPassword:'another-password-long'}))).status).toBe(400);
    await expect(requireCustomer(app.request('get-session',undefined,original),app.env,app.waitUntil)).rejects.toThrow('sign in');
    const login=await app.auth.handler(app.request('sign-in/email',{email:'new@example.com',password:'replacement-password-long'}));expect(login.status).toBe(200);
    const sessionCookie=app.cookie(login);
    expect((await app.auth.handler(app.request('sign-out',{},sessionCookie))).status).toBe(200);
    await expect(requireCustomer(app.request('get-session',undefined,sessionCookie),app.env,app.waitUntil)).rejects.toThrow('sign in');
  });
  it('rate limits repeated sign-in attempts across auth instances',async()=>{
    const app=setup();
    for(let i=0;i<5;i++) expect((await createAuth(app.env,app.waitUntil).handler(app.request('sign-in/email',{email:'missing@example.com',password:'incorrect-password-long'}))).status).toBe(401);
    expect((await createAuth(app.env,app.waitUntil).handler(app.request('sign-in/email',{email:'missing@example.com',password:'incorrect-password-long'}))).status).toBe(429);
  });
  it('blocks payment creation without a verified session when accounts are enabled',async()=>{
    const app=setup();
    const env={...app.env,WDP_PAYMENT_TEST_ENABLED:'true',YOCO_TEST_SECRET_KEY:'sk_test_mock',YOCO_TEST_WEBHOOK_SECRET:'whsec_mock',WDP_PAYMENT_DB:app.env.DB};
    const response=await createPayment({request:new Request('https://wdp.test/api/payments/create',{method:'POST',headers:{Origin:'https://wdp.test','Content-Type':'application/json'},body:'{}'}),env} as any);
    expect(response.status).toBe(401);expect(app.mail).toHaveLength(0);
  });
  it('allows a verified customer to sign in after the shared rate-limit window expires',async()=>{
    const app=setup();await app.register('verified@example.com');await app.verify('verified@example.com');
    for(let i=0;i<5;i++)await createAuth(app.env,app.waitUntil).handler(app.request('sign-in/email',{email:'missing@example.com',password:'incorrect-password-long'}));
    const credentials={email:'verified@example.com',password:'test-password-long-enough',callbackURL:'/dashboard/'};
    expect((await createAuth(app.env,app.waitUntil).handler(app.request('sign-in/email',credentials))).status).toBe(429);
    const now=Date.now();vi.spyOn(Date,'now').mockImplementation(()=>now+61000);
    expect((await createAuth(app.env,app.waitUntil).handler(app.request('sign-in/email',credentials))).status).toBe(200);
  });
});
