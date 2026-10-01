import {z} from 'zod';

// Bounds cap a single MCP request. They are not workflow-state counts.
export const MAX_COLUMNS=50;
const identifier=z.string().min(1).max(255);
const title=z.string().trim().min(1).max(200).refine(v=>!/[\x00-\x1f]/.test(v));
const tags=z.array(identifier).max(100).refine(ids=>new Set(ids).size===ids.length);
const done=z.enum(['all','done','undone']);
const scheduled=z.enum(['all','scheduled','not_scheduled']);
const backlog=z.enum(['all','no_backlog','only_backlog']);
const match=z.enum(['all','any']);
const fields={title,includedTagIds:tags.optional(),excludedTagIds:tags.optional(),
 includedTagsMatch:match.optional(),excludedTagsMatch:match.optional(),taskDoneState:done.optional(),
 scheduledState:scheduled.optional(),backlogState:backlog.optional(),isParentTasksOnly:z.boolean().optional()};
export const columnSchema=z.object(fields).strict();
export const columnPatchSchema=columnSchema.partial().extend({id:identifier})
 .strict().refine(v=>Object.keys(v).some(k=>k!=='id'));
export const createBoardSchema=z.object({projectId:identifier,title,cols:z.number().int().min(1).max(12).optional(),
 columns:z.array(columnSchema).min(1).max(MAX_COLUMNS)}).strict();
export const updateBoardSchema=z.object({id:identifier,title:title.optional(),cols:z.number().int().min(1).max(12).optional(),
 columns:z.array(columnPatchSchema).min(1).max(MAX_COLUMNS).optional()}).strict()
 .refine(v=>Object.keys(v).some(k=>k!=='id'));
export type BoardColumn=z.infer<typeof columnSchema>;
export type BoardInput=z.infer<typeof createBoardSchema>;
export type BoardUpdate=z.infer<typeof updateBoardSchema>;
const doneValues={all:1,done:2,undone:3};
const scheduledValues={all:1,scheduled:2,not_scheduled:3};
const backlogValues={all:1,no_backlog:2,only_backlog:3};
const patchKeys=new Set(Object.keys(fields));
function validated<T>(schema:z.ZodType<T>,value:unknown):T{
 const result=schema.safeParse(value);if(!result.success)throw new Error('WRITE_VALIDATION_FAILED');return result.data;
}
function nativeFields(column:Record<string,any>,state:any,creating=false){
 const result:Record<string,any>={};
 for(const [key,value] of Object.entries(column)){
  if(key==='id')continue;
  if(!patchKeys.has(key))throw new Error('WRITE_VALIDATION_FAILED');
  if(key==='includedTagIds'||key==='excludedTagIds'){
   // TODAY is a virtual scheduled-day view, not a mutable physical task tag.
   if(value.some((id:string)=>id==='TODAY'))throw new Error('TODAY_REQUIRES_SCHEDULING');
   if(value.some((id:string)=>!Object.hasOwn(state.tag.entities,id)))throw new Error('TAG_NOT_FOUND');
   result[key]=[...value];
  }else if(key==='taskDoneState')result[key]=doneValues[value as keyof typeof doneValues];
  else if(key==='scheduledState')result[key]=scheduledValues[value as keyof typeof scheduledValues];
  else if(key==='backlogState')result[key]=backlogValues[value as keyof typeof backlogValues];
  else result[key]=value;
 }
 return creating?{includedTagIds:[],excludedTagIds:[],includedTagsMatch:'all',excludedTagsMatch:'any',
   taskDoneState:1,scheduledState:1,backlogState:1,isParentTasksOnly:false,...result}:result;
}
export function boardAction(state:any,input:unknown,id:string){
 const value=validated(createBoardSchema,input);
 if(!Object.hasOwn(state.projects.entities,value.projectId)||state.projects.entities[value.projectId].isArchived)throw new Error('PROJECT_NOT_FOUND');
 return {type:'[Boards] Add Board',board:{id,title:value.title,cols:value.cols??Math.min(3,value.columns.length),
  panels:value.columns.map((column,index)=>({...nativeFields(column,state,true),id:id+'-'+index,taskIds:[],projectIds:[value.projectId]}))}};
}
export function boardUpdateAction(state:any,input:unknown){
 const value=validated(updateBoardSchema,input);
 const board=state.boards.boardCfgs.find((b:any)=>b.id===value.id);
 if(!board)throw new Error('BOARD_NOT_FOUND');
 const updates:Record<string,any>={};
 if(value.title!==undefined)updates.title=value.title;
 if(value.cols!==undefined)updates.cols=value.cols;
 if(value.columns){
  const ids=value.columns.map(c=>c.id);
  if(new Set(ids).size!==ids.length||ids.some(id=>!board.panels.some((p:any)=>p.id===id)))throw new Error('WRITE_VALIDATION_FAILED');
  // Validate all patches first, then map the original array. No mutation, reorder,
  // new panel, taskIds or projectIds edits are possible through this operation.
  const patches=new Map(value.columns.map(c=>[c.id,nativeFields(c,state)]));
  updates.panels=board.panels.map((p:any)=>patches.has(p.id)?{...p,...patches.get(p.id)}:p);
 }
 return {type:'[Boards] Update Board',id:value.id,updates};
}
export function publicBoard(board:any){
 if(!board)return null;
 return {id:board.id,title:board.title,cols:board.cols,columns:board.panels.map((p:any)=>({id:p.id,title:p.title,
  taskIds:[...(p.taskIds||[])],projectIds:[...(p.projectIds??(p.projectId?[p.projectId]:[]))],
  includedTagIds:[...(p.includedTagIds||[])],excludedTagIds:[...(p.excludedTagIds||[])],
  includedTagsMatch:p.includedTagsMatch??'all',excludedTagsMatch:p.excludedTagsMatch??'any',
  taskDoneState:({1:'all',2:'done',3:'undone'} as any)[p.taskDoneState],
  scheduledState:({1:'all',2:'scheduled',3:'not_scheduled'} as any)[p.scheduledState],
  backlogState:({1:'all',2:'no_backlog',3:'only_backlog'} as any)[p.backlogState??1],isParentTasksOnly:p.isParentTasksOnly}))};
}
export const boardOutput=z.object({id:identifier,title:z.string(),cols:z.number().int(),columns:z.array(z.object({
 id:identifier,title:z.string(),taskIds:z.array(z.string()),projectIds:z.array(z.string()),
 includedTagIds:z.array(z.string()),excludedTagIds:z.array(z.string()),includedTagsMatch:match,excludedTagsMatch:match,
 taskDoneState:done,scheduledState:scheduled,backlogState:backlog,isParentTasksOnly:z.boolean()}))});
