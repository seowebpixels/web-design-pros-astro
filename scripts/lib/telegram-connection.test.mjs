import {test} from 'node:test';
import assert from 'node:assert/strict';
import {matchingPrivateChats,waitForPrivateChat} from './telegram-connection.mjs';
const message=(id,text,type='private')=>({update_id:id,message:{chat:{id:123,type},text}});
test('matches phone whitespace/case but refuses group chats and other codes',()=>{
  assert.deepEqual(matchingPrivateChats([message(1,' WDP-CONNECT-ABCD1234 \n'),message(2,'wdp-connect-abcd1234','group'),message(3,'other')],'wdp-connect-abcd1234'),['123']);
  assert.deepEqual(matchingPrivateChats([message(1,'"wdp-connect-abcd1234"')],'wdp-connect-abcd1234'),[]);
});
test('waits past unrelated old updates for delayed delivery',async()=>{
  const calls=[];const batches=[[message(2,'/start')],[],[message(3,'wdp-connect-abcd1234')]];
  assert.equal(await waitForPrivateChat(async(method,input)=>{calls.push({method,input});return {result:batches.shift()};},'wdp-connect-abcd1234'),'123');
  assert.equal(calls.length,3);assert.equal(calls[1].input.offset,3);assert.equal(calls[1].input.timeout,10);
});
test('explains missing messages and mismatched codes without printing message content',async()=>{
  await assert.rejects(waitForPrivateChat(async()=>({result:[]}), 'code'),/no matching message arrived/);
  await assert.rejects(waitForPrivateChat(async()=>({result:[message(1,'private unrelated content')]}), 'code'),/code did not match/);
});
