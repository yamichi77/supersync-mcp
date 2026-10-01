import test from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {makeServer} from '../src/tools.js';
import {officialModule} from '../src/projection.js';
import {projectAction} from '../src/write.js';

test('project creation uses official defaults and reducer; duplicate names rejected',async()=>{
 const official=await officialModule();
 const initial=official.reduce(undefined,{type:'@@init'});
 const action=projectAction(official,initial,'日本語 project','new-project');
 const result=official.reduce(initial,{...action,meta:{isRemote:true}});
 assert.equal(result.projects.entities['new-project'].title,'日本語 project');
 assert.deepEqual(result.projects.entities['new-project'].taskIds,[]);
 assert.equal(result.projects.entities['new-project'].isArchived,false);
 assert.ok(official.KNOWN_ACTION_TYPES.has(action.type));
 const {type,...actionPayload}=action;
 const replay=official.convertOpToAction({id:official.uuidv7(),clientId:'test',actionType:type,opType:'CRT',entityType:'PROJECT',entityId:'new-project',payload:{actionPayload,entityChanges:[]},vectorClock:{test:1},timestamp:Date.now(),schemaVersion:4});
 assert.equal(official.reduce(initial,replay).projects.entities['new-project'].title,'日本語 project');
 assert.throws(()=>projectAction(official,result,'日本語 project','other'),/PROJECT_NAME_ALREADY_EXISTS/);
 assert.throws(()=>projectAction(official,result,' ','other'),/WRITE_VALIDATION_FAILED/);
});

test('create_project is write-only and returns projectId, not taskId',async()=>{
 for(const canWrite of [false,true]){
  const calls:any[]=[];
  const writer=(async(args:any)=>{calls.push(args);return {taskId:'project-1',serverSeq:3,requestId:'request',replayed:false};}) as any;
  const server=makeServer((async()=>({state:{},clock:{},serverSeq:0})) as any,canWrite,writer);
  const client=new Client({name:'test',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();
  await server.connect(a);await client.connect(b);
  try{
   const result=await client.callTool({name:'create_project',arguments:{title:'New',requestId:'request',expectedServerSeq:0}});
   assert.equal(Boolean(result.isError),!canWrite);
   assert.equal(calls.length,canWrite?1:0);
   if(canWrite){const content=result.structuredContent as Record<string,unknown>;assert.equal(calls[0].kind,'create_project');assert.equal(content.projectId,'project-1');assert.equal(content.taskId,undefined);}
  }finally{await client.close();await server.close();}
 }
});
