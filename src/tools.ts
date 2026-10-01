import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {z} from 'zod';import {boardOutput,columnSchema,columnPatchSchema,publicBoard} from './boards.js';import {writeTask} from './write.js';import {current} from './sync.js';
function selectFields(value:any,keys:string[]){return Object.fromEntries(keys.filter(k=>Object.hasOwn(value,k)).map(k=>[k,value[k]]));}
const taskFields=['id','title','notes','isDone','projectId','tagIds','parentId','subTaskIds','timeEstimate','timeSpent','dueDay','dueWithTime','deadlineDay','created','doneOn'];
const taskOutput=z.object({
 id:z.string(),title:z.string(),notes:z.string().optional(),isDone:z.boolean().optional(),
 projectId:z.string().optional(),tagIds:z.array(z.string()).optional(),
 parentId:z.string().optional(),subTaskIds:z.array(z.string()).optional(),
 timeEstimate:z.number().optional(),timeSpent:z.number().optional(),
 dueDay:z.string().nullable().optional(),dueWithTime:z.number().nullable().optional(),
 deadlineDay:z.string().nullable().optional(),created:z.number().optional(),doneOn:z.number().optional(),
});
const contextOutput=z.object({id:z.string(),title:z.string(),color:z.string().nullable().optional(),isArchived:z.boolean().optional()});
const serverSeqOutput=z.number().int().min(0);
const writeOutput={taskId:z.string(),serverSeq:serverSeqOutput,requestId:z.string(),replayed:z.boolean()};
export function makeServer(provider:typeof current=current,canWrite=false,writer:typeof writeTask=writeTask){
 const mcp=new McpServer({name:'super-productivity-mcp',version:'0.3.0'});
 const annotations={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};
 const output=(value:Record<string,unknown>)=>{
  const text=JSON.stringify(value);
  return {content:[{type:'text' as const,text}],structuredContent:JSON.parse(text) as Record<string,unknown>};
 };
 const error=(e:unknown)=>{
  const known=new Set(['PROJECTION_ACTION_UNSUPPORTED','PROJECTION_CONFLICT_UNSUPPORTED','PROJECTION_LOG_GAP','PROJECTION_SNAPSHOT_REQUIRED','PROJECTION_NOT_CURRENT','SUPERSYNC_UNAVAILABLE','DECRYPTION_FAILED','UNSUPPORTED_SCHEMA_VERSION','SYNC_LIMIT','SYNC_NO_PROGRESS','WRITE_REJECTED','WRITE_PENDING_RETRY_SAME_REQUEST','IDEMPOTENCY_KEY_REUSED','STALE_REVISION_READ_AGAIN','PROJECT_NOT_FOUND','BOARD_NOT_FOUND','PROJECT_NAME_ALREADY_EXISTS','TASK_NOT_FOUND','WRITE_VALIDATION_FAILED','TAG_NOT_FOUND','TODAY_REQUIRES_SCHEDULING']);
  const code=e instanceof Error&&known.has(e.message)?e.message:'SYNC_FAILED';
  console.warn(JSON.stringify({event:'sync_failed',reason:code}));
  return {isError:true,content:[{type:'text' as const,text:'操作を完了できません。診断コード: '+code}]};
 };
 mcp.registerTool('get_sync_status',{description:'現在のSuperSync同期状態。',outputSchema:{serverSeq:serverSeqOutput,readOnly:z.boolean(),activeTasks:z.number().int().min(0),archivesIncluded:z.boolean()},annotations},async()=>{try{const p=await provider();return output({serverSeq:p.serverSeq,readOnly:!canWrite,activeTasks:p.state.tasks.ids.length,archivesIncluded:true});}catch(e){return error(e);}});
 const pageSchema={offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(100).default(50)};
 for(const [tool,key] of [['list_tasks','tasks'],['list_archived_tasks','archives'],['list_projects','projects'],['list_tags','tag']] as const){
  mcp.registerTool(tool,{description:key==='tasks'?'アクティブなタスクを一覧表示。アーカイブは含まない。':'同期済みの一覧を表示。',inputSchema:pageSchema,outputSchema:{serverSeq:serverSeqOutput,total:z.number().int().min(0),items:z.array(['tasks','archives'].includes(key)?taskOutput:contextOutput)},annotations},async({offset,limit})=>{
   try{const p=await provider();const archivedEntities={...p.state.archiveOld?.task?.entities,...p.state.archiveYoung?.task?.entities};const model=key==='archives'?{ids:Object.keys(archivedEntities).sort(),entities:archivedEntities}:p.state[key];const ids=model.ids.slice(offset,offset+limit);return output({serverSeq:p.serverSeq,total:model.ids.length,items:ids.map((id:string)=>selectFields(model.entities[id],['tasks','archives'].includes(key)?taskFields:['id','title','color','isArchived']))});}catch(e){return error(e);}
  });
 }
 mcp.registerTool('get_task',{description:'IDでタスクを取得。アーカイブも検索する。',inputSchema:{id:z.string().min(1).max(255)},outputSchema:{serverSeq:serverSeqOutput,task:taskOutput.nullable()},annotations},async({id})=>{
  try{const p=await provider();const task=Object.hasOwn(p.state.tasks.entities,id)?p.state.tasks.entities[id]:(p.state.archiveYoung?.task?.entities?.[id]??p.state.archiveOld?.task?.entities?.[id]??null);return output({serverSeq:p.serverSeq,task:task?selectFields(task,taskFields):null});}catch(e){return error(e);}
 });

 mcp.registerTool('get_board',{description:'IDでボードの現在設定と列・カード順序を取得する。見つからない場合はnull。',inputSchema:{id:z.string().min(1).max(255)},outputSchema:{serverSeq:serverSeqOutput,board:boardOutput.nullable()},annotations},async({id})=>{try{const p=await provider();return output({serverSeq:p.serverSeq,board:publicBoard(p.state.boards.boardCfgs.find((b:any)=>b.id===id))});}catch(e){return error(e);}});

 if(canWrite){
  const base={requestId:z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).describe('操作ごとに一意な要求ID。通信失敗後の再送では同じID・同じ引数を使用する。'),expectedServerSeq:z.number().int().min(0).describe('直前の読取り結果のserverSeq。競合時は読み直して新しい要求IDで実行。')};
  const writeAnnotations={readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false};
  mcp.registerTool('create_board',{description:'指定プロジェクトに任意の列構成のボードを作成する。タグ・完了条件・表示列数を明示でき、状態数や相互除外は強制しない。',inputSchema:{...base,projectId:z.string().min(1).max(255),title:z.string().min(1).max(200),cols:z.number().int().min(1).max(12).optional(),columns:z.array(columnSchema).min(1).max(50)},outputSchema:{boardId:z.string(),serverSeq:serverSeqOutput,requestId:z.string(),replayed:z.boolean()},annotations:writeAnnotations},async args=>{try{const {taskId,...result}=await writer({...args,kind:'create_board'});return output({...result,boardId:taskId});}catch(e){return error(e);}});
  mcp.registerTool('update_board',{description:'既存ボードの名前・表示列数・指定した既存列の設定だけを更新する。列の追加削除や並べ替え、カード順序・タスク本文やタグの変更は行わない。',inputSchema:{...base,id:z.string().min(1).max(255),title:z.string().min(1).max(200).optional(),cols:z.number().int().min(1).max(12).optional(),columns:z.array(columnPatchSchema).min(1).max(50).optional()},outputSchema:{boardId:z.string(),serverSeq:serverSeqOutput,requestId:z.string(),replayed:z.boolean()},annotations:writeAnnotations},async args=>{try{if(args.title===undefined&&args.cols===undefined&&args.columns===undefined)throw new Error('WRITE_VALIDATION_FAILED');const {taskId,...result}=await writer({...args,kind:'update_board'});return output({...result,boardId:taskId});}catch(e){return error(e);}});
  mcp.registerTool('create_project',{description:'名前を指定して通常プロジェクトを作成する。同名がある場合は拒否する。',inputSchema:{...base,title:z.string().trim().min(1).max(200)},outputSchema:{projectId:z.string(),serverSeq:serverSeqOutput,requestId:z.string(),replayed:z.boolean()},annotations:writeAnnotations},async args=>{try{const {taskId,...result}=await writer({...args,kind:'create_project'});return output({...result,projectId:taskId});}catch(e){return error(e);}});
  mcp.registerTool('create_task',{description:'指定プロジェクトに通常タスクを作成する。予定・外部Issue連携は設定しない。',inputSchema:{...base,projectId:z.string().min(1).max(255),title:z.string().min(1).max(2000),notes:z.string().max(20000).optional()},outputSchema:writeOutput,annotations:writeAnnotations},async args=>{try{return output(await writer({...args,kind:'create'}));}catch(e){return error(e);}});
  mcp.registerTool('update_task',{description:'既存タスクのタイトル・ノートを更新する。未指定項目は保持する。',inputSchema:{...base,id:z.string().min(1).max(255),title:z.string().min(1).max(2000).optional(),notes:z.string().max(20000).optional()},outputSchema:writeOutput,annotations:writeAnnotations},async args=>{try{if(args.title===undefined&&args.notes===undefined)throw new Error('WRITE_VALIDATION_FAILED');return output(await writer({...args,kind:'update'}));}catch(e){return error(e);}});
  mcp.registerTool('update_task_tags',{description:'通常タグを追加・削除する。指定しないタグは保持。タグで管理するKanban列の移動に使う。TODAYは予定日で管理されるため対象外。完了列へはcomplete_taskを使う。',inputSchema:{...base,id:z.string().min(1).max(255),addTagIds:z.array(z.string().min(1).max(255)).max(100).default([]),removeTagIds:z.array(z.string().min(1).max(255)).max(100).default([])},outputSchema:writeOutput,annotations:writeAnnotations},async args=>{try{return output(await writer({...args,kind:'tags'}));}catch(e){return error(e);}});
  mcp.registerTool('set_task_kanban_status',{description:'標準Kanbanの状態をtodo（未着手）、in_progress（進行中）、done（完了）へ変更する。進行中タグと完了状態を一括更新し、ほかのタグは保持する。カスタム列はupdate_task_tagsを使う。',inputSchema:{...base,id:z.string().min(1).max(255),status:z.enum(['todo','in_progress','done'])},outputSchema:writeOutput,annotations:writeAnnotations},async args=>{try{return output(await writer({...args,kind:'kanban'}));}catch(e){return error(e);}});
  for(const kind of ['complete','reopen'] as const)mcp.registerTool(kind+'_task',{description:kind==='complete'?'タスクを完了にする。':'アクティブ領域の完了タスクを未完了に戻す。アーカイブ復元とは別。',inputSchema:{...base,id:z.string().min(1).max(255)},outputSchema:writeOutput,annotations:writeAnnotations},async args=>{try{return output(await writer({...args,kind}));}catch(e){return error(e);}});
 }
 return mcp;
}
