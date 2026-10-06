import type { TaskCreateInput, WorkTaskStatus } from '@stencil/shared';
import { body, query } from '../middleware/validate';
import * as tasks from '../services/task.service';
import { handle, handleCreated, handlePaged, idOf } from '../utils/controller';

type ListQuery = { scope: 'mine' | 'assigned'; state?: 'open' | 'done'; page: number; limit: number };
type CreateBody = Parameters<typeof tasks.createTasks>[1] & TaskCreateInput;

export const taskController = {
  create: handleCreated((ctx, req) => tasks.createTasks(ctx, body<CreateBody>(req)), 'Task assigned'),
  list: handlePaged((ctx, req) => tasks.listTasks(ctx, query<ListQuery>(req))),
  assignable: handle((ctx) => tasks.listAssignable(ctx)),
  unseen: handle((ctx) => tasks.unseenTasks(ctx)),
  seenAll: handle((ctx) => tasks.markSeen(ctx)),
  seen: handle((ctx, req) => tasks.markSeen(ctx, idOf(req))),
  get: handle((ctx, req) => tasks.getTask(ctx, idOf(req))),
  status: handle((ctx, req) => tasks.updateTaskStatus(ctx, idOf(req), body<{ status: WorkTaskStatus; note?: string }>(req)), 'Task updated'),
  remove: handle((ctx, req) => tasks.deleteTask(ctx, idOf(req)), 'Task deleted'),
};
