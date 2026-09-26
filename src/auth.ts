import {jwtVerify,type JWTVerifyGetKey} from 'jose';
import type {AuthSettings} from './config.js';
export async function authorize(token:string,key:JWTVerifyGetKey,cfg:AuthSettings,write=false){
 if(!cfg.allowedSubject)throw new Error('SUBJECT_NOT_CONFIGURED');
 const {payload}=await jwtVerify(token,key,{issuer:cfg.issuer,audience:cfg.resource,algorithms:['RS256'],requiredClaims:['sub','exp','iat'],clockTolerance:5});
 if(payload.sub!==cfg.allowedSubject)throw new Error('SUBJECT_NOT_ALLOWED');
 const access=payload.resource_access as Record<string,{roles?:unknown}>|undefined;
 const candidate=access?.[cfg.roleClientId]?.roles;
 const roles=Array.isArray(candidate)?candidate:[];
 if(!roles.includes(cfg.readRole)||(write&&!roles.includes(cfg.writeRole)))throw new Error('ROLE_REQUIRED');
 return {subject:payload.sub,canWrite:roles.includes(cfg.writeRole)};
}
