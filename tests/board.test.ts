import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {decrypt} from '@sp/sync-core';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {officialModule} from '../src/projection.js';
import {boardAction,boardUpdateAction,publicBoard} from '../src/boards.js';
import {perform} from '../src/write.js';
import {openStore} from '../src/ingest.js';
import {makeServer} from '../src/tools.js';

async function fixture(){
 const official=await officialModule(),state=official.reduce(undefined,{type:'@@init'});
 state.projects.entities.p={...official.DEFAULT_PROJECT,id:'p',title:'Example project'};
 for(const id of ['a','b','personal','KANBAN_IN_PROGRESS',...Array.from({length:8},(_,i)=>'state-'+i)])state.tag.entities[id]={id,title:id};
 state.tasks.entities.t={...official.DEFAULT_TASK,id:'t',projectId:'p',tagIds:['personal']};
 return {official,state};
}
const columns=[{title:'Ideas',includedTagIds:['a']},{title:'Work',includedTagIds:['b']},{title:'Finished',taskDoneState:'done' as const}];

test('three generic columns replay through official operations without touching tasks or existing boards',async()=>{
 const {official,state}=await fixture(),before=structuredClone(state);
 const action=boardAction(state,{projectId:'p',title:'Example board',columns},'new');
 const {type,...actionPayload}=action;
 const replay=official.convertOpToAction({id:official.uuidv7(),clientId:'fixture',actionType:type,opType:'CRT',entityType:'BOARD',entityId:'new',payload:{actionPayload,entityChanges:[]},vectorClock:{fixture:1},timestamp:Date.now(),schemaVersion:4});
 const result=official.reduce(state,replay),board=result.boards.boardCfgs.at(-1);
 assert.equal(board.cols,3);assert.equal(board.panels.length,3);assert.equal(board.title,'Example board');
 assert.deepEqual(result.boards.boardCfgs.slice(0,-1),before.boards.boardCfgs);
 assert.deepEqual(result.tasks,before.tasks);
 assert.deepEqual(board.panels[0].excludedTagIds,[]);assert.equal(board.panels[0].isParentTasksOnly,false);
 assert.deepEqual(board.panels.map((p:any)=>p.taskDoneState),[1,1,2]);
 assert.deepEqual(board.panels.map((p:any)=>p.projectIds),[['p'],['p'],['p']]);
 assert.deepEqual(state,before);
});

test('generic API allows shared tags, many or no done columns, explicit filters and independent display columns',async()=>{
 const {state}=await fixture();
 for(const done of ['all','done'] as const){
  const action=boardAction(state,{projectId:'p',title:'Flexible',cols:2,columns:[{title:'A',includedTagIds:['KANBAN_IN_PROGRESS'],taskDoneState:done},{title:'B',includedTagIds:['KANBAN_IN_PROGRESS'],taskDoneState:done}]},'board');
  assert.equal(action.board.cols,2);assert.deepEqual(action.board.panels.map((p:any)=>p.excludedTagIds),[[],[]]);
 }
 const explicit=boardAction(state,{projectId:'p',title:'Explicit',columns:[{title:'Filter',includedTagIds:['a'],excludedTagIds:['b'],includedTagsMatch:'any',excludedTagsMatch:'all',scheduledState:'scheduled',backlogState:'only_backlog',isParentTasksOnly:true}]},'board');
 assert.equal((explicit.board.panels[0] as any).scheduledState,2);assert.equal((explicit.board.panels[0] as any).backlogState,3);
 assert.equal((explicit.board.panels[0] as any).includedTagsMatch,'any');
});

test('eight explicitly supplied private-style columns work without public workflow rules',async()=>{
 const {official,state}=await fixture();
 const tags=Array.from({length:8},(_,i)=>'state-'+i);
 const input={projectId:'p',title:'Explicit workflow',cols:4,columns:tags.map((tag,i)=>({title:'State '+i,includedTagIds:[tag],excludedTagIds:tags.filter(t=>t!==tag),excludedTagsMatch:'any',taskDoneState:i===7?'done':'undone',isParentTasksOnly:true}))};
 const action=boardAction(state,input,'eight'),result=official.reduce(state,{...action,meta:{isRemote:true}}),board=result.boards.boardCfgs.at(-1);
 assert.equal(board.panels.length,8);assert.equal(board.cols,4);
 assert.deepEqual(official.rewriteTagIdsForPanel(['state-0','personal'],board.panels[1]),['personal','state-1']);
});

test('partial updates preserve column order, cards, project scope, normal tags, tasks and other boards',async()=>{
 const {official,state}=await fixture();
 const base=official.reduce(state,{...boardAction(state,{projectId:'p',title:'Board',columns},'board'),meta:{isRemote:true}});
 const board=base.boards.boardCfgs.at(-1);board.panels[0].taskIds=['t','second'];board.panels[0].excludedTagIds=['personal'];
 const before=structuredClone(base);
 const action=boardUpdateAction(base,{id:'board',title:'Renamed',cols:1,columns:[{id:'board-1',title:'Doing'},{id:'board-0',excludedTagIds:['personal','b']}]});
 const {type,...actionPayload}=action;
 const op={id:official.uuidv7(),clientId:'fixture',actionType:type,opType:'UPD',entityType:'BOARD',entityId:'board',payload:{actionPayload,entityChanges:[]},vectorClock:{fixture:1},timestamp:Date.now(),schemaVersion:4};
 const result=official.reduce(base,official.convertOpToAction(op)),updated=result.boards.boardCfgs.at(-1);
 assert.deepEqual(updated.panels.map((p:any)=>p.id),before.boards.boardCfgs.at(-1).panels.map((p:any)=>p.id));
 assert.deepEqual(updated.panels[0].taskIds,['t','second']);assert.deepEqual(updated.panels[0].projectIds,['p']);
 assert.deepEqual(updated.panels[0].excludedTagIds,['personal','b']);assert.equal(updated.panels[1].title,'Doing');
 assert.deepEqual(updated.panels[2],before.boards.boardCfgs.at(-1).panels[2]);
 assert.deepEqual(result.boards.boardCfgs.slice(0,-1),before.boards.boardCfgs.slice(0,-1));
 assert.deepEqual(result.tasks,before.tasks);assert.deepEqual(base,before);
 assert.deepEqual(publicBoard(updated)?.columns[0].taskIds,['t','second']);
});

test('invalid inputs fail atomically including a later bad patch and protected fields',async()=>{
 const {state}=await fixture();
 for(const extra of [{columns:[]},{columns:[{title:' '}]},{cols:0},{columns:[{title:'A',includedTagIds:['a','a']}]},{columns:Array.from({length:51},()=>({title:'A'}))}]){
  assert.throws(()=>boardAction(state,{projectId:'p',title:'Board',columns,...extra},'b'),/WRITE_VALIDATION_FAILED/);
 }
 assert.throws(()=>boardAction(state,{projectId:'missing',title:'Board',columns},'b'),/PROJECT_NOT_FOUND/);
 assert.throws(()=>boardAction(state,{projectId:'p',title:'Board',columns:[{title:'A',includedTagIds:['unknown']}]},'b'),/TAG_NOT_FOUND/);
 assert.throws(()=>boardAction(state,{projectId:'p',title:'Board',columns:[{title:'A',excludedTagIds:['TODAY']}]},'b'),/TODAY_REQUIRES_SCHEDULING/);
 state.boards.boardCfgs.push(boardAction(state,{projectId:'p',title:'Board',columns},'b').board);
 const before=structuredClone(state);
 for(const patches of [[{id:'b-0',title:'Changed'},{id:'b-1',excludedTagIds:['missing']}],[{id:'b-0',title:'A'},{id:'b-0',title:'B'}],[{id:'missing',title:'A'}],[{id:'b-0',taskIds:['x']}],[{id:'b-0',projectIds:['x']}],[{id:'b-0'}]]){
  assert.throws(()=>boardUpdateAction(state,{id:'b',columns:patches}),/TAG_NOT_FOUND|WRITE_VALIDATION_FAILED/);assert.deepEqual(state,before);
 }
 assert.throws(()=>boardUpdateAction(state,{id:'b'}),/WRITE_VALIDATION_FAILED/);
 assert.throws(()=>boardUpdateAction(state,{id:'missing',title:'A'}),/BOARD_NOT_FOUND/);
});

test('real write pipeline retains encrypted retries and rejects stale, reused or invalid requests without effects',async()=>{
 const {official,state}=await fixture(),db=openStore(':memory:');
 const realClose=db.close.bind(db);db.close=()=>{};
 const bodies:string[]=[];let lose=true;
 const send=(async(_url:any,init:any)=>{bodies.push(init.body);if(lose){lose=false;throw new Error('lost response');}const op=JSON.parse(init.body).ops[0];return new Response(JSON.stringify({results:[{opId:op.id,accepted:true,serverSeq:6}],latestSeq:6}));}) as typeof fetch;
 const deps={loadCredentials:()=>({baseUrl:'https://example.invalid',accessToken:'fixture-token',encryptionPassword:'fictional-test-password'}),current:async()=>({state,serverSeq:5,clock:{}}),openStore:()=>db,officialModule:async()=>official,send} as any;
 const request={kind:'create_board' as const,requestId:'fixture-request',expectedServerSeq:5,projectId:'p',title:'Board',columns};
 try{
  await assert.rejects(perform({...request,expectedServerSeq:4},deps),/STALE_REVISION/);
  await assert.rejects(perform({...request,columns:[{title:'A',includedTagIds:['missing']}]},deps),/TAG_NOT_FOUND/);
  assert.equal(db.prepare('SELECT count(*) AS n FROM outbox').get()?.n,0);
  assert.equal(db.prepare("SELECT value FROM metadata WHERE key='clientCounter'").get(),undefined);
  await assert.rejects(perform(request,deps),/WRITE_PENDING/);
  const op=JSON.parse(bodies[0]).ops[0];assert.equal(op.entityType,'BOARD');assert.equal(op.opType,'CRT');assert.equal(op.isPayloadEncrypted,true);
  const payload=JSON.parse(await decrypt(op.payload,'fictional-test-password'));
  assert.equal(payload.actionPayload.board.panels.length,3);
  const accepted=await perform(request,deps);assert.equal(accepted.serverSeq,6);
  assert.equal((await perform(request,deps)).replayed,true);assert.equal(bodies.length,2);assert.equal(bodies[0],bodies[1]);
  await assert.rejects(perform({...request,title:'Different'},deps),/IDEMPOTENCY_KEY_REUSED/);assert.equal(bodies.length,2);
  const created=official.reduce(state,{type:op.actionType,...payload.actionPayload,meta:{isRemote:true}});deps.current=async()=>({state:created,serverSeq:6,clock:{}});
  await perform({kind:'update_board',requestId:'update-fixture',expectedServerSeq:6,id:accepted.taskId,columns:[{id:accepted.taskId+'-0',title:'Updated'}]},deps);
  const update=JSON.parse(bodies[2]).ops[0];assert.equal(update.entityType,'BOARD');assert.equal(update.opType,'UPD');
 }finally{realClose();}
});

test('generic board MCP tools enforce write permission, schemas, retired names and release version',async()=>{
 for(const canWrite of [false,true]){
  const {state}=await fixture();state.boards.boardCfgs.push(boardAction(state,{projectId:'p',title:'Board',columns},'b').board);
  let calls=0;const writer=(async()=>{calls++;return {taskId:'b',serverSeq:2,requestId:'r',replayed:false};}) as any;
  const server=makeServer((async()=>({state,clock:{},serverSeq:1})) as any,canWrite,writer),client=new Client({name:'fixture',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();
  await server.connect(a);await client.connect(b);
  try{
   assert.equal(client.getServerVersion()?.version,'0.3.0');
   const read=await client.callTool({name:'get_board',arguments:{id:'b'}});assert.ok(!read.isError);
   const made=await client.callTool({name:'create_board',arguments:{requestId:'r',expectedServerSeq:1,projectId:'p',title:'Board',columns}});
   assert.equal(Boolean(made.isError),!canWrite);assert.equal(calls,canWrite?1:0);
   if(canWrite){assert.equal((made.structuredContent as any).boardId,'b');
    const bad=await client.callTool({name:'update_board',arguments:{requestId:'r',expectedServerSeq:1,id:'b'}});assert.ok(bad.isError);assert.equal(calls,1);}
   const old=await client.callTool({name:'create_workflow_board',arguments:{}});assert.ok(old.isError);
  }finally{await client.close();await server.close();}
 }
 const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')),lock=JSON.parse(readFileSync(new URL('../package-lock.json',import.meta.url),'utf8'));
 assert.equal(pkg.version,'0.3.0');assert.equal(lock.version,pkg.version);assert.equal(lock.packages[''].version,pkg.version);
});
