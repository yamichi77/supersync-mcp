import {mkdirSync,chmodSync} from 'node:fs';
import {loadCredentials} from './config.js';
import {openStore,validatePage,storePage,readLimitedJson} from './ingest.js';
process.umask(0o077);
async function main(){
 const cfg=loadCredentials();
 mkdirSync('data',{recursive:true,mode:0o700});
 const db=openStore('data/operations.sqlite');chmodSync('data/operations.sqlite',0o600);
 try{
  const saved=db.prepare("SELECT value FROM metadata WHERE key='downloadCursor'").get();
  let cursor=Number(saved?.value??0);
  let total=0;const actions:Record<string,number>={};
  for(let n=0;n<100;n++){
   const url=new URL('/api/sync/ops',cfg.baseUrl);
   url.searchParams.set('sinceSeq',String(cursor));url.searchParams.set('limit','100');
   const res=await fetch(url,{headers:{Authorization:'Bearer '+cfg.accessToken},redirect:'error',signal:AbortSignal.timeout(30000)});
   if(!res.ok)throw new Error('SUPERSYNC_HTTP_'+res.status);
   const {page,decoded}=await validatePage(await readLimitedJson(res),cfg.encryptionPassword);
   storePage(db,page);
   for(const item of decoded){actions[item.op.actionType]=(actions[item.op.actionType]??0)+1;}
   total+=decoded.length;
   console.log(JSON.stringify({downloaded:total,latestSeq:page.latestSeq,gapDetected:page.gapDetected??false,hasMore:page.hasMore}));
   if(!page.hasMore){console.log(JSON.stringify({status:'download-and-decryption-verified',projectionReady:false,actionCounts:actions}));return;}
   const next=page.ops.at(-1)?.serverSeq;
   if(next===undefined||next<=cursor)throw new Error('DOWNLOAD_NO_PROGRESS');
   cursor=next;
  }
  throw new Error('DOWNLOAD_PAGE_LIMIT');
 }finally{db.close();}
}
main().catch(e=>{const allowed=/^(CREDENTIAL|SUPERSYNC_HTTP_|INVALID_|UNSUPPORTED_|UNEXPECTED_|DECRYPTION_|SEQUENCE_|DOWNLOAD_|RESPONSE_|EMPTY_)/;console.error(allowed.test(e.message)?e.message:'PROBE_FAILED');process.exitCode=1;});
