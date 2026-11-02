import {z} from 'zod';

const reminder = z.object({minutesBefore:z.union([z.literal(0),z.literal(5),z.literal(10),z.literal(15),z.literal(30),z.literal(60)])}).strict().nullable().optional();
export const reminderSchema = {
 scheduleReminder:reminder.describe('予定通知。{minutesBefore:0|5|10|15|30|60}。0は同時、nullはNever。未指定は保持し日時変更時は相対再計算。時刻付き予定が必要。'),
 deadlineReminder:reminder.describe('期限通知。{minutesBefore:0|5|10|15|30|60}。0は同時、nullはNever。未指定は保持し日時変更時は相対再計算。時刻付き期限が必要。'),
};
export type ReminderInput = {scheduleReminder?:{minutesBefore:number}|null;deadlineReminder?:{minutesBefore:number}|null};
export const reminderOutput = z.object({minutesBefore:z.number().nullable(),remindAt:z.number()}).nullable();
export function publicReminder(time:unknown,at:unknown){
 return typeof at==='number'?{minutesBefore:typeof time==='number'?(time-at)/60000:null,remindAt:at}:null;
}
// Relative settings are derived from SP's native timestamps, never persisted in a
// second store. This also preserves snoozed/custom offsets set by another client.
export function resolveReminder(input:{minutesBefore:number}|null|undefined,oldTime:number|undefined,oldAt:number|undefined,newTime:number|undefined,removed:boolean){
 if(input===null)return undefined;
 if(input!==undefined){
  if(newTime===undefined)throw new Error('REMINDER_REQUIRES_TIME');
  return checked(newTime-input.minutesBefore*60000);
 }
 if(removed||oldAt==null)return undefined;
 if(newTime===undefined||oldTime===undefined)throw new Error('REMINDER_REQUIRES_TIME');
 return checked(newTime-(oldTime-oldAt));
}
function checked(at:number){
 if(!Number.isSafeInteger(at)||at<=0||at>253402268399999)throw new Error('WRITE_VALIDATION_FAILED');
 return at;
}
