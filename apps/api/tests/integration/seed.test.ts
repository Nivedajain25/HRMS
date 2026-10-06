import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  AnnouncementModel,
  AssetModel,
  AttendanceModel,
  CandidateModel,
  DepartmentModel,
  EmployeeModel,
  ExpenseModel,
  HolidayModel,
  JobOpeningModel,
  LeaveBalanceModel,
  LeaveRequestModel,
  OrganizationModel,
  PayslipModel,
  PerformanceCycleModel,
  RoleModel,
  SalaryStructureModel,
  UserModel,
} from '../../src/models';
import { DEMO_PASSWORD, DEMO_SLUG } from '../../src/seed/data';
import { seedDemo } from '../../src/seed/demo';
import { as, getApp } from '../helpers';

describe('Demo seed', () => {
  it('creates a complete demo organization and is re-runnable', async () => {
    const first = await seedDemo();
    const second = await seedDemo();
    expect(await OrganizationModel.countDocuments({ slug: DEMO_SLUG })).toBe(1);
    expect(String(second.organizationId)).not.toBe(String(first.organizationId));
    expect(await EmployeeModel.countDocuments({ organizationId: first.organizationId })).toBe(0);

    const org = second.organizationId;
    const o = await OrganizationModel.findById(org).lean();
    expect(o).toMatchObject({ name: 'Stencil Demo Co.', timezone: 'Asia/Kolkata', currency: 'INR', country: 'India' });
    expect(o!.settings!.payroll!.countryRules).toBe('IN');

    expect(await EmployeeModel.countDocuments({ organizationId: org })).toBe(30);
    expect(await UserModel.countDocuments({ organizationId: org })).toBe(8);
    expect(await RoleModel.countDocuments({ organizationId: org })).toBe(8);
    expect(await DepartmentModel.countDocuments({ organizationId: org, headId: { $ne: null } })).toBe(7);
    expect(await HolidayModel.countDocuments({ organizationId: org })).toBe(7);
    expect(await SalaryStructureModel.countDocuments({ organizationId: org })).toBe(30);
    expect(await AttendanceModel.countDocuments({ organizationId: org })).toBeGreaterThan(400);
    expect(await LeaveBalanceModel.countDocuments({ organizationId: org })).toBeGreaterThan(200);
    expect(await LeaveRequestModel.countDocuments({ organizationId: org, status: 'APPROVED' })).toBeGreaterThanOrEqual(3);
    expect(await LeaveRequestModel.countDocuments({ organizationId: org, status: 'SUBMITTED' })).toBe(3);
    expect(await JobOpeningModel.countDocuments({ organizationId: org, status: 'OPEN' })).toBe(3);
    expect(await JobOpeningModel.countDocuments({ organizationId: org, status: 'CLOSED' })).toBe(1);
    expect(await CandidateModel.countDocuments({ organizationId: org })).toBe(12);
    expect(await PerformanceCycleModel.countDocuments({ organizationId: org, status: 'IN_PROGRESS' })).toBe(1);
    expect(await AssetModel.countDocuments({ organizationId: org, status: 'ASSIGNED' })).toBe(9);
    expect((await ExpenseModel.distinct('status', { organizationId: org })).length).toBeGreaterThanOrEqual(5);
    expect(await AnnouncementModel.countDocuments({ organizationId: org, notifiedAt: { $ne: null } })).toBe(2);
    expect(await PayslipModel.countDocuments({ organizationId: org, status: 'PAID' })).toBeGreaterThan(40);

    // Salary structures are internally consistent.
    for (const s of await SalaryStructureModel.find({ organizationId: org }).lean()) {
      const earnings = s.components.filter((c) => c.type === 'EARNING').reduce((a, c) => a + (c.monthlyAmount ?? 0), 0);
      const deductions = s.components.filter((c) => c.type === 'DEDUCTION' && !c.employerContribution).reduce((a, c) => a + (c.monthlyAmount ?? 0), 0);
      expect(earnings).toBe(s.monthlyGross);
      expect(deductions).toBe(s.monthlyDeductions);
      expect(s.monthlyNet).toBe(s.monthlyGross - s.monthlyDeductions);
    }

    // Pending leave is reserved in the balance ledger.
    const pending = await LeaveRequestModel.find({ organizationId: org, status: 'SUBMITTED' }).lean();
    for (const p of pending) {
      const bal = await LeaveBalanceModel.findOne({ organizationId: org, employeeId: p.employeeId, leaveTypeId: p.leaveTypeId }).lean();
      expect(bal!.pending).toBeGreaterThanOrEqual(p.days);
    }

    // Every demo account can sign in with the documented password.
    expect(second.credentials).toHaveLength(8);
    for (const c of second.credentials) {
      expect(c.password).toBe(DEMO_PASSWORD);
      const res = await request(getApp()).post('/api/v1/auth/login').send({ email: c.email, password: DEMO_PASSWORD });
      expect(res.status, c.email).toBe(200);
      expect(res.body.data.user.emailVerified).toBe(true);
      expect(res.body.data.user.employeeId).toBeTruthy();
    }

    const login = await request(getApp()).post('/api/v1/auth/login').send({ email: 'manager@stencil-demo.test', password: DEMO_PASSWORD });
    const token = login.body.data.accessToken as string;
    expect(login.body.data.user.isManager).toBe(true);
    const dash = await as(token).get('/api/v1/dashboard/manager');
    expect(dash.status).toBe(200);
    expect(dash.body.data.teamSize).toBeGreaterThanOrEqual(8);
  });
});
