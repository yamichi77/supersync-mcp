import {build} from 'esbuild';
await build({entryPoints:['src/official-entry.ts'],outfile:'dist/official.mjs',bundle:true,platform:'node',format:'esm',packages:'external',tsconfig:'tsconfig.json',logLevel:'warning',plugins:[{name:'headless-env',setup(b){b.onResolve({filter:/\/core\/log$/},()=>({path:'log',namespace:'headless-log'}));
 b.onLoad({filter:/.*/,namespace:'headless-log'},()=>({contents:'const no=()=>{}; export const Log=new Proxy({}, {get:()=>no}); export const SyncLog=Log,OpLog=Log,PluginLog=Log,IssueLog=Log,DroidLog=Log,TaskLog=Log;',loader:'js'}));
 b.onResolve({filter:/\/util\/dev-error$/},()=>({path:'dev-error',namespace:'headless-error'}));
 b.onLoad({filter:/.*/,namespace:'headless-error'},()=>({contents:"export function devError(){throw new Error('OFFICIAL_REDUCER_REJECTED');}",loader:'js'}));
 b.onResolve({filter:/env\.generated$/},()=>({path:'env',namespace:'headless'}));b.onLoad({filter:/.*/,namespace:'headless'},()=>({contents:'export const ENV = {};',loader:'js'}));}}]});
