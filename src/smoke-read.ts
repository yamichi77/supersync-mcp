import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {makeServer} from './tools.js';
const server=makeServer();const client=new Client({name:'read-smoke',version:'1'});
const [a,b]=InMemoryTransport.createLinkedPair();
try{
 await server.connect(a);await client.connect(b);
 for(const name of ['get_sync_status','list_tasks']){
  const result=await client.callTool({name,arguments:{}});
  if(result.isError)throw new Error('TOOL_FAILED');
  const c=result.content as Array<{type:string;text?:string}>;
  const data=JSON.parse(c.find(x=>x.type==='text')!.text!);
  console.log(JSON.stringify({tool:name,ok:true,serverSeq:data.serverSeq,count:data.total??data.activeTasks}));
 }
}catch{console.error('READ_SMOKE_FAILED');process.exitCode=1;}
finally{await client.close();await server.close();}
