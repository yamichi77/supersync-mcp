import test from 'node:test';import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';import {makeServer} from '../src/tools.js';
test('all 12 tools declare and return schema-valid structured results; missing tasks and errors remain valid',async()=>{
 const entity={id:'t',title:'fixture',isDone:false,tagIds:['tag'],dueDay:null,dueWithTime:null,notes:undefined,secret:'hidden'};
 const provider=async()=>({serverSeq:12,clock:{a:12},state:{tasks:{ids:['t'],entities:{t:entity}},projects:{ids:['p'],entities:{p:{id:'p',title:'Project',color:null}}},tag:{ids:['tag'],entities:{tag:{id:'tag',title:'Tag'}}},archiveOld:{task:{entities:{archived:{...entity,id:'archived'}}}}}});
 const writer=(async()=>({taskId:'t',serverSeq:13,requestId:'r',replayed:false})) as any;
 const server=makeServer(provider,true,writer),client=new Client({name:'schema-test',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();
 await server.connect(a);await client.connect(b);
 try{
  const tools=await client.listTools();assert.equal(tools.tools.length,12);
  const args:Record<string,any>={get_task:{id:'t'},create_task:{projectId:'p',title:'New'},update_task:{id:'t',notes:'Updated'},update_task_tags:{id:'t',addTagIds:['tag']},set_task_kanban_status:{id:'t',status:'in_progress'},complete_task:{id:'t'},reopen_task:{id:'t'}};
  for(const tool of tools.tools){
   assert.equal(tool.outputSchema?.type,'object',tool.name);
   const input=tool.annotations?.readOnlyHint?(args[tool.name]??{}):{requestId:'r',expectedServerSeq:12,...args[tool.name]};
   const result=await client.callTool({name:tool.name,arguments:input});
   assert.ok(!result.isError,tool.name+': '+JSON.stringify(result));
   assert.ok(result.structuredContent,tool.name);
   assert.deepEqual(result.structuredContent,JSON.parse((result.content as any[])[0].text));
   assert.ok(!JSON.stringify(result).includes('hidden'));
  }
  const missing=await client.callTool({name:'get_task',arguments:{id:'missing'}});
  assert.equal((missing.structuredContent as any).task,null);
  const error=await client.callTool({name:'update_task',arguments:{id:'t',requestId:'r',expectedServerSeq:12}});
  assert.equal(error.isError,true);assert.match((error.content as any[])[0].text,/WRITE_VALIDATION_FAILED/);
 }finally{await client.close();await server.close();}
});
