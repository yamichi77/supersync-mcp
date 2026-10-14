import {existsSync,readFileSync,realpathSync,mkdirSync} from 'node:fs';
import {resolve,dirname,basename,join,relative,isAbsolute} from 'node:path';
import {z} from 'zod';
import {openStore} from './ingest.js';
const accountSchema=z.object({issuer:z.string().url(),subject:z.string().min(1),credentialsPath:z.string().min(1),dataDir:z.string().min(1)}).strict();
export type Account=ReturnType<typeof parseAccounts>[number];
function canonical(path:string):string{
 const full=resolve(path);
 const value=existsSync(full)?realpathSync(full):join(canonical(dirname(full)),basename(full));
 return process.platform==='win32'?value.toLowerCase():value;
}
export function parseAccounts(input:unknown,issuer:string,root=process.cwd()){
 const parsed=z.object({accounts:z.array(accountSchema).min(1)}).strict().safeParse(input);
 if(!parsed.success)throw new Error('ACCOUNTS_CONFIG_INVALID');
 const identities=new Set<string>(),credentials=new Set<string>(),dirs:string[]=[];
 return parsed.data.accounts.map(entry=>{
  if(entry.issuer!==issuer)throw new Error('ACCOUNTS_ISSUER_MISMATCH');
  const identity=JSON.stringify([entry.issuer,entry.subject]);
  const credentialsPath=canonical(resolve(root,entry.credentialsPath));
  const dataDir=canonical(resolve(root,entry.dataDir));
  if(identities.has(identity)||credentials.has(credentialsPath)||dirs.some(dir=>{
   const a=relative(dir,dataDir),b=relative(dataDir,dir);
   return !a||(!a.startsWith('..')&&!isAbsolute(a))||(!b.startsWith('..')&&!isAbsolute(b));
  }))throw new Error('ACCOUNTS_MAPPING_COLLISION');
  identities.add(identity);credentials.add(credentialsPath);dirs.push(dataDir);
  return {...entry,identity,credentialsPath,dataDir,databasePath:join(dataDir,'operations.sqlite')};
 });
}
export function loadAccounts(issuer:string,path=process.env.MCP_ACCOUNTS_FILE??'secrets/accounts.json'){
 return parseAccounts(JSON.parse(readFileSync(path,'utf8')),issuer);
}
export function resolveAccount(accounts:Account[],issuer:string,subject:string){
 const account=accounts.find(entry=>entry.issuer===issuer&&entry.subject===subject);
 if(!account)throw new Error('ACCOUNT_NOT_LINKED');
 return account;
}
export function openAccountStore(account:Account){
 mkdirSync(account.dataDir,{recursive:true,mode:0o700});
 const db=openStore(account.databasePath);
 try{
  db.exec('BEGIN IMMEDIATE');
  const bound=db.prepare("SELECT value FROM metadata WHERE key='accountIdentity'").get()?.value;
  if(bound!==undefined&&bound!==account.identity)throw new Error('ACCOUNT_STORE_IDENTITY_MISMATCH');
  if(bound===undefined)db.prepare("INSERT INTO metadata(key,value) VALUES('accountIdentity',?)").run(account.identity);
  db.exec('COMMIT');return db;
 }catch(e){db.exec('ROLLBACK');db.close();throw e;}
}
