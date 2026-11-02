import test from 'node:test';
import assert from 'node:assert/strict';
import {decrypt} from '@sp/sync-core';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {makeServer} from '../src/tools.js';
import {officialModule} from '../src/projection.js';
import {openStore} from '../src/ingest.js';
import {perform,submit,initOutbox,projectAction} from '../src/write.js';
import {dateState,dateContext,validateDates} from '../src/dates.js';

test('MCP dates validate strict days, milliseconds, conflicts and date-only update',async()=>{
 const calls:any[]=[];
 const server=makeServer((async()=>({state:{},clock:{},serverSeq:0})) as any,true,(async(x:any)=>{calls.push(x);return {taskId:'t',serverSeq:1,requestId:x.requestId,replayed:false};}) as any);
 const client=new Client({name:'dates',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
 try{
  for(const name of ['create_task','update_task']){
   const common={requestId:'r',expectedServerSeq:0,...(name==='create_task'?{title:'test',projectId:'p'}:{id:'t'})};
   for(const invalid of [{dueDay:'2026-02-30'},{dueDay:'2026-2-01'},{dueWithTime:'1792022400000'},{dueWithTime:0},{dueWithTime:1.5},{deadlineWithTime:Infinity},{dueDay:null,dueWithTime:1792022400000},{deadlineDay:'2026-10-15',deadlineWithTime:null}]){
    assert.equal((await client.callTool({name,arguments:{...common,...invalid}})).isError,true);
   }
   assert.equal((await client.callTool({name,arguments:{...common,dueDay:'2028-02-29',deadlineWithTime:1792022400000}})).isError,undefined);
   assert.equal((await client.callTool({name,arguments:{...common,dueDay:null}})).isError,undefined);
  }
  const tools=await client.listTools();for(const name of ['create_task','update_task'])assert.ok(tools.tools.find(t=>t.name===name)?.inputSchema.properties?.deadlineWithTime);
  assert.equal(calls.length,4);
 }finally{await client.close();await server.close();}
 assert.throws(()=>validateDates({dueWithTime:NaN}),/WRITE_VALIDATION_FAILED/);
});

test('encrypted date writes replay official reducers; outbox retry, concurrency, TODAY, planner and reminders',async()=>{
 const official=await officialModule();let state=official.reduce(undefined,{type:'@@init'});
 state=official.reduce(state,projectAction(official,state,'dates test','p'));
 const db=openStore(':memory:'),close=db.close.bind(db);db.close=()=>{};
 let seq=10,clock:Record<string,number>={},sends=0;const bodies:string[]=[];let lose=false;
 const cfg={baseUrl:'https://example.invalid',accessToken:'test',encryptionPassword:'test'};
 const deps={loadCredentials:()=>cfg,current:async()=>({state,serverSeq:seq,clock}),openStore:()=>db,officialModule:async()=>official,send:(async(_url:any,init:any)=>{
  sends++;bodies.push(init.body);if(lose){lose=false;throw Error('lost');}
  const body=JSON.parse(init.body),results=[];
  for(const wire of body.ops){
   const op={...wire,payload:JSON.parse(await decrypt(wire.payload,cfg.encryptionPassword))};
   assert.ok(official.KNOWN_ACTION_TYPES.has(op.actionType));
   state=official.reduce(dateState(official,state,op.timestamp),official.convertOpToAction(op));clock=op.vectorClock;
   results.push({opId:op.id,accepted:true,serverSeq:++seq});
  }
  return new Response(JSON.stringify({results,latestSeq:seq}));
 }) as typeof fetch};
 try{
  const created=await perform({kind:'create',projectId:'p',title:'date test',dueDay:'2099-10-15',deadlineDay:'2099-10-16',expectedServerSeq:seq,requestId:'create'},deps as any);
  const id=created.taskId;assert.equal(state.tasks.entities[id].dueDay,'2099-10-15');assert.equal(state.tasks.entities[id].deadlineDay,'2099-10-16');assert.ok(state.planner.days['2099-10-15'].includes(id));
  const timed=await perform({kind:'create',projectId:'p',title:'timed create',dueWithTime:Date.now(),deadlineWithTime:Date.now()+3600000,expectedServerSeq:seq,requestId:'timed-create'},deps as any);
  assert.equal(state.tasks.entities[timed.taskId].dueDay,undefined);assert.ok(state.tasks.entities[timed.taskId].dueWithTime);assert.ok(state.tasks.entities[timed.taskId].deadlineWithTime);assert.ok(state.tag.entities.TODAY.taskIds.includes(timed.taskId));
  const call=(input:any)=>perform({kind:'update',id,expectedServerSeq:seq,requestId:'r'+seq,...input},deps as any);
  await call({title:'renamed'});assert.equal(state.tasks.entities[id].dueDay,'2099-10-15');assert.equal(state.tasks.entities[id].deadlineDay,'2099-10-16');
  const today=dateContext(official,state,Date.now()).today;
  await call({dueDay:today});assert.ok(state.tag.entities.TODAY.taskIds.includes(id));assert.ok(!state.planner.days['2099-10-15']?.includes(id));
  // No existing reminder: scheduling remains Never.
  await call({dueWithTime:Date.now()});assert.equal(state.tasks.entities[id].dueDay,undefined);assert.equal(state.tasks.entities[id].remindAt,undefined);assert.ok(state.tag.entities.TODAY.taskIds.includes(id));
  await call({dueDay:null});assert.equal(state.tasks.entities[id].dueWithTime,undefined);assert.ok(!state.tag.entities.TODAY.taskIds.includes(id));
  await call({deadlineDay:today});assert.equal(state.tasks.entities[id].dueDay,today);assert.ok(state.tag.entities.TODAY.taskIds.includes(id));
  await call({deadlineWithTime:1792022400000});assert.equal(state.tasks.entities[id].deadlineDay,undefined);assert.equal(state.tasks.entities[id].deadlineRemindAt,undefined);
  await call({deadlineWithTime:null});assert.equal(state.tasks.entities[id].deadlineWithTime,undefined);
  await assert.rejects(call({expectedServerSeq:seq-1,dueDay:'2099-10-15'}),/STALE_REVISION_READ_AGAIN/);
  const retry={kind:'update' as const,id,dueDay:'2099-10-15',expectedServerSeq:seq,requestId:'retry'};lose=true;
  await assert.rejects(perform(retry,deps as any),/WRITE_PENDING/);const before=sends;
  await perform(retry,deps as any);assert.equal(bodies.at(-1),bodies.at(-2));await perform(retry,deps as any);assert.equal(sends,before+1);
  await assert.rejects(perform({...retry,dueDay:null},deps as any),/IDEMPOTENCY_KEY_REUSED/);
  assert.equal(dateContext(official,state,Date.parse('2026-10-14T15:01:00Z')).today,'2026-10-15');
  const shifted={...state,globalConfig:{...state.globalConfig,misc:{startOfNextDayTime:'04:30'}}};assert.equal(dateContext(official,shifted,Date.parse('2026-10-14T18:00:00Z')).today,'2026-10-14');
 }finally{close();}
});

test('outbox batch does not accept a missing or rejected later result',async()=>{
 for(const missing of [true,false]){
  const db=openStore(':memory:');initOutbox(db);const body=JSON.stringify({ops:[{id:'one'},{id:'two'}]});db.prepare("INSERT INTO outbox VALUES('r','f',?,'t','pending',NULL,NULL)").run(body);
  const results:any[]=[{opId:'one',accepted:true,serverSeq:1}];if(!missing)results.push({opId:'two',accepted:false,errorCode:'CONFLICT'});
  await assert.rejects(submit(db,'r',{baseUrl:'https://example.invalid',accessToken:'test'},(async()=>new Response(JSON.stringify({results,latestSeq:1}))) as any),missing?/WRITE_PENDING/:/WRITE_PARTIALLY_ACCEPTED/);
  assert.notEqual(db.prepare('SELECT status FROM outbox').get()?.status,'accepted');db.close();
 }
});
