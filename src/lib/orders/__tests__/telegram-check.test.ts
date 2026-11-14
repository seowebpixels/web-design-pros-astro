import {afterEach,describe,expect,it,vi} from 'vitest';
import {checkTelegramConnection} from '../telegram-check.mjs';
import {onRequestPost} from '../../../../functions/api/internal/telegram-check';

const token='123456:test_only_bot_token',chat='1234567',secret='test-retry-secret-at-least-thirty-two-characters';
afterEach(()=>vi.restoreAllMocks());
describe('private Telegram connection checks',()=>{
  it('checks credentials and the private chat without sending a message or returning personal details',async()=>{
    const fetcher=vi.fn(async(url:string,options:any)=>{
      expect(options.redirect).toBe('error');expect(options.method).toBe('POST');
      if(url.endsWith('/getMe'))return new Response(JSON.stringify({ok:true,result:{is_bot:true,username:'private_bot_name'}}));
      expect(url.endsWith('/getChat')).toBe(true);expect(JSON.parse(options.body)).toEqual({chat_id:chat});
      return new Response(JSON.stringify({ok:true,result:{id:Number(chat),type:'private',first_name:'Private person'}}));
    });
    const result=await checkTelegramConnection(token,chat,fetcher);
    expect(result).toMatchObject([{check:'bot',status:'ok'},{check:'private_chat',status:'ok'}]);expect(fetcher).toHaveBeenCalledTimes(2);
    const text=JSON.stringify(result);for(const sensitive of [token,chat,'private_bot_name','Private person'])expect(text).not.toContain(sensitive);
  });
  it.each([['TimeoutError','timeout'],['TypeError','connection_failed'],['AbortError','interrupted']])('reports %s without copying exception messages',async(name,status)=>{
    const fetcher=vi.fn(async()=>{const error=new Error('https://api.telegram.org/bot'+token);error.name=name;throw error;});
    const result=await checkTelegramConnection(token,chat,fetcher);expect(result.map(item=>item.status)).toEqual([status,status]);expect(JSON.stringify(result)).not.toContain(token);
  });
  it('does not make requests for invalid settings',async()=>{
    const fetcher=vi.fn();expect(await checkTelegramConnection('bad',chat,fetcher)).toMatchObject([{check:'configuration',status:'missing_or_invalid'}]);expect(fetcher).not.toHaveBeenCalled();
  });
  it('distinguishes HTTP rejection, unreadable responses, and a different chat',async()=>{
    expect((await checkTelegramConnection(token,chat,async()=>new Response('secret response',{status:401}))).map(item=>item.status)).toEqual(['http_401','http_401']);
    expect((await checkTelegramConnection(token,chat,async()=>new Response(token))).map(item=>item.status)).toEqual(['unreadable_response','unreadable_response']);
    const result=await checkTelegramConnection(token,chat,async(url:string)=>new Response(JSON.stringify({ok:true,result:url.endsWith('/getMe')?{is_bot:true}:{type:'private',id:42}})));
    expect(result.map(item=>item.status)).toEqual(['ok','unexpected_chat']);
  });
  it('requires the private retry secret before making any Cloudflare connection checks',async()=>{
    const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('{}'));
    const context=(auth:string)=>({env:{WDP_ORDER_ALERT_RETRY_SECRET:secret,WDP_TELEGRAM_BOT_TOKEN:token,WDP_TELEGRAM_CHAT_ID:chat},request:new Request('https://wdp.test/api/internal/telegram-check',{method:'POST',headers:{Authorization:'Bearer '+auth}})}) as any;
    expect((await onRequestPost(context('wrong'))).status).toBe(403);expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockImplementation(async(url)=>new Response(JSON.stringify({ok:true,result:String(url).endsWith('/getMe')?{is_bot:true}:{type:'private',id:Number(chat)}})));
    const response=await onRequestPost(context(secret));expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('no-store');expect(await response.json()).toMatchObject({checks:[{status:'ok'},{status:'ok'}]});
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
