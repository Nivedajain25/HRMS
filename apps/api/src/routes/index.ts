import type { Express } from 'express';
import authModule from './auth.routes';
import { organizationModule, roleModule, userModule } from './admin.routes';
import { departmentModule, designationModule, employeeModule, locationModule, onboardingModule } from './people.routes';
import { leaveModule, leaveTypeModule } from './leave.routes';
import { attendanceModule, holidayModule, shiftModule } from './attendance.routes';
import { documentModule, employeePhotoModule, fileModule } from './documents.routes';
import { assetModule } from './assets.routes';
import { expenseModule } from './expenses.routes';
import { offboardingModule } from './offboarding.routes';
import { performanceModule } from './performance.routes';
import { recruitmentModule } from './recruitment.routes';
import { payrollModule, payslipModule, salaryComponentModule, salaryModule } from './payroll.routes';
import { announcementModule, notificationModule } from './communication.routes';
import { auditLogModule, dashboardModule, reportModule, searchModule } from './insights.routes';
import { deviceModule } from './devices.routes';
import { emergencyModule } from './emergency.routes';
import { taskModule } from './task.routes';
import { todoModule } from './todo.routes';
import { salesModule } from './sales.routes';
import { architectMeetingModule, saleEntryModule, salesTargetModule } from './sale-entry.routes';
import { reminderModule } from './reminder.routes';
import { complaintModule } from './complaint.routes';

/** Every feature module, mounted at its base path. */
export const modules = [
  authModule,
  organizationModule,
  roleModule,
  userModule,
  departmentModule,
  designationModule,
  locationModule,
  employeeModule,
  onboardingModule,
  leaveTypeModule,
  leaveModule,
  attendanceModule,
  shiftModule,
  holidayModule,
  fileModule,
  employeePhotoModule,
  documentModule,
  assetModule,
  expenseModule,
  offboardingModule,
  performanceModule,
  recruitmentModule,
  salaryComponentModule,
  salaryModule,
  payrollModule,
  payslipModule,
  announcementModule,
  notificationModule,
  deviceModule,
  emergencyModule,
  taskModule,
  todoModule,
  // Before salesModule so /api/v1/sales/entries, /targets and /architects aren't taken by it.
  saleEntryModule,
  salesTargetModule,
  architectMeetingModule,
  salesModule,
  reminderModule,
  complaintModule,
  auditLogModule,
  searchModule,
  dashboardModule,
  reportModule,
];

export const mountRoutes = (app: Express) => {
  for (const m of modules) app.use(m.basePath, m.router);
};
