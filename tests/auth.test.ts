import test from 'node:test';import assert from 'node:assert/strict';
import {generateKeyPair,SignJWT} from 'jose';import {authorize} from '../src/auth.js';
const ISSUER='https://auth.example.com/realms/test',RESOURCE='https://sync.example.com/mcp';
const cfg={issuer:ISSUER,resource:RESOURCE,roleClientId:'sp-mcp',readRole:'mcp.read',writeRole:'mcp.write',allowedSubject:'owner'};
test('Keycloak issuer, audience, identity, expiry and roles are enforced',async()=>{
 const {privateKey,publicKey}=await generateKeyPair('RS256');
 const key=async()=>publicKey;
 async function token(options:{aud?:string;sub?:string;issuer?:string;roles?:string[];expiry?:string}={}){
  return new SignJWT({resource_access:{'sp-mcp':{roles:options.roles??['mcp.read']}}}).setProtectedHeader({alg:'RS256'}).setIssuer(options.issuer??ISSUER).setAudience(options.aud??RESOURCE).setSubject(options.sub??'owner').setIssuedAt().setExpirationTime(options.expiry??'5m').sign(privateKey);
 }
 assert.deepEqual(await authorize(await token(),key,cfg),{subject:'owner',canWrite:false});
 await assert.rejects(authorize(await token({aud:'account'}),key,cfg));
 await assert.rejects(authorize(await token({issuer:'https://untrusted.example'}),key,cfg));
 await assert.rejects(authorize(await token({sub:'other'}),key,cfg),/SUBJECT_NOT_ALLOWED/);
 await assert.rejects(authorize(await token({roles:[]}),key,cfg));
 await assert.rejects(authorize(await token({expiry:'-10m'}),key,cfg));
 await assert.rejects(authorize(await token(),key,cfg,true));
 assert.equal((await authorize(await token({roles:['mcp.read','mcp.write']}),key,cfg,true)).canWrite,true);
});
