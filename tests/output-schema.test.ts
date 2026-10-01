import test from 'node:test';import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';import {makeServer} from '../src/tools.js';
test('all 16 tools declare and return schema-valid structured results; missing tasks and errors remain valid',async()=>{
 const board={id:'b',title:'Board',cols:3,panels:[{id:'column',title:'Work',taskIds:['t'],projectIds:['p'],includedTagIds:[],excludedTagIds:[],taskDoneState:1,scheduledState:1,backlogState:1,isParentTasksOnly:false}]};
 const entity={id:'t',title:'fixture',isDone:false,tagIds:['tag'],dueDay:null,dueWithTime:null,notes:undefined,secret:'hidden'};
 const provider=async()=>({serverSeq:12,clock:{a:12},state:{boards:{boardCfgs:[board]},tasks:{ids:['t'],entities:{t:entity}},projects:{ids:['p'],entities:{p:{id:'p',title:'Project',color:null}}},tag:{ids:['tag'],entities:{tag:{id:'tag',title:'Tag'}}},archiveOld:{task:{entities:{archived:{...entity,id:'archived'}}}}}});
 const writer=(async()=>({taskId:'t',serverSeq:13,requestId:'r',replayed:false})) as any;
 const server=makeServer(provider,true,writer),client=new Client({name:'schema-test',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();
 await server.connect(a);await client.connect(b);
 try{
  const tools=await client.listTools();assert.ok(!tools.tools.some(t=>t.name.startsWith('controller_')||t.name.startsWith('submit_workflow_')||['get_workflow_context','get_workflow_command','get_review_material'].includes(t.name)));assert.equal(tools.tools.length,16);
  const columns=Array.from({length:3},(_,i)=>({title:'column '+i,includedTagIds:['tag']}));
  const args:Record<string,any>={create_project:{title:'New'},get_board:{id:'b'},create_board:{projectId:'p',title:'Board',columns},update_board:{id:'b',columns:[{id:'column',title:'Renamed'}]},get_task:{id:'t'},create_task:{projectId:'p',title:'New'},update_task:{id:'t',notes:'Updated'},update_task_tags:{id:'t',addTagIds:['tag']},set_task_kanban_status:{id:'t',status:'in_progress'},complete_task:{id:'t'},reopen_task:{id:'t'}};
  for(const tool of tools.tools){
   assert.equal(tool.outputSchema?.type,'object',tool.name);
   const input=tool.annotations?.readOnlyHint?(args[tool.name]??{}):{requestId:'r',expectedServerSeq:12,...args[tool.name]};
   const result=await client.callTool({name:tool.name,arguments:input});
   assert.ok(!result.isError,tool.name+': '+JSON.stringify(result));
   assert.ok(result.structuredContent,tool.name);
   assert.deepEqual(result.structuredContent,JSON.parse((result.content as any[])[0].text));
   assert.ok(!JSON.stringify(result).includes('hidden'));
  }
  assert.ok(!tools.tools.some(t=>['create_workflow_board','set_workflow_board_exclusions'].includes(t.name)));
  const missingBoard=await client.callTool({name:'get_board',arguments:{id:'missing'}});
  assert.equal((missingBoard.structuredContent as any).board,null);
  const missing=await client.callTool({name:'get_task',arguments:{id:'missing'}});
  assert.equal((missing.structuredContent as any).task,null);
  const error=await client.callTool({name:'update_task',arguments:{id:'t',requestId:'r',expectedServerSeq:12}});
  assert.equal(error.isError,true);assert.match((error.content as any[])[0].text,/WRITE_VALIDATION_FAILED/);
 }finally{await client.close();await server.close();}
});
