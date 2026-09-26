import test from 'node:test';import assert from 'node:assert/strict';
import {encrypt} from '@sp/sync-core';
import {openStore,validatePage,storePage,readLimitedJson} from '../src/ingest.js';
const operation=(payload:unknown)=>({serverSeq:1,receivedAt:1750000000000,op:{id:'01985bc0-0000-7000-8000-000000000001',actionType:'[Task Shared] updateTask',opType:'UPD',entityType:'TASK',entityId:'task-1',payload,isPayloadEncrypted:true,clientId:'test-client',vectorClock:{'test-client':1},timestamp:1750000000000,schemaVersion:4}});
const response=(item:ReturnType<typeof operation>)=>({ops:[item],hasMore:false,latestSeq:1});
test('official encryption roundtrip; plaintext, newer schemas and wrong keys fail',async()=>{
 const item=operation(await encrypt(JSON.stringify({task:{id:'task-1',changes:{title:'private fixture'}}}),'fixture-password'));
 const {page,decoded}=await validatePage(response(item),'fixture-password');
 assert.equal((decoded[0].op.payload as any).task.changes.title,'private fixture');
 const db=openStore(':memory:');
 storePage(db,page);storePage(db,page);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM operations').get()?.n,1);
 assert.ok(!JSON.stringify(db.prepare('SELECT wire FROM operations').get()).includes('private fixture'));
 const modified=structuredClone(page);modified.ops[0].op.id='01985bc0-0000-7000-8000-000000000002';
 assert.throws(()=>storePage(db,modified),/SEQUENCE_CONTENT_CHANGED/);
 assert.equal(db.prepare("SELECT value FROM metadata WHERE key='downloadCursor'").get()?.value,'1');
 db.close();
 await assert.rejects(validatePage(response(item),'wrong-password'),/DECRYPTION_FAILED/);
 await assert.rejects(validatePage(response({...item,op:{...item.op,isPayloadEncrypted:false}}),'fixture-password'),/UNEXPECTED_PLAINTEXT/);
 await assert.rejects(validatePage(response({...item,op:{...item.op,schemaVersion:5}}),'fixture-password'),/UNSUPPORTED_SCHEMA_VERSION/);
});
test('oversized HTTP response is rejected',async()=>{
 await assert.rejects(readLimitedJson(new Response('123456'),3),/RESPONSE_TOO_LARGE/);
});
