import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {encrypt} from '@sp/sync-core';import {openStore,storePage} from '../src/ingest.js';import {project} from '../src/projection.js';
test('official reducers replay a snapshot, completion and archive; unknown operations block reads',async()=>{
 const fixture=JSON.parse(readFileSync('vendor-source/src/app/op-log/validation/test-fixtures/frozen-state-v18.15.json','utf8')).state;
 fixture.boards={boardCfgs:[{id:'regression-board',panels:[{id:'regression-panel',taskIds:[]}]}]};
 const db=openStore(':memory:');let seq=0;
 async function add(actionType:string,opType:string,entityType:string,payload:unknown){
  seq++;const item={serverSeq:seq,receivedAt:1750000000000,op:{id:'01985bc0-0000-7000-8000-'+String(seq).padStart(12,'0'),actionType,opType,entityType,payload:await encrypt(JSON.stringify(payload),'test-password'),isPayloadEncrypted:true,clientId:'fixture',vectorClock:{fixture:seq},timestamp:1750000000000,schemaVersion:4}};
  storePage(db,{ops:[item],hasMore:false,latestSeq:seq});
 }
 await add('[SP_ALL] Load(import) all data','SYNC_IMPORT','ALL',fixture);
 const initial=await project(db,'test-password');const id=initial.state.tasks.ids[0];assert.ok(id);
 const newTask={...structuredClone(initial.state.tasks.entities[id]),id:'new-fixture-task',parentId:undefined,subTaskIds:[],title:'new fixture',isDone:false};
 await add('[Task Shared] addTask','CRT','TASK',{actionPayload:{task:newTask,isAddToBottom:true,isAddToBacklog:false},entityChanges:[]});
 await add('[Boards] Update Panel Cfg TaskIds','UPD','BOARD',{actionPayload:{panelId:'regression-panel',taskIds:['new-fixture-task']},entityChanges:[]});
 const afterBoard=await project(db,'test-password');
 assert.equal(afterBoard.state.tasks.entities['new-fixture-task'].title,'new fixture');
 assert.deepEqual(afterBoard.state.boards.boardCfgs[0].panels[0].taskIds,['new-fixture-task']);

 await add('[Task Shared] updateTask','UPD','TASK',{actionPayload:{task:{id,changes:{isDone:true,title:'MCP fixture'}}},entityChanges:[]});
 const done=await project(db,'test-password');assert.equal(done.state.tasks.entities[id].isDone,true);assert.equal(done.state.tasks.entities[id].title,'MCP fixture');
 const task=done.state.tasks.entities[id];const subTasks=task.subTaskIds.map((x:string)=>done.state.tasks.entities[x]);
 await add('[Task Shared] moveToArchive','UPD','TASK',{actionPayload:{tasks:[{...task,subTasks}]},entityChanges:[]});
 const archived=await project(db,'test-password');assert.equal(archived.state.tasks.entities[id],undefined);
 await add('[Unknown] mutation','UPD','TASK',{actionPayload:{},entityChanges:[]});
 await assert.rejects(project(db,'test-password'),/PROJECTION_ACTION_UNSUPPORTED/);db.close();
});
