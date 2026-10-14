import {loadCredentials} from './config.js';
import {openStore,readLimitedJson,validatePage,storePage} from './ingest.js';
import {project} from './projection.js';import {mkdirSync} from 'node:fs';
import {openAccountStore,type Account} from './accounts.js';
import {mergeVectorClocks} from '@sp/sync-core';
export function createSync(account?:Account){
let pending:Promise<Awaited<ReturnType<typeof project>>>|undefined;
let last:Awaited<ReturnType<typeof project>>|undefined;let at=0;
async function download(db:ReturnType<typeof openStore>,cfg:ReturnType<typeof loadCredentials>){
 let cursor=Number(db.prepare("SELECT value FROM metadata WHERE key='downloadCursor'").get()?.value??0);
 for(let n=0;n<100;n++){
  const url=new URL('/api/sync/ops',cfg.baseUrl);url.searchParams.set('sinceSeq',String(cursor));url.searchParams.set('limit','100');
  const response=await fetch(url,{headers:{Authorization:'Bearer '+cfg.accessToken},redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error('SUPERSYNC_UNAVAILABLE');
  const {page}=await validatePage(await readLimitedJson(response),cfg.encryptionPassword);storePage(db,page);
  if(page.snapshotVectorClock){
   const previous=JSON.parse(String(db.prepare("SELECT value FROM metadata WHERE key='snapshotClock'").get()?.value??'{}'));
   const clock=mergeVectorClocks(previous,page.snapshotVectorClock);
   db.prepare("INSERT INTO metadata(key,value) VALUES('snapshotClock',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(clock));
  }
  if(!page.hasMore){
   const result=await project(db,cfg.encryptionPassword);
   if(result.serverSeq!==page.latestSeq)throw new Error('PROJECTION_NOT_CURRENT');
   const snapshotClock=JSON.parse(String(db.prepare("SELECT value FROM metadata WHERE key='snapshotClock'").get()?.value??'{}'));
   return {...result,clock:mergeVectorClocks(result.clock,snapshotClock)};
  }
  const next=page.ops.at(-1)?.serverSeq;if(!next||next<=cursor)throw new Error('SYNC_NO_PROGRESS');cursor=next;
 }
 throw new Error('SYNC_LIMIT');
}
async function refresh(){
 const cfg=loadCredentials(account?.credentialsPath);const db=account?openAccountStore(account):(mkdirSync('data',{recursive:true,mode:0o700}),openStore('data/operations.sqlite'));
 try{
  try{return await download(db,cfg);}catch(e){
   if(!(e instanceof Error)||!['PROJECTION_LOG_GAP','PROJECTION_SNAPSHOT_REQUIRED','PROJECTION_NOT_CURRENT'].includes(e.message))throw e;
   // A clean download is validated and projected before replacing only the
   // encrypted read cache. Durable write identities and the outbox survive.
   const candidate=openStore(':memory:');
   try{const result=await download(candidate,cfg);replaceDownloadedCache(db,candidate);return result;}finally{candidate.close();}
  }
 }finally{db.close();}
}
function invalidate(){last=undefined;at=0;}
async function current(force=false){
 if(force){if(pending)await pending;invalidate();}
 if(last&&Date.now()-at<15000)return last;
 if(!pending)pending=refresh().then(v=>{last=v;at=Date.now();return v;}).finally(()=>{pending=undefined;});
 return pending;
}

return {current,invalidate};
}
export function replaceDownloadedCache(db:ReturnType<typeof openStore>,candidate:ReturnType<typeof openStore>){
 db.exec('BEGIN IMMEDIATE');
 try{
  db.exec('DELETE FROM operations');
  const insert=db.prepare('INSERT INTO operations(seq,id,wire) VALUES(?,?,?)');
  for(const row of candidate.prepare('SELECT seq,id,wire FROM operations ORDER BY seq').all())insert.run(row.seq,row.id,row.wire);
  for(const key of ['downloadCursor','snapshotClock']){
   const value=candidate.prepare('SELECT value FROM metadata WHERE key=?').get(key)?.value;
   db.prepare('DELETE FROM metadata WHERE key=?').run(key);
   if(value!==undefined)db.prepare('INSERT INTO metadata(key,value) VALUES(?,?)').run(key,value);
  }
  db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
}

const legacySync=createSync();
export const current=legacySync.current,invalidate=legacySync.invalidate;
