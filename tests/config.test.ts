import test,{mock} from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,chmodSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
import {loadServerConfig,loadCredentials} from '../src/config.js';
test('deployment configuration accepts independent HTTPS hosts and rejects missing or unsafe URLs',()=>{
 const env={OIDC_ISSUER:'https://login.example.org/realms/team',MCP_RESOURCE:'https://tasks.example.net/mcp',OIDC_ROLE_CLIENT_ID:'custom-resource'};
 assert.equal(loadServerConfig(env).roleClientId,'custom-resource');
 assert.throws(()=>loadServerConfig({}),/SERVER_CONFIG_INVALID/);
 assert.throws(()=>loadServerConfig({...env,OIDC_ISSUER:'http://login.example.org'}));
 assert.throws(()=>loadServerConfig({...env,MCP_RESOURCE:'https://tasks.example.net/wrong'}));
 assert.throws(()=>loadServerConfig({...env,MCP_RESOURCE:'https://user:pass@tasks.example.net/mcp'}));
 const dir=mkdtempSync(join(tmpdir(),'sp-config-')),path=join(dir,'credentials.json');
 // Windows chmod cannot express POSIX permissions. Simulate only this
 // fixture's stat mode; production permission validation stays unchanged.
 let fixtureMode=0o600;const originalStat=fs.statSync;
 const statMock=process.platform==='win32'?mock.method(fs,'statSync',((...args:any[])=>{
  const value=(originalStat as any)(...args);return args[0]===path?Object.assign(Object.create(Object.getPrototypeOf(value)),value,{mode:fixtureMode}):value;
 }) as typeof fs.statSync):undefined;
 syncBuiltinESMExports();
 try{
  writeFileSync(path,JSON.stringify({baseUrl:'https://other.example.org',accessToken:'fixture',encryptionPassword:'fixture'}),{mode:0o600});
  assert.equal(loadCredentials(path).baseUrl,'https://other.example.org');
  fixtureMode=0o644;chmodSync(path,0o644);assert.throws(()=>loadCredentials(path),/CREDENTIAL_FILE_PERMISSIONS/);
 }finally{statMock?.mock.restore();syncBuiltinESMExports();rmSync(dir,{recursive:true,force:true});}
});
