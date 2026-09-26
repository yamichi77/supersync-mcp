import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {encrypt} from '@sp/sync-core';import {openStore,storePage} from '../src/ingest.js';import {project} from '../src/projection.js';
test('independent clocks, tag membership, archive reads and full-state fast-forward',async()=>{
 const fixture=JSON.parse(readFileSync('vendor-source/src/app/op-log/validation/test-fixtures/frozen-state-v18.15.json','utf8')).state;
 const db=openStore(':memory:');let seq=0;
 async function add(actionType:string,opType:string,payload:any,clock:any={a:seq+1},entityId?:string){
  if(payload.actionPayload)payload.entityChanges=[];
  seq++;storePage(db,{ops:[{serverSeq:seq,receivedAt:1750000000000,op:{id:'op'+seq,clientId:'a',actionType,opType,entityType:opType==='SYNC_IMPORT'?'ALL':'TASK',entityId,payload:await encrypt(JSON.stringify(payload),'test'),isPayloadEncrypted:true,vectorClock:clock,timestamp:1750000000000,schemaVersion:4}}],hasMore:false,latestSeq:seq});
 }
 await add('[SP_ALL] Load(import) all data','SYNC_IMPORT',fixture);
 const initial=await project(db,'test'),ids=initial.state.tasks.ids;
 const id=ids[0];const tagId=initial.state.tag.ids.find((id:string)=>id!=='TODAY');
 assert.ok(tagId);
 await add('[Task Shared] updateTask','UPD',{actionPayload:{task:{id,changes:{tagIds:[tagId]}},isIgnoreShortSyntax:true}},{a:1,b:1},id);
 await add('[Task Shared] updateTask','UPD',{actionPayload:{task:{id:ids[1]??id,changes:{notes:'independent'}}}},{a:2},ids[1]??id);
 const changed=await project(db,'test');assert.ok(changed.state.tasks.entities[id].tagIds.includes(tagId));assert.ok(changed.state.tag.entities[tagId].taskIds.includes(id));
 const task=changed.state.tasks.entities[id];
 await add('[Task Shared] moveToArchive','UPD',{actionPayload:{tasks:[{...task,subTasks:task.subTaskIds.map((id:string)=>changed.state.tasks.entities[id])}] }},{a:3,b:1},id);
 const archived=await project(db,'test');assert.ok(archived.state.archiveYoung.task.entities[id]);assert.equal(archived.state.tasks.entities[id],undefined);
 await add('[Archive] Flush Young to Old','UPD',{actionPayload:{timestamp:1900000000000}},{a:4,b:1});
 const flushed=await project(db,'test');assert.ok(flushed.state.archiveOld.task.entities[id]);
 seq+=10;
 await add('[SP_ALL] Load(import) all data','SYNC_IMPORT',fixture,{c:1});
 const replacement=await project(db,'test');assert.equal(replacement.serverSeq,seq);assert.ok(replacement.state.tasks.entities[id]);
 db.close();
});
