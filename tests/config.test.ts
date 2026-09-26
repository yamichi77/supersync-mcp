import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,chmodSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {loadServerConfig,loadCredentials} from '../src/config.js';
test('deployment configuration accepts independent HTTPS hosts and rejects missing or unsafe URLs',()=>{
 const env={OIDC_ISSUER:'https://login.example.org/realms/team',MCP_RESOURCE:'https://tasks.example.net/mcp',OIDC_ROLE_CLIENT_ID:'custom-resource'};
 assert.equal(loadServerConfig(env).roleClientId,'custom-resource');
 assert.throws(()=>loadServerConfig({}),/SERVER_CONFIG_INVALID/);
 assert.throws(()=>loadServerConfig({...env,OIDC_ISSUER:'http://login.example.org'}));
 assert.throws(()=>loadServerConfig({...env,MCP_RESOURCE:'https://tasks.example.net/wrong'}));
 assert.throws(()=>loadServerConfig({...env,MCP_RESOURCE:'https://user:pass@tasks.example.net/mcp'}));
 const dir=mkdtempSync(join(tmpdir(),'sp-config-')),path=join(dir,'credentials.json');
 try{
  writeFileSync(path,JSON.stringify({baseUrl:'https://other.example.org',accessToken:'fixture',encryptionPassword:'fixture'}),{mode:0o600});
  assert.equal(loadCredentials(path).baseUrl,'https://other.example.org');
  chmodSync(path,0o644);assert.throws(()=>loadCredentials(path),/CREDENTIAL_FILE_PERMISSIONS/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
