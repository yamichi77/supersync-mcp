import {createServer} from 'node:http';
import {createRemoteJWKSet} from 'jose';
import {makeServer} from './tools.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {authorize} from './auth.js';
import {loadServerConfig} from './config.js';
import {loadAccounts,resolveAccount,type Account} from './accounts.js';
import {createSync} from './sync.js';
import {createWriter} from './write.js';
const settings=loadServerConfig();
const ISSUER=settings.issuer,RESOURCE=settings.resource;
process.umask(0o077);
const accounts=loadAccounts(ISSUER);
const runtimes=new Map<string,{sync:ReturnType<typeof createSync>;writer:ReturnType<typeof createWriter>}>();
function runtime(account:Account){
 let value=runtimes.get(account.identity);
 if(!value){const sync=createSync(account);value={sync,writer:createWriter(account,sync)};runtimes.set(account.identity,value);}return value;
}
const jwks=createRemoteJWKSet(new URL(ISSUER+'/protocol/openid-connect/certs'));
const metadata={resource:RESOURCE,authorization_servers:[ISSUER],bearer_methods_supported:['header'],scopes_supported:['openid'],resource_name:'Super Productivity MCP'};
const metadataPath='/.well-known/oauth-protected-resource/mcp';
const server=createServer(async(req,res)=>{
 const path=(req.url??'').split('?')[0];
 const json=(status:number,data:unknown)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 if(req.method==='GET'&&(path===metadataPath||path==='/.well-known/oauth-protected-resource'))return json(200,metadata);
 if(path==='/healthz')return json(200,{status:'ok'});
 if(path!=='/mcp')return json(404,{error:'not_found'});
 const header=req.headers.authorization;let auth:Awaited<ReturnType<typeof authorize>>;let account:Account;
 try{if(!header?.startsWith('Bearer '))throw new Error('NO_TOKEN');auth=await authorize(header.slice(7),jwks,settings);account=resolveAccount(accounts,auth.issuer,auth.subject);}
 catch(e){if(header?.startsWith('Bearer ')){const err=e as {code?:string;message?:string;claim?:string};const known=['ACCOUNT_NOT_LINKED','ROLE_REQUIRED'];console.warn(JSON.stringify({event:'auth_rejected',reason:known.includes(err.message??'')?err.message:(err.code??'AUTH_FAILED'),claim:['iss','aud','exp','iat','sub'].includes(err.claim??'')?err.claim:undefined}));}if(e instanceof Error&&e.message==='ACCOUNT_NOT_LINKED')return json(403,{error:'account_not_linked'});res.setHeader('WWW-Authenticate','Bearer resource_metadata="'+new URL(metadataPath,RESOURCE).href+'"');return json(401,{error:'unauthorized'});}
 if(req.method!=='POST'){res.setHeader('Allow','POST');return json(405,{error:'method_not_allowed'});}
 if(Number(req.headers['content-length']??0)>65536)return json(413,{error:'request_too_large'});
 const chunks:Buffer[]=[];let size=0;
 try{for await(const chunk of req){size+=chunk.length;if(size>65536){json(413,{error:'request_too_large'});return;}chunks.push(chunk);}}
 catch{return;}
 let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return json(400,{error:'invalid_json'});}
 const selected=runtime(account);const mcp=makeServer(selected.sync.current,auth.canWrite,selected.writer);const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
 res.on('close',()=>{void transport.close();void mcp.close();});
 try{await mcp.connect(transport);await transport.handleRequest(req,res,body);console.info(JSON.stringify({event:'mcp_request',method:['initialize','tools/list','notifications/initialized'].includes(body?.method)?body.method:'other',status:res.statusCode}));}catch{if(!res.headersSent)json(500,{error:'mcp_failed'});}
});
server.requestTimeout=30000;server.headersTimeout=10000;server.listen(settings.port,'0.0.0.0',()=>console.log('MCP listening on 1901 (role-gated writes)'));
