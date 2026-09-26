// Headless archive side effects corresponding to upstream ArchiveOperationHandler.
export const emptyArchive=()=>({task:{ids:[] as string[],entities:{} as Record<string,any>},timeTracking:{project:{},tag:{}},lastTimeTrackingFlush:0});
export function applyArchive(state:any,action:any,now:number,official:any){
 let young=structuredClone(state.archiveYoung??emptyArchive()),old=structuredClone(state.archiveOld??emptyArchive());
 const both=[young,old];const type=action.type;
 const remove=(ids:string[])=>{for(const a of both){for(const id of ids)delete a.task.entities[id];a.task.ids=a.task.ids.filter((id:string)=>!ids.includes(id));}};
 if(type==='[Task Shared] moveToArchive'){
  const flat=action.tasks.flatMap((t:any)=>{const {subTasks,...task}=t;return [task,...(subTasks??[])];});
  for(const t of flat){const parent=flat.find((p:any)=>p.id===t.parentId);young.task.entities[t.id]={...t,isDone:true,doneOn:t.isDone&&t.doneOn?t.doneOn:parent?.doneOn??now,reminderId:undefined,dueWithTime:undefined,dueDay:undefined,_hideSubTasksMode:undefined};}
  young.task.ids=Object.keys(young.task.entities).sort();
 }else if(type==='[Task Shared] restoreTask'){remove([action.task.id,...(action.task.subTaskIds??[])]);}
 else if(type==='[Task Shared] updateTask'||type==='[Task Shared] updateTasks'){
  for(const a of both)for(const update of action.tasks??[action.task]){
   if(a.task.entities[update.id]){
    // Use the official task CRUD reducer for derived task fields as upstream does.
    const root=official.reduce(undefined,{type:'@@INIT'});
    const result=official.reduce({...root,tasks:{...root.tasks,...a.task}},{type:'[Task Shared] updateTask',task:update,isIgnoreShortSyntax:true,meta:{isRemote:true}});
    a.task={ids:result.tasks.ids,entities:result.tasks.entities};
   }
  }
 }else if(type==='[Archive] Flush Young to Old'){
  ({archiveYoung:young,archiveOld:old}=official.sortTimeTrackingAndTasksFromArchiveYoungToOld({archiveYoung:young,archiveOld:old,threshold:21*86400000,now:action.timestamp}));
  young.lastTimeTrackingFlush=old.lastTimeTrackingFlush=action.timestamp;
 }else if(type==='[Archive] Compress Archive'){
  young=official.compressArchive(young,action.oneYearAgoTimestamp);old=official.compressArchive(old,action.oneYearAgoTimestamp);
 }else if(type==='[Task Shared] deleteProject'){
  remove(both.flatMap(a=>a.task.ids.filter((id:string)=>a.task.entities[id]?.projectId===action.projectId)));
  for(const a of both)delete a.timeTracking.project[action.projectId];
 }else if(type==='[Tag] Delete Tag'||type==='[Tag] Delete multiple Tags'){
  const ids=action.ids??[action.id];
  for(const a of both){
   const orphaned=a.task.ids.filter((id:string)=>{const t=a.task.entities[id];return !t.projectId&&!t.tagIds.length&&!t.parentId;});
   const deletes=orphaned.flatMap((id:string)=>[id,...(a.task.entities[id].subTaskIds??[])]);
   for(const t of Object.values(a.task.entities) as any[])t.tagIds=t.tagIds.filter((id:string)=>!ids.includes(id));
   remove(deletes);for(const id of ids)delete a.timeTracking.tag[id];
  }
 }else if(type==='[Task Shared] deleteTaskRepeatCfg'){
  for(const a of both)for(const t of Object.values(a.task.entities) as any[])if(t.repeatCfgId===action.taskRepeatCfgId)t.repeatCfgId=undefined;
 }else if(type==='[Task Shared] deleteIssueProvider'||type==='[Task Shared] deleteIssueProviders'){
  const ids=action.ids??[action.issueProviderId];
  for(const a of both)for(const t of Object.values(a.task.entities) as any[])if(ids.includes(t.issueProviderId)){
   for(const key of ['issueId','issueProviderId','issueType','issueWasUpdated','issueLastUpdated','issueAttachmentNr','issueTimeTracked','issuePoints'])t[key]=undefined;
  }
 }
 return {archiveYoung:young,archiveOld:old};
}
