import test from 'node:test';
import assert from 'node:assert/strict';
import {decrypt} from '@sp/sync-core';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {makeServer} from '../src/tools.js';
import {officialModule} from '../src/projection.js';
import {openStore} from '../src/ingest.js';
import {perform,projectAction,type WriteInput} from '../src/write.js';
import {dateState,validateDates} from '../src/dates.js';

test('native encrypted reminders: independent atomic date operations, readback, UI options, completion, retry and conflict',async()=>{
 const official=await officialModule();let state=official.reduce(undefined,{type:'@@init'});
 state=official.reduce(state,projectAction(official,state,'isolated reminders','p'));
 const db=openStore(':memory:'),close=db.close.bind(db);db.close=()=>{};
 let seq=10,clock={},lose=false;const bodies:string[]=[];
 const cfg={baseUrl:'https://example.invalid',accessToken:'test',encryptionPassword:'test'};
 const provider=async()=>({state,serverSeq:seq,clock});
 const deps={loadCredentials:()=>cfg,current:provider,openStore:()=>db,officialModule:async()=>official,send:(async(_url:any,init:any)=>{
  bodies.push(init.body);if(lose){lose=false;throw Error('lost');}
  const results=[];
  for(const wire of JSON.parse(init.body).ops){
   const op={...wire,payload:JSON.parse(await decrypt(wire.payload,cfg.encryptionPassword))};
   state=official.reduce(dateState(official,state,op.timestamp),official.convertOpToAction(op));clock=op.vectorClock;
   results.push({opId:op.id,accepted:true,serverSeq:++seq});
  }
  return new Response(JSON.stringify({results,latestSeq:seq}));
 }) as typeof fetch};
 const server=makeServer(provider as any,true,((input:WriteInput)=>perform(input,deps as any,()=>{})) as any);
 const client=new Client({name:'reminder-test',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
 try{
  const tools=await client.listTools();
  for(const name of ['create_task','update_task'])for(const field of ['scheduleReminder','deadlineReminder'])assert.ok(tools.tools.find(t=>t.name===name)?.inputSchema.properties?.[field]);
  const due=Date.parse('2099-11-18T20:00:00+09:00'),deadline=Date.parse('2099-11-19T10:59:00+09:00');
  const created=await client.callTool({name:'create_task',arguments:{requestId:'create',expectedServerSeq:seq,projectId:'p',title:'isolated fixture',dueWithTime:due,deadlineWithTime:deadline,scheduleReminder:{minutesBefore:60},deadlineReminder:{minutesBefore:0}}});
  assert.equal(created.isError,undefined);const id=(created.structuredContent as any).taskId;
  const task=()=>state.tasks.entities[id];
  const call=(input:any)=>perform({kind:'update',id,expectedServerSeq:seq,requestId:'r'+seq,...input},deps as any,()=>{});
  assert.equal(task().remindAt,due-3600000);assert.equal(task().deadlineRemindAt,deadline);
  // The date and notification are in one standard operation, never two writes.
  for(const wire of JSON.parse(bodies[0]).ops){
   const payload=JSON.parse(await decrypt(wire.payload,cfg.encryptionPassword)).actionPayload;
   if(wire.actionType.endsWith('scheduleTaskWithTime'))assert.equal(payload.remindAt,due-3600000);
   if(wire.actionType.endsWith('setDeadline'))assert.equal(payload.deadlineRemindAt,deadline);
  }
  await call({notes:'keep both',title:'changed'});assert.equal(task().remindAt,due-3600000);assert.equal(task().deadlineRemindAt,deadline);
  await call({dueWithTime:due+86400000});assert.equal(task().remindAt,due+86400000-3600000);assert.equal(task().deadlineRemindAt,deadline);
  await call({deadlineWithTime:deadline+86400000});assert.equal(task().deadlineRemindAt,deadline+86400000);
  const read=(await client.callTool({name:'get_task',arguments:{id}})).structuredContent as any;
  assert.deepEqual(read.task.scheduleReminder,{minutesBefore:60,remindAt:task().remindAt});assert.deepEqual(read.task.deadlineReminder,{minutesBefore:0,remindAt:task().deadlineRemindAt});
  const list=(await client.callTool({name:'list_tasks',arguments:{}})).structuredContent as any;assert.deepEqual(list.items[0].scheduleReminder,read.task.scheduleReminder);
  for(const minutesBefore of [0,5,10,15,30,60]){
   await call({scheduleReminder:{minutesBefore},deadlineReminder:{minutesBefore}});
   for(const [time,at] of [[task().dueWithTime,task().remindAt],[task().deadlineWithTime,task().deadlineRemindAt]])assert.equal(official.remindOptionToMilliseconds(time,official.millisecondsDiffToRemindOption(time,at)),at);
  }
  await call({scheduleReminder:null});assert.equal(task().remindAt,undefined);assert.ok(task().deadlineRemindAt);
  assert.equal(((await client.callTool({name:'get_task',arguments:{id}})).structuredContent as any).task.scheduleReminder,null);
  await call({scheduleReminder:{minutesBefore:5}});
  const before=bodies.length;
  await assert.rejects(call({dueDay:'2099-11-20'}),/REMINDER_REQUIRES_TIME/);
  await assert.rejects(call({deadlineWithTime:null,deadlineReminder:{minutesBefore:0}}),/REMINDER_REQUIRES_TIME/);
  await assert.rejects(call({expectedServerSeq:seq-1,scheduleReminder:null}),/STALE_REVISION/);assert.equal(bodies.length,before);
  await call({dueDay:'2099-11-20',scheduleReminder:null});assert.equal(task().dueDay,'2099-11-20');assert.equal(task().remindAt,undefined);
  await assert.rejects(call({scheduleReminder:{minutesBefore:0}}),/REMINDER_REQUIRES_TIME/);
  await call({dueWithTime:due,scheduleReminder:{minutesBefore:15}});
  const retry={kind:'update' as const,id,expectedServerSeq:seq,requestId:'retry',deadlineReminder:null};lose=true;
  await assert.rejects(perform(retry,deps as any),/WRITE_PENDING/);await perform(retry,deps as any);assert.equal(bodies.at(-1),bodies.at(-2));
  const sent=bodies.length;assert.equal((await perform(retry,deps as any)).replayed,true);assert.equal(bodies.length,sent);
  await assert.rejects(perform({...retry,deadlineReminder:{minutesBefore:0}},deps as any),/IDEMPOTENCY_KEY_REUSED/);
  await call({deadlineReminder:{minutesBefore:10}});
  assert.ok(official.selectAllTasksWithReminder(state).some((t:any)=>t.id===id));assert.ok(official.selectAllTasksWithDeadlineReminder(state).some((t:any)=>t.id===id));
  await perform({kind:'complete',id,expectedServerSeq:seq,requestId:'done'},deps as any);
  assert.ok(!official.selectAllTasksWithReminder(state).some((t:any)=>t.id===id));assert.ok(!official.selectAllTasksWithDeadlineReminder(state).some((t:any)=>t.id===id));
  assert.ok(task().remindAt); // Standard SP retains config; selectors cancel delivery.
  await perform({kind:'reopen',id,expectedServerSeq:seq,requestId:'reopen'},deps as any);
  assert.ok(official.selectAllTasksWithReminder(state).some((t:any)=>t.id===id));
  await call({dueWithTime:null,deadlineWithTime:null});assert.equal(task().remindAt,undefined);assert.equal(task().deadlineRemindAt,undefined);
  // Existing snoozed/custom offsets remain exact, without rounding to UI choices.
  await call({dueWithTime:due});state.tasks.entities[id].remindAt=due+12345;
  await call({dueWithTime:due+60000});assert.equal(task().remindAt,due+72345);
  // Deadline auto-plan must not silently discard the other channel's reminder.
  await call({dueWithTime:Date.now()-86400000,scheduleReminder:{minutesBefore:0}});
  await assert.rejects(call({deadlineDay:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo'}).format(new Date())}),/REMINDER_SCHEDULE_CONFLICT/);
 }finally{await client.close();await server.close();close();}
});

test('strict notification inputs do not coerce unsupported UI options',()=>{
 for(const value of [{minutesBefore:-1},{minutesBefore:1},{minutesBefore:1.5},{minutesBefore:'5'},{minutesBefore:Infinity},{minutesBefore:0,extra:true},{}])for(const key of ['scheduleReminder','deadlineReminder'])assert.throws(()=>validateDates({[key]:value} as any),/WRITE_VALIDATION_FAILED/);
});
