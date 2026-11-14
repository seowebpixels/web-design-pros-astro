// Read-only checks shared by the private Cloudflare endpoint and local helper.
// Return fixed labels only: Telegram errors can contain token-bearing URLs.
export async function checkTelegramConnection(token,chatId,fetcher=globalThis.fetch.bind(globalThis)){
  if(!/^\d+:[A-Za-z0-9_-]+$/.test(token??'')||!/^\d+$/.test(chatId??''))return [{check:'configuration',status:'missing_or_invalid',elapsedMs:0}];
  async function probe(check,method,body){
    const started=Date.now();let phase='request';
    const result=status=>({check,status,elapsedMs:Date.now()-started});
    try{
      const response=await fetcher(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(20000)});
      if(!response.ok)return result(`http_${response.status}`);
      phase='response';const data=await response.json();
      if(data?.ok!==true)return result('not_confirmed');
      if(check==='bot'&&data.result?.is_bot!==true)return result('unexpected_bot');
      if(check==='private_chat'&&(data.result?.type!=='private'||String(data.result?.id)!==chatId))return result('unexpected_chat');
      return result('ok');
    }catch(error){
      if(error?.name==='TimeoutError')return result('timeout');
      if(error?.name==='AbortError')return result('interrupted');
      return result(phase==='response'?'unreadable_response':'connection_failed');
    }
  }
  return Promise.all([probe('bot','getMe',{}),probe('private_chat','getChat',{chat_id:chatId})]);
}
