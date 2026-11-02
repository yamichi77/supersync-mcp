import {z} from 'zod';
import {reminderSchema,resolveReminder,type ReminderInput} from './reminders.js';
process.env.TZ='Asia/Tokyo';
export type DateInput=ReminderInput & {dueDay?:string|null;dueWithTime?:number|null;deadlineDay?:string|null;deadlineWithTime?:number|null};
export function validDay(value:string){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&value>='1970-01-01'&&value<='9999-12-31'&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;}
const day=z.string().refine(v=>{try{return validDay(v);}catch{return false;}}).nullable().optional();
const timestamp=z.number().int().min(1).max(253402268399999).nullable().optional();
export const dateSchema={
 ...reminderSchema,
 dueDay:day.describe('予定日 YYYY-MM-DD（日本時間）。dueWithTimeと同時指定不可。nullで予定全体を解除。未指定は保持。'),
 dueWithTime:timestamp.describe('予定日時 Unixミリ秒（絶対時刻、秒や文字列不可）。例: 2026-10-15 09:00 JST = 1792022400000。dueDayと同時指定不可。nullで予定全体を解除。'),
 deadlineDay:day.describe('期限日 YYYY-MM-DD（日本時間）。deadlineWithTimeと同時指定不可。nullで期限全体を解除。未指定は保持。'),
 deadlineWithTime:timestamp.describe('期限日時 Unixミリ秒（絶対時刻）。deadlineDayと同時指定不可。nullで期限全体を解除。'),
};
const schema=z.object(dateSchema);
export function validateDates(input:DateInput){
 if(!schema.safeParse(input).success||(input.dueDay!==undefined&&input.dueWithTime!==undefined)||(input.deadlineDay!==undefined&&input.deadlineWithTime!==undefined))throw new Error('WRITE_VALIDATION_FAILED');
}
export function hasDates(input:DateInput){return Object.keys(dateSchema).some(k=>input[k as keyof DateInput]!==undefined);}
// SP pure reducers read appState for their logical day. Capture it from the
// operation timestamp in the single-account owner's timezone, not host UTC.
export function dateContext(official:any,state:any,now:number){
 const cfg=state.globalConfig?.misc??{};
 const offset=official.getStartOfNextDayDiffMs(cfg.startOfNextDayTime,cfg.startOfNextDay);
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now-offset));
 return {today,offset};
}
export function dateState(official:any,state:any,now:number){
 const {today,offset}=dateContext(official,state,now);
 // getDbDateStr uses local Date components; this adapter runs in JST.
 return {...state,appState:{...state.appState,todayStr:today,startOfNextDayDiffMs:offset}};
}
export function dateActions(input:DateInput,task:any,context:{today:string;offset:number}){
 const actions:any[]=[];
 const scheduleChanged=input.dueDay!==undefined||input.dueWithTime!==undefined;
 const deadlineChanged=input.deadlineDay!==undefined||input.deadlineWithTime!==undefined;
 if(scheduleChanged||input.scheduleReminder!==undefined){
  const time=scheduleChanged?(input.dueWithTime??undefined):task.dueWithTime;
  const remindAt=resolveReminder(input.scheduleReminder,task.dueWithTime,task.remindAt,time,input.dueDay===null||input.dueWithTime===null);
  // The planner action clears old times/reminders itself. For timed schedules,
  // remove a previous planner day first; preserve existing TODAY sections when
  // switching between date-only and timed scheduling within today.
  if(input.dueDay===null||input.dueWithTime===null||(input.dueWithTime!=null&&task.dueDay&&task.dueDay!==context.today))actions.push({type:'[Task Shared] unscheduleTask',id:task.id});
  if(input.dueDay!=null)actions.push({type:'[Planner] Plan Task for Day',task,day:input.dueDay,isAddToTop:false});
  if(!scheduleChanged&&input.scheduleReminder===null)actions.push({type:'[Task Shared] dismissReminderOnly',id:task.id});
  else if(time!=null)actions.push({type:'[Task Shared] scheduleTaskWithTime',task,dueWithTime:time,remindAt,isMoveToBacklog:false});
 }
 if(deadlineChanged||input.deadlineReminder!==undefined){
  const time=deadlineChanged?(input.deadlineWithTime??undefined):task.deadlineWithTime;
  const deadlineRemindAt=resolveReminder(input.deadlineReminder,task.deadlineWithTime,task.deadlineRemindAt,time,input.deadlineDay===null||input.deadlineWithTime===null);
  if(input.deadlineDay===null||input.deadlineWithTime===null)actions.push({type:'[Task Shared] removeDeadline',taskId:task.id});
  else if(!deadlineChanged&&input.deadlineReminder===null)actions.push({type:'[Task Shared] clearDeadlineReminder',taskId:task.id});
  else actions.push({type:'[Task Shared] setDeadline',taskId:task.id,...(input.deadlineDay!==undefined?{deadlineDay:input.deadlineDay}:{deadlineWithTime:time}),deadlineRemindAt,...(deadlineChanged?{autoPlanToday:context.today,autoPlanStartOfNextDayDiffMs:context.offset}:{})});
 }
 return actions;
}
