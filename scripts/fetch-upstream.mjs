import {readFile,writeFile,mkdir,mkdtemp,rename,rm,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const pin=JSON.parse(await readFile(new URL('../upstream.json',import.meta.url),'utf8'));
const target=new URL('../vendor-source/',import.meta.url);
try{
 await access(target);
 const marker=await readFile(new URL('.sp-mcp-revision',target),'utf8').catch(()=>'');
 if(marker.trim()===pin.commit){console.log('Pinned upstream source already present');process.exit(0);}
 throw new Error('vendor-source exists without the expected revision marker; move it aside before fetching');
}catch(error){if(error.code!=='ENOENT')throw error;}
const temp=await mkdtemp(join(tmpdir(),'sp-mcp-upstream-'));
try{
 const url='https://codeload.github.com/'+pin.repository+'/tar.gz/'+pin.commit;
 const response=await fetch(url,{signal:AbortSignal.timeout(120000)});
 if(!response.ok)throw new Error('Upstream download failed: '+response.status);
 const archive=Buffer.from(await response.arrayBuffer());
 if(createHash('sha256').update(archive).digest('hex')!==pin.sha256)throw new Error('Upstream archive checksum mismatch');
 const path=join(temp,'source.tar.gz');await writeFile(path,archive);
 // Extract beside the target so the final rename is atomic even across mount points.
 const staging=new URL('../.upstream-staging-'+process.pid+'/',import.meta.url);
 await mkdir(staging);
 try{
  const {fileURLToPath}=await import('node:url');
  const result=spawnSync('tar',['-xzf',path,'--strip-components=1','-C',fileURLToPath(staging)],{stdio:'inherit'});
  if(result.status!==0)throw new Error('tar extraction failed; install tar');
  await writeFile(new URL('.sp-mcp-revision',staging),pin.commit+'\n');
  await rename(staging,target);
 }finally{await rm(staging,{recursive:true,force:true});}
 console.log('Pinned upstream source ready');
}finally{await rm(temp,{recursive:true,force:true});}
