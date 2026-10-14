import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import fs,{mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {encrypt,decrypt} from '@sp/sync-core';
import {parseAccounts,resolveAccount,openAccountStore} from '../src/accounts.js';
import {createSync} from '../src/sync.js';import {createWriter} from '../src/write.js';
const issuer='https://login.example.org/realms/test';
test('identity mapping is exact and rejects shared credential/storage aliases and overlapping directories',()=>{
 const root=mkdtempSync(join(tmpdir(),'sp-accounts-'));
 const entry={issuer,subject:'a',credentialsPath:'secret-a.json',dataDir:'a'};
 const parse=(accounts:unknown[])=>parseAccounts({accounts},issuer,root);
 try{
  const accounts=parse([entry,{...entry,subject:'b',credentialsPath:'secret-b.json',dataDir:'b'}]);
  assert.equal(resolveAccount(accounts,issuer,'a').subject,'a');
  assert.throws(()=>resolveAccount(accounts,issuer,'missing'),/ACCOUNT_NOT_LINKED/);
  assert.throws(()=>resolveAccount(accounts,'https://other.example.org','a'),/ACCOUNT_NOT_LINKED/);
  assert.throws(()=>parse([entry,{...entry}]),/MAPPING_COLLISION/);
  assert.throws(()=>parse([entry,{...entry,subject:'b',dataDir:'b',credentialsPath:'./secret-a.json'}]),/MAPPING_COLLISION/);
  for(const dataDir of ['a','a/nested','.'])assert.throws(()=>parse([entry,{...entry,subject:'b',credentialsPath:'secret-b.json',dataDir}]),/MAPPING_COLLISION/);
  assert.throws(()=>parse([{...entry,issuer:'https://other.example.org'}]),/ISSUER_MISMATCH/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('legacy database binds in place, preserving outbox/device metadata and rejecting reassignment',()=>{
 const root=mkdtempSync(join(tmpdir(),'sp-migration-'));
 const account=parseAccounts({accounts:[{issuer,subject:'owner',credentialsPath:'existing.json',dataDir:'data'}]},issuer,root)[0];
 try{
  let db=openAccountStore(account);
  db.prepare("INSERT INTO metadata VALUES('clientId','legacy-device')").run();db.close();
  db=openAccountStore(account);assert.equal(db.prepare("SELECT value FROM metadata WHERE key='clientId'").get()?.value,'legacy-device');db.close();
  assert.throws(()=>openAccountStore({...account,identity:JSON.stringify([issuer,'other'])}),/IDENTITY_MISMATCH/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('two account caches, refreshes, write targets, request IDs, outboxes and device IDs stay separate',async()=>{
 const root=mkdtempSync(join(tmpdir(),'sp-isolation-'));
 const entries=['a','b'].map(subject=>({issuer,subject,credentialsPath:join(root,subject+'.json'),dataDir:join(root,subject)}));
 const accounts=parseAccounts({accounts:entries},issuer);
 const pages=new Map<string,any>(),downloads:Record<string,number>={a:0,b:0},sent:{subject:string;body:any}[]=[];
 for(const subject of ['a','b']){
  writeFileSync(join(root,subject+'.json'),JSON.stringify({baseUrl:'https://sync.example.org',accessToken:subject,encryptionPassword:'fixture-'+subject}),{mode:0o600});
  let state=JSON.parse(readFileSync('vendor-source/src/app/op-log/validation/test-fixtures/frozen-state-v18.15.json','utf8')).state;
  const originalId=state.task.ids[0];state=JSON.parse(JSON.stringify(state).replaceAll(JSON.stringify(originalId),JSON.stringify(originalId+'-'+subject)));
  state.task.entities[state.task.ids[0]].title='account-'+subject;
  pages.set(subject,{hasMore:false,latestSeq:1,ops:[{serverSeq:1,receivedAt:1750000000000,op:{id:'01985bc0-0000-7000-8000-000000000001',actionType:'[SP_ALL] Load(import) all data',opType:'SYNC_IMPORT',entityType:'ALL',payload:await encrypt(JSON.stringify(state),'fixture-'+subject),isPayloadEncrypted:true,clientId:'fixture',vectorClock:{fixture:1},timestamp:1750000000000,schemaVersion:4}}]});
 }
 const originalStat=fs.statSync;
 const statMock=process.platform==='win32'?mock.method(fs,'statSync',((...args:any[])=>{
  const value=(originalStat as any)(...args);return entries.some(e=>e.credentialsPath.toLowerCase()===String(args[0]).toLowerCase())?Object.assign(Object.create(Object.getPrototypeOf(value)),value,{mode:0o600}):value;
 }) as typeof fs.statSync):undefined;syncBuiltinESMExports();
 const fetchMock=mock.method(globalThis,'fetch',(async(_url:any,init:any)=>{
  const subject=init.headers.Authorization.slice(7);assert.ok(pages.has(subject));
  if(init.method==='POST'){
   const body=JSON.parse(init.body);sent.push({subject,body});
   return new Response(JSON.stringify({latestSeq:2,results:body.ops.map((op:any)=>({opId:op.id,accepted:true,serverSeq:2}))}));
  }
  downloads[subject]++;await new Promise(resolve=>setImmediate(resolve));return new Response(JSON.stringify(pages.get(subject)));
 }) as typeof fetch);
 try{
  const [a,b]=accounts.map(account=>createSync(account));
  const [pa,pb,pa2]=await Promise.all([a.current(),b.current(),a.current()]);
  assert.equal(pa,pa2);assert.equal(downloads.a,1);assert.equal(downloads.b,1);
  assert.equal(pa.state.tasks.entities[pa.state.tasks.ids[0]].title,'account-a');
  assert.equal(pb.state.tasks.entities[pb.state.tasks.ids[0]].title,'account-b');
  a.invalidate();assert.equal(await b.current(),pb);await a.current();assert.equal(downloads.b,1);
  const writers=[createWriter(accounts[0],a),createWriter(accounts[1],b)];
  const requests=[pa,pb].map(p=>({kind:'update' as const,id:p.state.tasks.ids[0],title:'changed',expectedServerSeq:1,requestId:'same-request'}));
  await assert.rejects(writers[0]({...requests[0],id:requests[1].id,requestId:'foreign-task'}),/TASK_NOT_FOUND/);
  const results=await Promise.all(writers.map((writer,i)=>writer(requests[i])));
  assert.equal(results.length,2);assert.deepEqual(sent.map(e=>e.subject).sort(),['a','b']);
  assert.notEqual(sent[0].body.clientId,sent[1].body.clientId);
  for(const account of accounts){
   const db=openAccountStore(account);
   assert.equal(db.prepare('SELECT COUNT(*) AS n FROM outbox').get()?.n,1);
   assert.equal(db.prepare('SELECT status FROM outbox').get()?.status,'accepted');db.close();
   const event=sent.find(e=>e.subject===account.subject)!;
   const payload=JSON.parse(await decrypt(event.body.ops[0].payload,'fixture-'+account.subject));assert.equal(payload.actionPayload.task.id,requests[accounts.indexOf(account)].id);
  }
  assert.equal((await writers[0](requests[0])).replayed,true);assert.equal(sent.length,2);
 }finally{fetchMock.mock.restore();statMock?.mock.restore();syncBuiltinESMExports();rmSync(root,{recursive:true,force:true});}
});
