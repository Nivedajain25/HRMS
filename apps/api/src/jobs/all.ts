import { registerAttendanceJobs } from '../services/attendance.service';
import { registerDocumentJobs } from '../services/document.service';
import { registerLeaveJobs } from '../services/leave.service';
import { registerJobs } from './index';
import { registerReminderJobs } from './reminders';
// Email and push delivery handlers register themselves on import.
import '../services/email.service';
import '../services/push.service';

let registered = false;

/**
 * Defines every scheduled job and registers all queue handlers. Called by the
 * API server and by the standalone worker so both run the same job set.
 */
export const registerAllJobs = () => {
  if (registered) return;
  registered = true;
  registerAttendanceJobs();
  registerLeaveJobs();
  registerDocumentJobs();
  registerReminderJobs();
  registerJobs();
};
