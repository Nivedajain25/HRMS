import { idParam, taskCreateSchema, taskListQuery, taskStatusUpdateSchema } from '@stencil/shared';
import { taskController as t } from '../controllers/task.controller';
import { createModule } from './registry';

export const taskModule = createModule('Tasks', '/api/v1/tasks');
taskModule.route(
  {
    method: 'post',
    path: '/',
    summary: 'Assign a task to one or more employees',
    description:
      'HR / admins (`employee:read`) can assign to anyone; managers to their direct and indirect reports; department heads to anyone in their departments. One task is created per assignee and each is notified.',
    body: taskCreateSchema,
  },
  t.create,
);
taskModule.route({ method: 'get', path: '/', summary: 'List my tasks (`scope=mine`) or tasks I assigned (`scope=assigned`)', query: taskListQuery }, t.list);
// Fixed paths are registered before '/:id'.
taskModule.route({ method: 'get', path: '/assignable', summary: 'Employees the caller can assign tasks to (empty = cannot assign)' }, t.assignable);
taskModule.route({ method: 'get', path: '/unseen', summary: 'New tasks the caller has not opened yet (pop-up)' }, t.unseen);
taskModule.route({ method: 'post', path: '/seen', summary: 'Mark all of my new tasks as seen' }, t.seenAll);
taskModule.route({ method: 'get', path: '/:id', summary: 'Get a task (assignee, assigner or HR)', params: idParam }, t.get);
taskModule.route({ method: 'post', path: '/:id/seen', summary: 'Mark one of my tasks as seen', params: idParam }, t.seen);
taskModule.route(
  {
    method: 'patch',
    path: '/:id/status',
    summary: 'Move a task to To do / In progress / Done',
    description: 'The assignee (or the assigner / HR). The assigner is notified when the assignee starts or finishes it; the assignee when someone else changes it.',
    params: idParam,
    body: taskStatusUpdateSchema,
  },
  t.status,
);
taskModule.route({ method: 'delete', path: '/:id', summary: 'Delete a task (the assigner or HR)', params: idParam }, t.remove);
