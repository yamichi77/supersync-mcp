import {createHmac,randomUUID} from 'node:crypto';
import {encrypt} from '@sp/sync-core';
import {CURRENT_SCHEMA_VERSION,SuperSyncUploadOpsRequestSchema,SuperSyncUploadOpsResponseSchema} from '@sp/shared-schema';
import {loadCredentials} from './config.js';
import {openStore,readLimitedJson} from './ingest.js';
import {current,invalidate,createSync} from './sync.js';
import {openAccountStore,type Account} from './accounts.js';
import {officialModule} from './projection.js';
import {boardAction,boardUpdateAction,type BoardColumn,type BoardUpdate} from './boards.js';
import {dateActions,dateContext,dateState,hasDates,validateDates,type DateInput} from './dates.js';
export type WriteInput=DateInput & {requestId:string;kind:'create'|'create_project'|'create_board'|'update_board'|'update'|'complete'|'reopen'|'tags'|'kanban';id?:string;expectedServerSeq?:number;projectId?:string;parentId?:string;title?:string;notes?:string;addTagIds?:string[];removeTagIds?:string[];status?:'todo'|'in_progress'|'done';columns?:BoardColumn[]|BoardUpdate['columns'];cols?:number};
// Each account bridge serves only its linked account. Only its active, top-level tasks
// may be parents; archived/foreign IDs and malformed existing hierarchies fail closed.
export function validateParent(state:any,parentId:string,projectId:string){
 if(typeof parentId!=='string'||!parentId.length||parentId.length>255)throw new Error('WRITE_VALIDATION_FAILED');
 const entities=state.tasks.entities;
 if(!Object.hasOwn(entities,parentId)||!entities[parentId])throw new Error('TASK_NOT_FOUND');
 const parent=entities[parentId];
 if(parent.projectId!==projectId)throw new Error('PARENT_PROJECT_MISMATCH');
 if(parent.id!==parentId||parent.parentId||!Array.isArray(parent.subTaskIds)||new Set(parent.subTaskIds).size!==parent.subTaskIds.length)throw new Error('INVALID_TASK_HIERARCHY');
 for(const id of parent.subTaskIds){
  const child=Object.hasOwn(entities,id)?entities[id]:undefined;
  if(id===parentId||!child||child.id!==id||child.parentId!==parentId||child.projectId!==projectId||!Array.isArray(child.subTaskIds)||child.subTaskIds.length)throw new Error('INVALID_TASK_HIERARCHY');
 }
 for(const task of Object.values(entities) as any[]){
  if(task?.subTaskIds?.includes(parentId)||(task?.parentId===parentId&&!parent.subTaskIds.includes(task.id)))throw new Error('INVALID_TASK_HIERARCHY');
 }
 return parent;
}
export function projectAction(official:any,state:any,title:string|undefined,id:string){
 if(!title?.trim()||title!==title.trim()||title.length>200||/[\x00-\x1f]/.test(title))throw new Error('WRITE_VALIDATION_FAILED');
 if(Object.values(state.projects.entities).some((p:any)=>p?.title===title))throw new Error('PROJECT_NAME_ALREADY_EXISTS');
 return {type:'[Project] Add Project',project:{...structuredClone(official.DEFAULT_PROJECT),id,title}};
}
let queue:Promise<unknown>=Promise.resolve();
export function writeTask(input:WriteInput){const result=queue.then(()=>perform(input));queue=result.catch(()=>{});return result;}
export function initOutbox(db:ReturnType<typeof openStore>){db.exec('CREATE TABLE IF NOT EXISTS outbox(requestId TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, body TEXT NOT NULL, taskId TEXT NOT NULL, status TEXT NOT NULL, serverSeq INTEGER, error TEXT)');}
export async function submit(db:ReturnType<typeof openStore>,requestId:string,cfg:{baseUrl:string;accessToken:string},send:typeof fetch=fetch,onInvalidate=invalidate){
 const row=db.prepare('SELECT * FROM outbox WHERE requestId=?').get(requestId)!;
 if(row.status==='rejected')throw new Error(row.error==='PARTIALLY_ACCEPTED'?'WRITE_PARTIALLY_ACCEPTED':'WRITE_REJECTED');
 if(row.status==='accepted')return {taskId:String(row.taskId),serverSeq:Number(row.serverSeq),requestId,replayed:true};
 let response:Response;
 try{response=await send(new URL('/api/sync/ops',cfg.baseUrl),{method:'POST',headers:{Authorization:'Bearer '+cfg.accessToken,'Content-Type':'application/json'},body:String(row.body),redirect:'error',signal:AbortSignal.timeout(25000)});}catch{throw new Error('WRITE_PENDING_RETRY_SAME_REQUEST');}
 if(!response.ok)throw new Error('WRITE_PENDING_RETRY_SAME_REQUEST');
 const parsed=SuperSyncUploadOpsResponseSchema.safeParse(await readLimitedJson(response));
 if(!parsed.success)throw new Error('WRITE_PENDING_RETRY_SAME_REQUEST');
 const operations=JSON.parse(String(row.body)).ops;
 const results=operations.map((op:any)=>parsed.data.results.find(r=>r.opId===op.id));
 if(results.some((r:any)=>!r))throw new Error('WRITE_PENDING_RETRY_SAME_REQUEST');
 if(results.some((r:any)=>!r.accepted)){
  const partial=results.some((r:any)=>r.accepted);
  db.prepare("UPDATE outbox SET status='rejected',error=? WHERE requestId=?").run(partial?'PARTIALLY_ACCEPTED':'SERVER_REJECTED',requestId);
  onInvalidate();
  throw new Error(partial?'WRITE_PARTIALLY_ACCEPTED':'WRITE_REJECTED');
 }
 const result={serverSeq:Math.max(...results.map((r:any)=>r.serverSeq))};
 if(results.some((r:any)=>!Number.isSafeInteger(r.serverSeq)||r.serverSeq<1))throw new Error('WRITE_PENDING_RETRY_SAME_REQUEST');
 if(!Number.isSafeInteger(result.serverSeq)||result.serverSeq!<1)throw new Error('WRITE_PENDING_RETRY_SAME_REQUEST');
 db.prepare("UPDATE outbox SET status='accepted',serverSeq=? WHERE requestId=?").run(result.serverSeq!,requestId);
 onInvalidate();
 return {taskId:String(row.taskId),serverSeq:result.serverSeq,requestId,replayed:false};
}
export async function perform(input:WriteInput,deps={loadCredentials,current,openStore,officialModule,send:fetch},onInvalidate=invalidate){
 if(input.kind==='create'||input.kind==='update')validateDates(input);
 const cfg=deps.loadCredentials();const p=await deps.current(true);const db=deps.openStore('data/operations.sqlite');initOutbox(db);
 try{
  const fingerprint=createHmac('sha256',cfg.encryptionPassword).update(JSON.stringify(Object.fromEntries(Object.entries(input).sort(([a],[b])=>a.localeCompare(b))))).digest('hex');
  const existing=db.prepare('SELECT fingerprint FROM outbox WHERE requestId=?').get(input.requestId);
  if(existing){if(existing.fingerprint!==fingerprint)throw new Error('IDEMPOTENCY_KEY_REUSED');return await submit(db,input.requestId,cfg,deps.send,onInvalidate);}
  if(db.prepare("SELECT 1 FROM outbox WHERE status='pending'").get())throw new Error('WRITE_PENDING_RETRY_SAME_REQUEST');
  if(input.expectedServerSeq!==p.serverSeq)throw new Error('STALE_REVISION_READ_AGAIN');
  const official=await deps.officialModule();const now=Date.now();let taskId:string,action:any;
  if(input.kind==='update_board'){
   taskId=input.id!;
   const {requestId,expectedServerSeq,kind,...value}=input;action=boardUpdateAction(p.state,value);
  }else if(input.kind==='create_board'){
   taskId=randomUUID();
   const {requestId,expectedServerSeq,kind,...value}=input;action=boardAction(p.state,value,taskId);
  }else if(input.kind==='create_project'){
   taskId=randomUUID();action=projectAction(official,p.state,input.title,taskId);
  }else if(input.kind==='create'){
   if(!input.projectId||!Object.hasOwn(p.state.projects.entities,input.projectId)||p.state.projects.entities[input.projectId].isArchived)throw new Error('PROJECT_NOT_FOUND');
   if(input.parentId!==undefined)validateParent(p.state,input.parentId,input.projectId);
   taskId=randomUUID();
   const task={...structuredClone(official.DEFAULT_TASK),id:taskId,created:now,title:input.title,notes:input.notes??'',projectId:input.projectId,...(input.parentId!==undefined?{parentId:input.parentId}:{})};
   action=input.parentId!==undefined?{type:'[Task] Add SubTask',task,parentId:input.parentId,isIgnoreShortSyntax:true}:{type:'[Task Shared] addTask',task,workContextId:input.projectId,workContextType:'PROJECT',isAddToBottom:true,isAddToBacklog:false,isIgnoreShortSyntax:true};
  }else{
   taskId=input.id!;
   if(!taskId||!Object.hasOwn(p.state.tasks.entities,taskId))throw new Error('TASK_NOT_FOUND');
   const changes:any={};
   if(input.kind==='update'){if(input.title!==undefined)changes.title=input.title;if(input.notes!==undefined)changes.notes=input.notes;}
   else if(input.kind==='kanban'){
    const tag='KANBAN_IN_PROGRESS';
    if(input.status==='in_progress'&&!Object.hasOwn(p.state.tag.entities,tag))throw new Error('TAG_NOT_FOUND');
    changes.isDone=input.status==='done';
    if(changes.isDone)changes.doneOn=now;
    changes.tagIds=p.state.tasks.entities[taskId].tagIds.filter((id:string)=>id!==tag);
    if(input.status==='in_progress')changes.tagIds.push(tag);
   }
   else if(input.kind==='tags'){
    const add=input.addTagIds??[],remove=input.removeTagIds??[];
    if(!add.length&&!remove.length)throw new Error('WRITE_VALIDATION_FAILED');
    if([...add,...remove].includes('TODAY'))throw new Error('TODAY_REQUIRES_SCHEDULING');
    if(add.some(id=>remove.includes(id)))throw new Error('WRITE_VALIDATION_FAILED');
    for(const id of add)if(!Object.hasOwn(p.state.tag.entities,id))throw new Error('TAG_NOT_FOUND');
    changes.tagIds=[...new Set([...p.state.tasks.entities[taskId].tagIds.filter((id:string)=>!remove.includes(id)),...add])];
   }
   else {changes.isDone=input.kind==='complete';if(changes.isDone)changes.doneOn=now;}
   action={type:'[Task Shared] updateTask',task:{id:taskId,changes},isIgnoreShortSyntax:true};
  }
  const actions=[action];
  if((input.kind==='create'||input.kind==='update')&&hasDates(input)){
   if(input.kind==='update'&&!Object.keys(action.task.changes).length)actions.length=0;
   actions.push(...dateActions(input,input.kind==='create'?action.task:p.state.tasks.entities[taskId],dateContext(official,p.state,now)));
  }
  let predicted=dateState(official,structuredClone(p.state),now);
  for(const a of actions){
   const before=predicted.tasks?.entities[taskId];
   predicted=official.reduce(predicted,{...a,meta:{isRemote:true}});
   // Standard deadline auto-planning may clear an existing timed schedule.
   // Reject before enqueueing instead of silently losing its notification.
   if(a.type==='[Task Shared] setDeadline'&&before?.remindAt!=null&&predicted.tasks.entities[taskId]?.remindAt!==before.remindAt)throw new Error('REMINDER_SCHEDULE_CONFLICT');
  }
  const isBoard=input.kind==='create_board'||input.kind==='update_board';
  const created=isBoard?predicted.boards.boardCfgs.some((b:any)=>b.id===taskId):(input.kind==='create_project'?predicted.projects:predicted.tasks).entities[taskId];
  if(!created)throw new Error('WRITE_VALIDATION_FAILED');
  if(input.kind==='create'&&input.parentId!==undefined){
   validateParent(predicted,input.parentId,input.projectId!);
   if(created.parentId!==input.parentId||created.projectId!==input.projectId||predicted.tasks.entities[input.parentId].subTaskIds.filter((id:string)=>id===taskId).length!==1)throw new Error('WRITE_VALIDATION_FAILED');
  }
  let clientId=String(db.prepare("SELECT value FROM metadata WHERE key='clientId'").get()?.value??'');
  if(!clientId){clientId='sp-mcp-'+randomUUID();db.prepare("INSERT INTO metadata(key,value) VALUES('clientId',?)").run(clientId);}
  const counter=Math.max(Number(db.prepare("SELECT value FROM metadata WHERE key='clientCounter'").get()?.value??0),p.clock[clientId]??0)+1;
  const ops=[];
  for(const [index,a] of actions.entries()){
  if(!official.KNOWN_ACTION_TYPES.has(a.type))throw new Error('WRITE_VALIDATION_FAILED');
  const {type,...actionPayload}=a;
  const op={id:official.uuidv7(),clientId,actionType:type,opType:index===0&&input.kind.startsWith('create')?'CRT':'UPD',entityType:type.startsWith('[Planner]')?'PLANNER':isBoard?'BOARD':input.kind==='create_project'?'PROJECT':'TASK',entityId:taskId,payload:await encrypt(JSON.stringify({actionPayload,entityChanges:[]}),cfg.encryptionPassword),isPayloadEncrypted:true,vectorClock:{...p.clock,[clientId]:counter+index},timestamp:now,schemaVersion:CURRENT_SCHEMA_VERSION};
  ops.push(op);
  }
  const body=JSON.stringify(SuperSyncUploadOpsRequestSchema.parse({ops,clientId,lastKnownServerSeq:p.serverSeq,requestId:input.requestId}));
  db.exec('BEGIN IMMEDIATE');
  try{
   db.prepare("INSERT INTO metadata(key,value) VALUES('clientCounter',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(counter+ops.length-1));
   db.prepare("INSERT INTO outbox(requestId,fingerprint,body,taskId,status) VALUES(?,?,?,?,'pending')").run(input.requestId,fingerprint,body,taskId);
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  return await submit(db,input.requestId,cfg,deps.send,onInvalidate);
 }finally{db.close();}
}

export function createWriter(account:Account,sync:ReturnType<typeof createSync>){
 let accountQueue:Promise<unknown>=Promise.resolve();
 const deps={loadCredentials:()=>loadCredentials(account.credentialsPath),current:sync.current,openStore:()=>openAccountStore(account),officialModule,send:fetch};
 return (input:WriteInput)=>{
  const result=accountQueue.then(()=>perform(input,deps,sync.invalidate));
  accountQueue=result.catch(()=>{});return result;
 };
}
