import test from 'node:test';import assert from 'node:assert/strict';
import {openStore} from '../src/ingest.js';import {initOutbox,submit} from '../src/write.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';import {makeServer} from '../src/tools.js';
test('durable retry resends identical operation after lost response; accepted result never resends',async()=>{
 const db=openStore(':memory:');initOutbox(db);const body=JSON.stringify({ops:[{id:'op1',payload:'ciphertext'}]});
 db.prepare("INSERT INTO outbox VALUES(?,?,?,?,'pending',NULL,NULL)").run('req','fingerprint',body,'task1');
 const sent:string[]=[];let n=0;const send=(async(_url:any,init:any)=>{sent.push(init.body);if(n++===0)throw new Error('response lost');return new Response(JSON.stringify({results:[{opId:'op1',accepted:true,serverSeq:4}],latestSeq:4}));}) as typeof fetch;
 const cfg={baseUrl:'https://example.invalid',accessToken:'test'};
 await assert.rejects(submit(db,'req',cfg,send),/WRITE_PENDING/);
 assert.equal(db.prepare('SELECT status FROM outbox').get()?.status,'pending');
 const result=await submit(db,'req',cfg,send);assert.equal(result.serverSeq,4);
 assert.equal((await submit(db,'req',cfg,send)).replayed,true);assert.deepEqual(sent,[body,body]);db.close();
});
test('server conflict is retained as rejected and never retried automatically',async()=>{
 const db=openStore(':memory:');initOutbox(db);db.prepare("INSERT INTO outbox VALUES(?,?,?,?,'pending',NULL,NULL)").run('req','f',JSON.stringify({ops:[{id:'op1'}]}),'t');
 let calls=0;const send=(async()=>{calls++;return new Response(JSON.stringify({results:[{opId:'op1',accepted:false,errorCode:'CONFLICT'}],latestSeq:5}));}) as typeof fetch;
 for(let n=0;n<2;n++)await assert.rejects(submit(db,'req',{baseUrl:'https://example.invalid',accessToken:'test'},send),/WRITE_REJECTED/);
 assert.equal(calls,1);db.close();
});
test('read credential cannot discover or invoke writes; write credential exposes tag delta tool',async()=>{
 for(const canWrite of [false,true]){
  let calls=0;const writer=(async()=>{calls++;return {taskId:'t',serverSeq:1,requestId:'r',replayed:false};}) as any;
  const provider=(async()=>({state:{},clock:{},serverSeq:0})) as any;
  const server=makeServer(provider,canWrite,writer),client=new Client({name:'test',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();
  await server.connect(a);await client.connect(b);
  try{
   const tools=await client.listTools();assert.equal(tools.tools.length,canWrite?16:7);
   const result=await client.callTool({name:'update_task_tags',arguments:{requestId:'r',expectedServerSeq:0,id:'t',addTagIds:['doing'],removeTagIds:['todo']}});
   assert.equal(calls,canWrite?1:0);assert.equal(Boolean(result.isError),!canWrite);
  }finally{await client.close();await server.close();}
 }
});

test('validated full resync replaces read cache without losing pending writes or device identity',async()=>{
 const {replaceDownloadedCache}=await import('../src/sync.js');
 const db=openStore(':memory:'),candidate=openStore(':memory:');initOutbox(db);
 db.prepare("INSERT INTO metadata VALUES('clientId','device')").run();
 db.prepare("INSERT INTO outbox VALUES('req','f','encrypted','task','pending',NULL,NULL)").run();
 db.prepare("INSERT INTO operations VALUES(1,'old','oldwire')").run();
 candidate.prepare("INSERT INTO operations VALUES(20,'new','newwire')").run();
 candidate.prepare("INSERT INTO metadata VALUES('downloadCursor','20')").run();
 replaceDownloadedCache(db,candidate);
 assert.equal(db.prepare('SELECT seq FROM operations').get()?.seq,20);
 assert.equal(db.prepare("SELECT value FROM metadata WHERE key='clientId'").get()?.value,'device');
 assert.equal(db.prepare('SELECT status FROM outbox').get()?.status,'pending');
 db.close();candidate.close();
});
