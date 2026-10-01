import test from 'node:test';import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {makeServer} from '../src/tools.js';
test('MCP initialize/list/call exposes only read tools and excludes unrelated configuration',async()=>{
 const provider=async()=>({serverSeq:12,clock:{fixture:12},state:{tasks:{ids:['t'],entities:{t:{id:'t',title:'fixture',notes:'note',unexpectedSecret:'hidden'}}},projects:{ids:['p'],entities:{p:{id:'p',title:'project',apiKey:'hidden'}}},tag:{ids:[],entities:{}}}});
 const server=makeServer(provider);
 const client=new Client({name:'test',version:'1'});
 const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
 try{
  const tools=await client.listTools();assert.equal(tools.tools.length,7);assert.ok(tools.tools.every(t=>t.annotations?.readOnlyHint));
  const result=await client.callTool({name:'list_projects',arguments:{}});
  assert.ok(!JSON.stringify(result).includes('hidden'));
  const task=await client.callTool({name:'get_task',arguments:{id:'t'}});
  assert.ok(JSON.stringify(task).includes('fixture'));assert.ok(!JSON.stringify(task).includes('hidden'));
 }finally{await client.close();await server.close();}
});
