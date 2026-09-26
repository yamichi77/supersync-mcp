// Extracted unchanged from pinned upstream ArchiveCompressionService._compressArchiveData.
import type {ArchiveModel} from '../vendor-source/src/app/features/archive/archive.model';
import type {ArchiveTask,TimeSpentOnDayCopy} from '../vendor-source/src/app/features/tasks/task.model';
export function compressArchive(
    archive: ArchiveModel,
    oneYearAgoTimestamp: number,
  ): ArchiveModel {
    const taskEntities: { [id: string]: ArchiveTask } = {};
    const subtaskIds: string[] = [];

    // Step 1: Copy all tasks and identify subtasks
    for (const id of archive.task.ids) {
      const task = archive.task.entities[id];
      if (!task) continue;

      if (task.parentId) {
        subtaskIds.push(task.id);
      }
      taskEntities[id] = task;
    }

    // Step 2: Merge subtask time to parents and mark for deletion
    for (const subtaskId of subtaskIds) {
      const subtask = taskEntities[subtaskId];
      if (!subtask?.parentId) continue;

      const parent = taskEntities[subtask.parentId];
      if (!parent) continue;

      // Merge timeSpent
      const newTimeSpent = parent.timeSpent + subtask.timeSpent;

      // Merge timeSpentOnDay
      const newTimeSpentOnDay: TimeSpentOnDayCopy = { ...parent.timeSpentOnDay };
      for (const [dateStr, time] of Object.entries(subtask.timeSpentOnDay)) {
        newTimeSpentOnDay[dateStr] = (newTimeSpentOnDay[dateStr] || 0) + time;
      }

      // Update parent with merged time and remove subtask from subTaskIds
      taskEntities[subtask.parentId] = {
        ...parent,
        timeSpent: newTimeSpent,
        timeSpentOnDay: newTimeSpentOnDay,
        subTaskIds: parent.subTaskIds.filter((id) => id !== subtaskId),
      };

      // Delete subtask
      delete taskEntities[subtaskId];
    }

    // Step 3: Clear notes and issue fields from old tasks
    for (const id of Object.keys(taskEntities)) {
      const task = taskEntities[id];
      if (!task || task.parentId) continue; // Skip if deleted or is subtask

      const isOldTask = (task.doneOn || 0) < oneYearAgoTimestamp;
      if (!isOldTask) continue;

      let updatedTask = task;

      // Clear notes
      if (task.notes) {
        updatedTask = { ...updatedTask, notes: undefined };
      }

      // Clear issue fields (keep issueId and issueType for reference)
      if (
        task.issueProviderId ||
        task.issueWasUpdated !== undefined ||
        task.issueLastUpdated !== undefined ||
        task.issueAttachmentNr !== undefined ||
        task.issuePoints !== undefined ||
        task.issueTimeTracked !== undefined
      ) {
        updatedTask = {
          ...updatedTask,
          issueProviderId: undefined,
          issueWasUpdated: undefined,
          issueLastUpdated: undefined,
          issueAttachmentNr: undefined,
          issuePoints: undefined,
          issueTimeTracked: undefined,
        };
      }

      if (updatedTask !== task) {
        taskEntities[id] = updatedTask;
      }
    }

    // Update ids array to remove deleted subtasks
    const newIds = archive.task.ids.filter((id) => !!taskEntities[id]);

    return {
      ...archive,
      task: {
        ids: newIds,
        entities: taskEntities,
      },
    };
  }
