import '@angular/compiler';
import { boardsReducer } from '../vendor-source/src/app/features/boards/store/boards.reducer';
import { taskRepeatCfgReducer } from '../vendor-source/src/app/features/task-repeat-cfg/store/task-repeat-cfg.reducer';
import { sectionReducer } from '../vendor-source/src/app/features/section/store/section.reducer';
import { timeTrackingReducer } from '../vendor-source/src/app/features/time-tracking/store/time-tracking.reducer';
import { plannerReducer } from '../vendor-source/src/app/features/planner/store/planner.reducer';

import { taskReducer } from '../vendor-source/src/app/features/tasks/store/task.reducer';
import { projectReducer } from '../vendor-source/src/app/features/project/store/project.reducer';
import { tagReducer } from '../vendor-source/src/app/features/tag/store/tag.reducer';
import { globalConfigReducer } from '../vendor-source/src/app/features/config/store/global-config.reducer';
function baseReduce(state:any,action:any){ return {...state,appState:appStateReducer(state?.appState,action),pluginMetadata:pluginMetadataReducer(state?.pluginMetadata,action),pluginUserData:pluginUserDataReducer(state?.pluginUserData,action),issueProvider:issueProviderReducer(state?.issueProvider,action),menuTree:menuTreeReducer(state?.menuTree,action),simpleCounter:simpleCounterReducer(state?.simpleCounter,action),metric:metricReducer(state?.metric,action),note:noteReducer(state?.note,action),boards:boardsReducer(state?.boards,action),taskRepeatCfg:taskRepeatCfgReducer(state?.taskRepeatCfg,action),section:sectionReducer(state?.section,action),timeTracking:timeTrackingReducer(state?.timeTracking,action),planner:plannerReducer(state?.planner,action),tasks:taskReducer(state?.tasks,action),projects:projectReducer(state?.projects,action),tag:tagReducer(state?.tag,action),globalConfig:globalConfigReducer(state?.globalConfig,action)};}
import { sectionSharedMetaReducer } from '../vendor-source/src/app/root-store/meta/task-shared-meta-reducers/section-shared.reducer';
import { taskSharedCrudMetaReducer } from '../vendor-source/src/app/root-store/meta/task-shared-meta-reducers/task-shared-crud.reducer';
import { taskBatchUpdateMetaReducer } from '../vendor-source/src/app/root-store/meta/task-shared-meta-reducers/task-batch-update.reducer';
import { taskSharedLifecycleMetaReducer } from '../vendor-source/src/app/root-store/meta/task-shared-meta-reducers/task-shared-lifecycle.reducer';
import { taskSharedSchedulingMetaReducer } from '../vendor-source/src/app/root-store/meta/task-shared-meta-reducers/task-shared-scheduling.reducer';
import { taskSharedDeadlineMetaReducer } from '../vendor-source/src/app/root-store/meta/task-shared-meta-reducers/task-shared-deadline.reducer';
import { projectSharedMetaReducer } from '../vendor-source/src/app/root-store/meta/task-shared-meta-reducers/project-shared.reducer';
import { tagSharedMetaReducer } from '../vendor-source/src/app/root-store/meta/task-shared-meta-reducers/tag-shared.reducer';
import { issueProviderSharedMetaReducer } from '../vendor-source/src/app/root-store/meta/task-shared-meta-reducers/issue-provider-shared.reducer';
import { taskRepeatCfgSharedMetaReducer } from '../vendor-source/src/app/root-store/meta/task-shared-meta-reducers/task-repeat-cfg-shared.reducer';
import { plannerSharedMetaReducer } from '../vendor-source/src/app/root-store/meta/task-shared-meta-reducers/planner-shared.reducer';
import { shortSyntaxSharedMetaReducer } from '../vendor-source/src/app/root-store/meta/task-shared-meta-reducers/short-syntax-shared.reducer';
export const reduce = [sectionSharedMetaReducer,taskSharedCrudMetaReducer,taskBatchUpdateMetaReducer,taskSharedLifecycleMetaReducer,taskSharedSchedulingMetaReducer,taskSharedDeadlineMetaReducer,projectSharedMetaReducer,tagSharedMetaReducer,issueProviderSharedMetaReducer,taskRepeatCfgSharedMetaReducer,plannerSharedMetaReducer,shortSyntaxSharedMetaReducer,lwwUpdateMetaReducer].reduceRight((next,meta)=>meta(next),baseReduce);
import { lwwUpdateMetaReducer } from '../vendor-source/src/app/root-store/meta/task-shared-meta-reducers/lww-update.meta-reducer';
export {convertOpToAction} from '../vendor-source/src/app/op-log/apply/operation-converter.util';
export {DEFAULT_TASK} from '../vendor-source/src/app/features/tasks/task.model';
export {KNOWN_ACTION_TYPES} from '../vendor-source/src/app/op-log/core/action-types.enum';
export {sortTimeTrackingAndTasksFromArchiveYoungToOld} from '../vendor-source/src/app/features/archive/util/sort-data-to-flush';

import {noteReducer} from '../vendor-source/src/app/features/note/store/note.reducer';
import {metricReducer} from '../vendor-source/src/app/features/metric/store/metric.reducer';
import {simpleCounterReducer} from '../vendor-source/src/app/features/simple-counter/store/simple-counter.reducer';
import {menuTreeReducer} from '../vendor-source/src/app/features/menu-tree/store/menu-tree.reducer';
import {issueProviderReducer} from '../vendor-source/src/app/features/issue/store/issue-provider.reducer';
import {pluginUserDataReducer} from '../vendor-source/src/app/plugins/store/plugin-user-data.reducer';
import {pluginMetadataReducer} from '../vendor-source/src/app/plugins/store/plugin-metadata.reducer';
import {appStateReducer} from '../vendor-source/src/app/root-store/app-state/app-state.reducer';
export {isLwwUpdateActionType} from '../vendor-source/src/app/op-log/core/lww-update-action-types';

export {compressArchive} from './official-archive';

export {uuidv7} from '../vendor-source/src/app/util/uuid-v7';
