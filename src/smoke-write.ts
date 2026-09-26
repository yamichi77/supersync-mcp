import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {writeTask} from './write.js';import {current} from './sync.js';import {writeFileSync} from 'node:fs';
const runId=randomUUID();let p=await current(true);const projectId=p.state.projects.ids.find((id:string)=>!p.state.projects.entities[id].isArchived);assert.ok(projectId);
const created=await writeTask({kind:'create',requestId:runId+'-create',expectedServerSeq:p.serverSeq,projectId,title:'[MCP接続テスト] 作成・更新・タグ・完了の確認',notes:'Codexが作成した接続確認用タスクです。確認後は削除できます。'});
writeFileSync('data/last-smoke-task.json',JSON.stringify({taskId:created.taskId,runId}),{mode:0o600});
const id=created.taskId;p=await current(true);assert.ok(p.state.tasks.entities[id]);console.log(JSON.stringify({step:'create',ok:true,seq:p.serverSeq}));
const update=await writeTask({kind:'update',requestId:runId+'-update',expectedServerSeq:p.serverSeq,id,notes:'書込み・再送・タグ移動の接続確認済み。確認後は削除できます。'});
p=await current(true);assert.match(p.state.tasks.entities[id].notes,/接続確認済み/);console.log(JSON.stringify({step:'update',ok:true,seq:p.serverSeq}));
const tagId=p.state.tag.ids.find((id:string)=>id!=='TODAY');
if(tagId){
 await writeTask({kind:'tags',requestId:runId+'-tag-add',expectedServerSeq:p.serverSeq,id,addTagIds:[tagId],removeTagIds:[]});
 p=await current(true);assert.ok(p.state.tasks.entities[id].tagIds.includes(tagId));assert.ok(p.state.tag.entities[tagId].taskIds.includes(id));
 await writeTask({kind:'tags',requestId:runId+'-tag-remove',expectedServerSeq:p.serverSeq,id,addTagIds:[],removeTagIds:[tagId]});
 p=await current(true);assert.ok(!p.state.tasks.entities[id].tagIds.includes(tagId));console.log(JSON.stringify({step:'tag_add_remove',ok:true,seq:p.serverSeq}));
}
for(const kind of ['complete','reopen'] as const){
 await writeTask({kind,requestId:runId+'-'+kind,expectedServerSeq:p.serverSeq,id});
 p=await current(true);assert.equal(p.state.tasks.entities[id].isDone,kind==='complete');console.log(JSON.stringify({step:kind,ok:true,seq:p.serverSeq}));
}
if(p.state.tag.entities.KANBAN_IN_PROGRESS){
 await writeTask({kind:'kanban',status:'in_progress',requestId:runId+'-kanban-progress',expectedServerSeq:p.serverSeq,id});p=await current(true);
 assert.ok(p.state.tasks.entities[id].tagIds.includes('KANBAN_IN_PROGRESS'));assert.equal(p.state.tasks.entities[id].isDone,false);
 console.log(JSON.stringify({step:'kanban_in_progress',ok:true,seq:p.serverSeq}));
}
const finalInput={kind:'kanban' as const,status:'done' as const,requestId:runId+'-kanban-done',expectedServerSeq:p.serverSeq,id};
await writeTask(finalInput);p=await current(true);assert.equal(p.state.tasks.entities[id].isDone,true);assert.ok(!p.state.tasks.entities[id].tagIds.includes('KANBAN_IN_PROGRESS'));
const repeat=await writeTask(finalInput);assert.equal(repeat.replayed,true);
console.log(JSON.stringify({step:'kanban_done_and_idempotent_retry',ok:true,seq:p.serverSeq}));
