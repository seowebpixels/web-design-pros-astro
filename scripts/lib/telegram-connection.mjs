export function matchingPrivateChats(updates,code){
  const normalize=value=>typeof value==='string'?value.trim().toLowerCase():'';
  return [...new Set(updates.filter(item=>item.message?.chat?.type==='private'&&normalize(item.message.text)===normalize(code)).map(item=>String(item.message.chat.id)))];
}
export async function waitForPrivateChat(api,code){
  let offset,received=false;
  for(let attempt=0;attempt<3;attempt++){
    const data=await api('getUpdates',{timeout:10,limit:100,allowed_updates:['message'],...(offset===undefined?{}:{offset})});
    if(!Array.isArray(data.result))throw new Error('Telegram did not return chat updates.');
    const ids=matchingPrivateChats(data.result,code);
    if(ids.length===1)return ids[0];
    if(ids.length>1)throw new Error('Could not identify one private chat: the code appeared in multiple chats. Run again with a new code.');
    received||=data.result.some(item=>item.message?.chat?.type==='private');
    const indexes=data.result.map(item=>item.update_id).filter(Number.isSafeInteger);
    if(indexes.length)offset=Math.max(...indexes)+1;
  }
  throw new Error(received?'Could not identify your private chat: messages arrived, but the code did not match. Copy only the new wdp-connect code, without quotation marks, and send it to the bot username shown above.':'Could not identify your private chat: no matching message arrived. Open the exact bot username shown above, press Start, and send the new code as a normal message.');
}
