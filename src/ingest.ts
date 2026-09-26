import {DatabaseSync} from 'node:sqlite';
import {decrypt} from '@sp/sync-core';
import {CURRENT_SCHEMA_VERSION,SuperSyncDownloadOpsResponseSchema} from '@sp/shared-schema';
export function openStore(path:string){
 const db=new DatabaseSync(path);
 db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS operations(seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, wire TEXT NOT NULL); CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);');
 return db;
}
export async function validatePage(input:unknown,password:string){
 const parsed=SuperSyncDownloadOpsResponseSchema.safeParse(input);
 if(!parsed.success)throw new Error('INVALID_DOWNLOAD_RESPONSE');
 const page=parsed.data;
 if(!Number.isSafeInteger(page.latestSeq)||page.latestSeq<0)throw new Error('INVALID_SEQUENCE');
 const clocks=[page.snapshotVectorClock,...page.ops.map(item=>item.op.vectorClock)].filter(Boolean);
 for(const clock of clocks)for(const counter of Object.values(clock!))if(!Number.isSafeInteger(counter)||counter<0)throw new Error('INVALID_VECTOR_CLOCK');
 let previous=-1;
 const decoded=[];
 for(const item of page.ops){
  if(!Number.isSafeInteger(item.serverSeq)||item.serverSeq<1||item.serverSeq<=previous || item.serverSeq>page.latestSeq)throw new Error('INVALID_SEQUENCE');
  previous=item.serverSeq;
  const op=item.op;
  if(op.schemaVersion!==CURRENT_SCHEMA_VERSION)throw new Error('UNSUPPORTED_SCHEMA_VERSION');
  if(!op.isPayloadEncrypted || typeof op.payload!=='string')throw new Error('UNEXPECTED_PLAINTEXT');
  let payload:unknown;
  try{payload=JSON.parse(await decrypt(op.payload,password));}catch{throw new Error('DECRYPTION_FAILED');}
  if(!payload || typeof payload!=='object')throw new Error('INVALID_PAYLOAD');
  decoded.push({...item,op:{...op,payload}});
 }
 return {page,decoded};
}
export function storePage(db:DatabaseSync,page:ReturnType<typeof SuperSyncDownloadOpsResponseSchema.parse>){
 db.exec('BEGIN IMMEDIATE');
 try{
  const put=db.prepare('INSERT INTO operations(seq,id,wire) VALUES(?,?,?)');
  const existing=db.prepare('SELECT wire FROM operations WHERE seq=?');
  for(const item of page.ops){
   const wire=JSON.stringify(item);
   const row=existing.get(item.serverSeq);
   if(row){if(row.wire!==wire)throw new Error('SEQUENCE_CONTENT_CHANGED');}
   else put.run(item.serverSeq,item.op.id,wire);
  }
  // Never advance across an empty page or mark a gap as replayed.
  const last=page.ops.at(-1)?.serverSeq;
  if(last!==undefined)db.prepare("INSERT INTO metadata(key,value) VALUES('downloadCursor',?) ON CONFLICT(key) DO UPDATE SET value=CAST(MAX(CAST(metadata.value AS INTEGER),CAST(excluded.value AS INTEGER)) AS TEXT)").run(String(last));
  db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
}
export async function readLimitedJson(response:Response,maxBytes=32*1024*1024){
 if(!response.body)throw new Error('EMPTY_RESPONSE');
 const chunks:Uint8Array[]=[];let size=0;
 const reader=response.body.getReader();
 try{
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>maxBytes)throw new Error('RESPONSE_TOO_LARGE');chunks.push(value);}
 }finally{await reader.cancel();}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Error('INVALID_JSON');}
}
