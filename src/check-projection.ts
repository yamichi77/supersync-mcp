import {project} from './projection.js';import {openStore} from './ingest.js';import {loadCredentials} from './config.js';
const db=openStore('data/operations.sqlite');
try{const p=await project(db,loadCredentials().encryptionPassword);console.log(JSON.stringify({projectedSeq:p.serverSeq,activeTasks:p.state.tasks.ids.length,projects:p.state.projects.ids.length,tags:p.state.tag.ids.length}));}
catch(e){console.error(e instanceof Error&&e.message.startsWith('PROJECTION_')?e.message:'PROJECTION_FAILED');process.exitCode=1;}finally{db.close();}
