import {afterEach,describe,expect,it,vi} from 'vitest';
import {accountRequest} from '../../../scripts/account-client';
afterEach(()=>vi.restoreAllMocks());
describe('account request feedback',()=>{
  it('explains plain-text login rate limits using the server retry period',async()=>{
    vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('Too many requests',{status:429,headers:{'retry-after':'42'}}));
    await expect(accountRequest('/api/auth/sign-in/email',{email:'example@example.com',password:'sample'})).rejects.toThrow('Too many sign-in attempts. Please wait 42 seconds');
  });
  it('uses a one-minute wait when a rate-limit response has no retry header',async()=>{
    vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('',{status:429}));await expect(accountRequest('/api/customer/profile')).rejects.toThrow('Too many requests. Please wait 60 seconds');
  });
  it('reads the X-Retry-After header used by the account service',async()=>{
    vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({message:'Too many requests'},{status:429,headers:{'X-Retry-After':'19'}}));await expect(accountRequest('/api/auth/sign-in/email',{})).rejects.toThrow('Please wait 19 seconds');
  });
  it('preserves useful JSON credential errors',async()=>{
    vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({message:'Invalid email or password'},{status:401}));await expect(accountRequest('/api/auth/sign-in/email',{})).rejects.toThrow('Invalid email or password');
  });
  it('reports service failures without exposing a provider HTML error page',async()=>{
    vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('<html>Private error details</html>',{status:503}));await expect(accountRequest('/api/auth/get-session')).rejects.toThrow('account service is temporarily unavailable');
  });
  it('keeps successful null session responses valid',async()=>{
    vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json(null));await expect(accountRequest('/api/auth/get-session')).resolves.toBeNull();
  });
});
