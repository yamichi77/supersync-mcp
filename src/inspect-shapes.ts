import {openStore} from './ingest.js';
import {loadCredentials} from './config.js';
import {decrypt} from '@sp/sync-core';
const db=openStore('data/operations.sqlite');const cfg=loadCredentials();const seen=new Set();
for(const row of db.prepare('SELECT wire FROM operations ORDER BY seq').all()){
 const item=JSON.parse(String(row.wire)),op=item.op;
 if(seen.has(op.actionType))continue;seen.add(op.actionType);
 const p=JSON.parse(await decrypt(op.payload,cfg.encryptionPassword));
 console.log(JSON.stringify({action:op.actionType,opType:op.opType,entityType:op.entityType,keys:Object.keys(p),actionPayloadKeys:p.actionPayload?Object.keys(p.actionPayload):null,entityChanges:p.entityChanges?.map((x:any)=>({entityType:x.entityType,opType:x.opType,keys:Object.keys(x.changes??{})})),snapshotKeys:op.opType==='SYNC_IMPORT'?Object.keys(p.appDataComplete??p):undefined}));
}
db.close();