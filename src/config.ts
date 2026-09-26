import {readFileSync,statSync} from 'node:fs';
import {z} from 'zod';
const httpsUrl=z.string().url().refine(value=>{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash;});
const schema=z.object({baseUrl:httpsUrl,accessToken:z.string().min(1),encryptionPassword:z.string().min(1)}).strict();
export function loadCredentials(path='secrets/supersync.json'){
 if((statSync(path).mode & 0o077)!==0)throw new Error('CREDENTIAL_FILE_PERMISSIONS');
 const parsed=schema.safeParse(JSON.parse(readFileSync(path,'utf8')));
 if(!parsed.success)throw new Error('CREDENTIALS_NOT_CONFIGURED');
 return parsed.data;
}
const serverSchema=z.object({
 issuer:httpsUrl,resource:httpsUrl,
 roleClientId:z.string().min(1),readRole:z.string().min(1),writeRole:z.string().min(1),
 port:z.coerce.number().int().min(1).max(65535)
});
export function loadServerConfig(env:NodeJS.ProcessEnv=process.env){
 const parsed=serverSchema.safeParse({
  issuer:env.OIDC_ISSUER,resource:env.MCP_RESOURCE,
  roleClientId:env.OIDC_ROLE_CLIENT_ID??'sp-mcp',
  readRole:env.OIDC_READ_ROLE??'mcp.read',writeRole:env.OIDC_WRITE_ROLE??'mcp.write',
  port:env.PORT??1901
 });
 if(!parsed.success)throw new Error('SERVER_CONFIG_INVALID');
 // This server exposes an exact /mcp endpoint.
 if(new URL(parsed.data.resource).pathname!=='/mcp')throw new Error('SERVER_CONFIG_INVALID');
 return parsed.data;
}
export type AuthSettings=Pick<ReturnType<typeof loadServerConfig>,'issuer'|'resource'|'roleClientId'|'readRole'|'writeRole'>&{allowedSubject:string};
