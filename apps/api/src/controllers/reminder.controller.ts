import { body, query } from '../middleware/validate';
import * as reminders from '../services/reminder.service';
import { handle, handleCreated, idOf } from '../utils/controller';

export const reminderController = {
  list: handle((ctx, req) => reminders.listReminders(ctx, query<{ from: string; to: string }>(req))),
  create: handleCreated((ctx, req) => reminders.createReminder(ctx, body<Parameters<typeof reminders.createReminder>[1]>(req)), 'Reminder added'),
  update: handle((ctx, req) => reminders.updateReminder(ctx, idOf(req), body<Parameters<typeof reminders.updateReminder>[2]>(req)), 'Reminder updated'),
  remove: handle((ctx, req) => reminders.deleteReminder(ctx, idOf(req)), 'Reminder deleted'),
};
