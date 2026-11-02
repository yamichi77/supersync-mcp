import test from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {makeServer} from '../src/tools.js';

test('tool input budget rejects oversized arrays and nested unknown properties before handlers',async()=>{
 let calls=0;
 const provider=async()=>{calls++;throw new Error('must not reach provider');};
 const writer=async()=>{calls++;throw new Error('must not reach writer');};
 const server=makeServer(provider,true,writer);
 const client=new Client({name:'input-budget-test',version:'1'});
 const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
 try{
  for(const args of [
   {id:'t',addTagIds:Array(16_385).fill(0)},
   {id:'t',extra:{nested:Array(16_385).fill(0)}}
  ]){
   const request={name:'get_task',arguments:args};
   assert.ok(Buffer.byteLength(JSON.stringify(request))<65_536);
   const result=await client.callTool(request);
   assert.equal(result.isError,true);
   assert.match(JSON.stringify(result),/element|limit|complexity/i);
  }
  assert.equal(calls,0);
 }finally{await client.close();await server.close();}
});

test('tool input budget preserves maximum valid board column and tag counts',async()=>{
 let calls=0;
 const provider=async()=>{throw new Error('unused');};
 const writer=async()=>{calls++;return {taskId:'board',serverSeq:1,requestId:'fixture',replayed:false};};
 const server=makeServer(provider,true,writer);
 const client=new Client({name:'input-budget-control',version:'1'});
 const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
 try{
  const tags=Array.from({length:100},(_,i)=>String(i));
  const args={requestId:'fixture',expectedServerSeq:0,projectId:'p',title:'board',cols:12,
   columns:Array.from({length:50},()=>({title:'c',includedTagIds:tags,excludedTagIds:tags,
    includedTagsMatch:'all',excludedTagsMatch:'any',taskDoneState:'all',scheduledState:'all',backlogState:'all',isParentTasksOnly:false}))};
  const request={name:'create_board',arguments:args};
  assert.ok(Buffer.byteLength(JSON.stringify(request))<65_536);
  const result=await client.callTool(request);
  assert.ok(!result.isError,JSON.stringify(result));assert.equal(calls,1);
 }finally{await client.close();await server.close();}
});
