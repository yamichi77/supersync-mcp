import {compareVectorClocks,mergeVectorClocks} from '@sp/sync-core';
import {validatePage} from './ingest.js';
import {applyArchive,emptyArchive} from './archive.js';
import type {DatabaseSync} from 'node:sqlite';
export async function officialModule(){(globalThis as any).window??={};const path='../dist/official.mjs';return import(path);}
export async function project(db:DatabaseSync,password:string){
 const official=await officialModule();
 let state:any,clock:Record<string,number>={},serverSeq=0,initialized=false;
 const all=[];
 for(const row of db.prepare('SELECT wire FROM operations ORDER BY seq').all()){
  const wire=JSON.parse(String(row.wire));
  const {decoded}=await validatePage({ops:[wire],hasMore:false,latestSeq:wire.serverSeq},password);all.push(decoded[0]);
 }
 // The server fast-forwards downloads to its latest causally accepted full-state operation.
 for(const {op,serverSeq:seq} of all){
  const full=['SYNC_IMPORT','BACKUP_IMPORT','REPAIR'].includes(op.opType);
  if(full){
   if(initialized&&op.opType==='REPAIR'&&(op.repairBaseServerSeq??-1)<serverSeq&&!['GREATER_THAN','EQUAL'].includes(compareVectorClocks(op.vectorClock,clock)))throw new Error('PROJECTION_CONFLICT_UNSUPPORTED');
   const action=official.convertOpToAction(op);
   const snapshot=action.appDataComplete;
   const archives:any={};
   for(const key of ['archiveYoung','archiveOld']){
    const incoming=snapshot[key];
    archives[key]=incoming===undefined?state?.[key]??emptyArchive():op.opType!=='BACKUP_IMPORT'&&state?.[key]?.task?.ids?.length&&!incoming?.task?.ids?.length?state[key]:incoming;
   }
   state={...official.reduce(undefined,action),...archives};
   initialized=true;clock={...op.vectorClock};serverSeq=seq;continue;
  }
  if(!initialized)throw new Error('PROJECTION_SNAPSHOT_REQUIRED');
  if(seq!==serverSeq+1)throw new Error('PROJECTION_LOG_GAP');
  // Operations accepted by SuperSync are ordered by server sequence. A global
  // vector comparison incorrectly rejects valid concurrent edits to different entities.
  if(!official.KNOWN_ACTION_TYPES.has(op.actionType)&&!official.isLwwUpdateActionType(op.actionType))throw new Error('PROJECTION_ACTION_UNSUPPORTED');
  const action=official.convertOpToAction(op);
  const archives=applyArchive(state,action,op.timestamp,official);
  state={...official.reduce(state,action),...archives};
  clock=mergeVectorClocks(clock,op.vectorClock);serverSeq=seq;
 }
 if(!initialized)throw new Error('PROJECTION_SNAPSHOT_REQUIRED');
 return {state,serverSeq,clock};
}
