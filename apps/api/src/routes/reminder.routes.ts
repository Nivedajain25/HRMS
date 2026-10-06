import { idParam, reminderListQuery, reminderSchema, reminderUpdateSchema } from '@stencil/shared';
import { reminderController as r } from '../controllers/reminder.controller';
import { createModule } from './registry';

/** Calendar reminders for the super admin (each user only sees their own). */
export const reminderModule = createModule('Reminders', '/api/v1/reminders');
reminderModule.route({ method: 'get', path: '/', summary: 'My reminders between two days', query: reminderListQuery }, r.list);
reminderModule.route(
  {
    method: 'post',
    path: '/',
    summary: 'Mark a day with a reminder',
    description: 'Notified in-app and by push at the time given (organization timezone), or 09:00 for all-day reminders.',
    permissions: ['settings:manage'],
    body: reminderSchema,
  },
  r.create,
);
reminderModule.route({ method: 'patch', path: '/:id', summary: 'Edit a reminder', permissions: ['settings:manage'], params: idParam, body: reminderUpdateSchema }, r.update);
reminderModule.route({ method: 'delete', path: '/:id', summary: 'Delete a reminder', permissions: ['settings:manage'], params: idParam }, r.remove);
