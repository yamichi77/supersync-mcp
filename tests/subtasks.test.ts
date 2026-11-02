import test from 'node:test';
import assert from 'node:assert/strict';
import {decrypt} from '@sp/sync-core';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {makeServer} from '../src/tools.js';
import {officialModule} from '../src/projection.js';
import {openStore} from '../src/ingest.js';
import {perform,projectAction} from '../src/write.js';
import {dateState} from '../src/dates.js';

test('subtask MCP schema is optional, validated and write-role gated',async()=>{
 for(const canWrite of [false,true]){
  const calls:any[]=[];const server=makeServer((async()=>({state:{},clock:{},serverSeq:0})) as any,canWrite,(async(x:any)=>{calls.push(x);return {taskId:'c',serverSeq:1,requestId:x.requestId,replayed:false};}) as any);
  const client=new Client({name:'subtasks',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
  try{
   const schema=(await client.listTools()).tools.find(t=>t.name==='create_task')?.inputSchema;
   assert.equal(Boolean(schema),canWrite);
   if(schema){assert.ok(schema.properties?.parentId);assert.ok(!schema.required?.includes('parentId'));assert.ok(schema.properties?.deadlineDay);}
   const args={requestId:'r',expectedServerSeq:0,projectId:'p',parentId:'parent',title:'child',deadlineDay:'2026-10-18'};
   assert.equal(Boolean((await client.callTool({name:'create_task',arguments:args})).isError),!canWrite);
   assert.equal(calls.length,canWrite?1:0);
   if(canWrite){assert.equal(calls[0].parentId,'parent');for(const parentId of ['',null,'x'.repeat(256)])assert.equal((await client.callTool({name:'create_task',arguments:{...args,parentId}})).isError,true);assert.equal(calls.length,1);}
  }finally{await client.close();await server.close();}
 }
});

test('encrypted official subtask creation and MCP readback preserve parent dates; retry and rejection boundaries',async()=>{
 const official=await officialModule();let state=official.reduce(undefined,{type:'@@init'});state=official.reduce(state,projectAction(official,state,'subtasks','p'));state=official.reduce(state,projectAction(official,state,'other','q'));
 const db=openStore(':memory:'),close=db.close.bind(db);db.close=()=>{};
 const cfg={baseUrl:'https://example.invalid',accessToken:'fixture',encryptionPassword:'test'};let seq=10,clock={},sends=0,lose=false;const bodies:string[]=[];
 const deps={loadCredentials:()=>cfg,current:async()=>({state,serverSeq:seq,clock}),openStore:()=>db,officialModule:async()=>official,send:(async(_url:any,init:any)=>{
  sends++;bodies.push(init.body);if(lose){lose=false;throw Error('lost');}const body=JSON.parse(init.body),results=[];
  for(const wire of body.ops){const op={...wire,payload:JSON.parse(await decrypt(wire.payload,cfg.encryptionPassword))};assert.ok(official.KNOWN_ACTION_TYPES.has(op.actionType));state=official.reduce(dateState(official,state,op.timestamp),official.convertOpToAction(op));clock=op.vectorClock;results.push({opId:op.id,accepted:true,serverSeq:++seq});}
  return new Response(JSON.stringify({results,latestSeq:seq}));
 }) as typeof fetch};
 const create=(x:any)=>perform({kind:'create',title:'fixture',projectId:'p',expectedServerSeq:seq,requestId:'r'+seq,...x},deps as any);
 try{
  const parent=(await create({})).taskId;assert.ok(state.projects.entities.p.taskIds.includes(parent));assert.equal(state.tasks.entities[parent].parentId,undefined);
  Object.assign(state.tasks.entities[parent],{dueDay:'2099-10-01',deadlineDay:'2099-10-02',remindAt:123,deadlineRemindAt:456});const parentBefore=structuredClone(state.tasks.entities[parent]);
  const args={parentId:parent,deadlineDay:'2026-10-18',requestId:'child',expectedServerSeq:seq};lose=true;await assert.rejects(create(args),/WRITE_PENDING/);
  const pendingSends=sends;const result=await create(args),id=result.taskId;assert.equal(sends,pendingSends+1);assert.equal(bodies.at(-1),bodies.at(-2));assert.equal((await create(args)).replayed,true);assert.equal(sends,pendingSends+1);
  await assert.rejects(create({...args,parentId:'different'}),/IDEMPOTENCY_KEY_REUSED/);
  assert.equal(state.tasks.entities[id].parentId,parent);assert.equal(state.tasks.entities[id].deadlineDay,'2026-10-18');assert.deepEqual(state.tasks.entities[parent].subTaskIds,[id]);assert.ok(!state.projects.entities.p.taskIds.includes(id));
  for(const field of ['dueDay','deadlineDay','remindAt','deadlineRemindAt'])assert.equal(state.tasks.entities[parent][field],parentBefore[field]);
  const wire=JSON.parse(bodies.at(-1)!).ops[0];assert.equal(wire.actionType,'[Task] Add SubTask');assert.equal(wire.opType,'CRT');assert.equal(wire.entityId,id);
  const server=makeServer(deps.current as any),client=new Client({name:'readback',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
  try{for(const taskId of [parent,id]){const result=await client.callTool({name:'get_task',arguments:{id:taskId}});assert.equal(result.isError,undefined);assert.deepEqual((result.structuredContent as any).task.subTaskIds,state.tasks.entities[taskId].subTaskIds);assert.equal((result.structuredContent as any).task.parentId,state.tasks.entities[taskId].parentId);}}
  finally{await client.close();await server.close();}
  const noSend=sends;await assert.rejects(create({parentId:parent,expectedServerSeq:seq-1,requestId:'stale'}),/STALE_REVISION/);
  for(const parentId of ['foreign','archived','__proto__'])await assert.rejects(create({parentId}),/TASK_NOT_FOUND/);
  await assert.rejects(create({parentId:parent,projectId:'q'}),/PARENT_PROJECT_MISMATCH/);
  await assert.rejects(create({parentId:id}),/INVALID_TASK_HIERARCHY/);
  const good=structuredClone(state);
  for(const mutate of [(s:any)=>s.tasks.entities[parent].parentId=parent,(s:any)=>s.tasks.entities[parent].subTaskIds.push(parent),(s:any)=>s.tasks.entities[parent].subTaskIds.push(id),(s:any)=>s.tasks.entities[parent].subTaskIds.push('missing'),(s:any)=>s.tasks.entities[id].parentId='wrong',(s:any)=>s.tasks.entities[id].projectId='q',(s:any)=>s.tasks.entities[parent].subTaskIds=[]]){
   state=structuredClone(good);mutate(state);await assert.rejects(create({parentId:parent}),/INVALID_TASK_HIERARCHY/);
  }
  state=structuredClone(good);state.projects.entities.p.isArchived=true;await assert.rejects(create({parentId:parent}),/PROJECT_NOT_FOUND/);state=good;assert.equal(sends,noSend);
  for(const dates of [{dueDay:'2099-10-18'},{dueWithTime:Date.now()+86400000},{deadlineWithTime:Date.now()+86400000},{dueDay:null,deadlineDay:null}]){const child=await create({parentId:parent,...dates});assert.equal(state.tasks.entities[child.taskId].parentId,parent);for(const [field,value] of Object.entries(dates))assert.equal(state.tasks.entities[child.taskId][field],value===null?undefined:value);}
 }finally{close();}
});
