import mongoose, { Types } from 'mongoose';
import { SYSTEM_ROLE_KEYS, type SystemRoleKey } from '@stencil/shared';
import {
  ActionTokenModel,
  AnnouncementModel,
  AssetAssignmentModel,
  AssetModel,
  AttendanceModel,
  CandidateModel,
  CounterModel,
  DepartmentModel,
  DesignationModel,
  EmployeeModel,
  ExpenseModel,
  GoalModel,
  HolidayModel,
  InterviewModel,
  JobOpeningModel,
  LeaveBalanceModel,
  LeaveRequestModel,
  LeaveTypeModel,
  LocationModel,
  OnboardingModel,
  OnboardingTemplateModel,
  OrganizationModel,
  PayrollModel,
  PayslipModel,
  PerformanceCycleModel,
  PerformanceReviewModel,
  SalaryComponentModel,
  SalaryHistoryModel,
  SalaryStructureModel,
  ShiftAssignmentModel,
  ShiftModel,
  UserModel,
} from '../models';
import { publishAnnouncement } from '../services/announcement.service';
import { audit } from '../services/audit.service';
import { hashPassword } from '../services/auth.service';
import { buildWorkCalendar } from '../services/calendar.service';
import { ensureLeaveBalances } from '../services/leave-balance.service';
import { provisionDefaults, provisionRoles, syncPermissionCatalog } from '../services/organization-setup.service';
import { addDaysKey, dateOnly, monthRange, timeInTz, todayKey, zonedInstant } from '../utils/dates';
import { sanitizeHtml } from '../utils/sanitize-html';
import {
  DEMO_DOMAIN,
  DEMO_PASSWORD,
  DEMO_SLUG,
  DEPARTMENT_HEADS,
  DEPARTMENTS,
  DESIGNATIONS,
  GROSS_BY_LEVEL,
  HOLIDAYS,
  LOCATIONS,
  PEOPLE,
  type DeptCode,
  type LocationKey,
  type PersonSeed,
} from './data';

const TZ = 'Asia/Kolkata';
const CURRENCY = 'INR';

/** Deterministic PRNG so every seed run produces the same shape of data. */
const mulberry32 = (seed: number) => () => {
  let t = (seed += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (minutes: number) => `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;

export interface DemoCredential {
  role: string;
  email: string;
  password: string;
  name: string;
}

export interface SeedResult {
  organizationId: Types.ObjectId;
  credentials: DemoCredential[];
  counts: Record<string, number>;
}

/* -------------------------------- Wipe -------------------------------- */

/** Removes the demo organization and everything it owns (only the `stencil-demo` org). */
export const wipeDemo = async () => {
  const org = await OrganizationModel.findOne({ slug: DEMO_SLUG }).select('_id').lean();
  if (!org) return false;
  const users = await UserModel.find({ organizationId: org._id }).select('_id').lean();
  await ActionTokenModel.deleteMany({ userId: { $in: users.map((u) => u._id) } });
  for (const name of mongoose.modelNames()) {
    const model = mongoose.model(name);
    if (!model.schema.path('organizationId')) continue;
    // Raw collection op: bypasses model middleware (the audit log is immutable through Mongoose).
    await model.collection.deleteMany({ organizationId: org._id });
  }
  await OrganizationModel.collection.deleteOne({ _id: org._id });
  return true;
};

/* -------------------------------- Seed -------------------------------- */

export const seedDemo = async (): Promise<SeedResult> => {
  await syncPermissionCatalog();
  await wipeDemo();

  const demoEmails = PEOPLE.filter((p) => p.login).map((p) => `${p.login!.local}@${DEMO_DOMAIN}`);
  const clash = await UserModel.findOne({ email: { $in: demoEmails } }).select('email').lean();
  if (clash) throw new Error(`Demo account ${clash.email} already exists in another organization; remove it first.`);

  const rng = mulberry32(20240601);
  const pick = <T>(arr: readonly T[]) => arr[Math.floor(rng() * arr.length)]!;
  const today = todayKey(TZ);
  const year = Number(today.slice(0, 4));
  const now = new Date();

  /* Organization, roles, defaults */
  const org = await OrganizationModel.create({
    name: 'Stencil Demo Co.',
    slug: DEMO_SLUG,
    legalName: 'Stencil Demo Company Private Limited',
    email: `hello@${DEMO_DOMAIN}`,
    phone: '+91 80 0000 0000',
    website: 'https://stencil-demo.test',
    address: '1 Demo Tech Park, Outer Ring Road',
    city: 'Bengaluru',
    state: 'Karnataka',
    country: 'India',
    postalCode: '560001',
    timezone: TZ,
    currency: CURRENCY,
    employeeIdPrefix: 'EMP',
  });
  const orgId = org._id;
  const roles = await provisionRoles(orgId);
  const { countryRules } = await provisionDefaults(orgId, 'India');
  org.settings!.payroll!.countryRules = countryRules;
  await org.save();

  const generalShift = await ShiftModel.findOne({ organizationId: orgId, isDefault: true }).lean();
  const [nightShift] = await ShiftModel.create([
    {
      organizationId: orgId,
      name: 'Night Shift',
      code: 'NIGHT',
      startTime: '21:00',
      endTime: '06:00',
      gracePeriodMinutes: 15,
      breakDurationMinutes: 60,
      workingHours: 8,
      halfDayHours: 4,
      nightShift: true,
      color: '#0f172a',
    },
  ]);

  /* Structure */
  const locations = new Map<LocationKey, Types.ObjectId>();
  for (const l of LOCATIONS) {
    const doc = await LocationModel.create({ organizationId: orgId, name: l.name, type: l.type, city: l.city, state: l.state, country: 'India', timezone: TZ });
    locations.set(l.key, doc._id);
  }
  const departments = new Map<DeptCode, Types.ObjectId>();
  for (const d of DEPARTMENTS) {
    const doc = await DepartmentModel.create({ organizationId: orgId, name: d.name, code: d.code, description: d.description });
    departments.set(d.code, doc._id);
  }
  const designations = new Map<string, { id: Types.ObjectId; level: number; name: string }>();
  for (const d of DESIGNATIONS) {
    const doc = await DesignationModel.create({ organizationId: orgId, name: d.name, code: d.code, level: d.level, departmentId: departments.get(d.dept) });
    designations.set(d.code, { id: doc._id, level: d.level, name: d.name });
  }

  const holidayDocs = HOLIDAYS.map((h) => ({ organizationId: orgId, name: h.name, date: dateOnly(`${year}-${h.md}`), type: h.type, recurring: false }));
  await HolidayModel.insertMany(holidayDocs);

  /* Employees */
  const employees = new Map<string, { _id: Types.ObjectId; person: PersonSeed; code: string; joining: string; userId: Types.ObjectId | null; gross: number }>();
  let seq = 0;
  for (const p of PEOPLE) {
    seq++;
    const code = `EMP${String(seq).padStart(4, '0')}`;
    const joining = addDaysKey(today, -p.joinedDaysAgo);
    const birthYear = 1984 + (seq % 14);
    let dobMd: string;
    if (p.birthdayInDays !== undefined) dobMd = addDaysKey(today, p.birthdayInDays).slice(5);
    else dobMd = `${pad(1 + Math.floor(rng() * 12))}-${pad(1 + Math.floor(rng() * 28))}`;
    const email = p.login ? `${p.login.local}@${DEMO_DOMAIN}` : `${p.firstName}.${p.lastName}`.toLowerCase() + `@${DEMO_DOMAIN}`;
    const level = designations.get(p.designation)!.level;
    const gross = (GROSS_BY_LEVEL[level] ?? 70000) + (seq % 5) * 2500;
    const doc = await EmployeeModel.create({
      organizationId: orgId,
      employeeId: code,
      firstName: p.firstName,
      lastName: p.lastName,
      gender: p.gender,
      dateOfBirth: dateOnly(`${birthYear}-${dobMd}`),
      bloodGroup: pick(['A+', 'B+', 'O+', 'AB+', 'O-'] as const),
      maritalStatus: pick(['Single', 'Married']),
      workEmail: email,
      personalEmail: `${p.firstName}.${p.lastName}.personal@${DEMO_DOMAIN}`.toLowerCase(),
      phone: `+91 90000 ${String(10000 + seq * 37).slice(-5)}`,
      city: p.location === 'MUM' ? 'Mumbai' : 'Bengaluru',
      country: 'India',
      joiningDate: dateOnly(joining),
      confirmationDate: p.status === 'PROBATION' ? null : dateOnly(addDaysKey(joining, 90)),
      departmentId: departments.get(p.dept),
      designationId: designations.get(p.designation)!.id,
      locationId: locations.get(p.location),
      shiftId: p.nightShift ? nightShift!._id : generalShift!._id,
      employmentType: p.employmentType ?? 'FULL_TIME',
      employmentStatus: p.status ?? 'ACTIVE',
      emergencyContact: { contactName: 'Demo Contact', relationship: 'Family', phone: '+91 90000 00000' },
    });
    employees.set(p.key, { _id: doc._id, person: p, code, joining, userId: null, gross });
  }
  for (const e of employees.values()) {
    const managerKey = e.person.manager;
    if (managerKey) await EmployeeModel.updateOne({ _id: e._id }, { managerId: employees.get(managerKey)!._id });
  }
  for (const [dept, key] of Object.entries(DEPARTMENT_HEADS)) {
    await DepartmentModel.updateOne({ _id: departments.get(dept as DeptCode) }, { headId: employees.get(key)!._id });
  }
  await OrganizationModel.updateOne({ _id: orgId }, { employeeSequence: seq });
  await ShiftAssignmentModel.insertMany(
    [...employees.values()].map((e) => ({
      organizationId: orgId,
      employeeId: e._id,
      shiftId: e.person.nightShift ? nightShift!._id : generalShift!._id,
      effectiveFrom: dateOnly(e.joining),
    })),
  );

  /* Demo user accounts */
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const credentials: DemoCredential[] = [];
  for (const e of employees.values()) {
    const login = e.person.login;
    if (!login) continue;
    const roleKeys: SystemRoleKey[] = login.role === 'super_admin' ? ['super_admin'] : login.role === 'employee' ? ['employee'] : ['employee', login.role];
    const user = await UserModel.create({
      organizationId: orgId,
      employeeId: e._id,
      email: `${login.local}@${DEMO_DOMAIN}`,
      passwordHash,
      firstName: e.person.firstName,
      lastName: e.person.lastName,
      roles: roleKeys.map((k) => roles[k]._id),
      status: 'ACTIVE',
      emailVerified: true,
      passwordChangedAt: now,
    });
    e.userId = user._id;
    await EmployeeModel.updateOne({ _id: e._id }, { userId: user._id });
    credentials.push({ role: login.label, email: user.email, password: DEMO_PASSWORD, name: `${e.person.firstName} ${e.person.lastName}` });
  }
  const userOf = (key: string) => employees.get(key)!.userId;
  const E = (key: string) => employees.get(key)!;
  const superAdmin = E('ceo');
  const hrUser = E('hr');
  const actorCtx = (key: string) => ({
    organizationId: orgId,
    userId: E(key).userId ?? superAdmin.userId!,
    userName: `${E(key).person.firstName} ${E(key).person.lastName}`,
    ipAddress: '127.0.0.1',
    userAgent: 'stencil-seed',
  });

  /* Salary structures (simple inline math; payroll engine is separate) */
  const components = await SalaryComponentModel.find({ organizationId: orgId }).lean();
  const comp = (codeKey: string) => components.find((c) => c.code === codeKey)!;
  const structures = new Map<string, { id: Types.ObjectId; gross: number; basic: number; hra: number; special: number; pf: number; pfEr: number; pt: number; esi: number; deductions: number; net: number }>();
  for (const e of employees.values()) {
    const G = e.gross;
    const basic = Math.round(G * 0.5);
    const hra = Math.round(basic * 0.4);
    const transport = 1600;
    const medical = 1250;
    const special = G - basic - hra - transport - medical;
    const pf = Math.round(Math.min(basic, 15000) * 0.12);
    const pfEr = pf;
    const esi = G <= 21000 ? Math.ceil(G * 0.0075) : 0;
    const pt = G >= 20000 ? 200 : G >= 15000 ? 150 : 0;
    const deductions = pf + esi + pt;
    const net = G - deductions;
    const line = (codeKey: string, monthlyAmount: number, value: number) => {
      const c = comp(codeKey);
      return { componentId: c._id, code: c.code, name: c.name, type: c.type, calculationType: c.calculationType, value, monthlyAmount, employerContribution: c.employerContribution };
    };
    const lines = [
      line('BASIC', basic, basic),
      line('HRA', hra, 40),
      line('TRANSPORT', transport, transport),
      line('MEDICAL', medical, medical),
      line('SPECIAL', special, special),
      line('PF', pf, 12),
      line('PF_ER', pfEr, 12),
      ...(esi ? [line('ESI', esi, 0.75)] : []),
      line('PT', pt, pt),
    ];
    const s = await SalaryStructureModel.create({
      organizationId: orgId,
      employeeId: e._id,
      effectiveFrom: dateOnly(e.joining),
      currency: CURRENCY,
      basic,
      components: lines,
      monthlyGross: G,
      monthlyDeductions: deductions,
      monthlyEmployerContributions: pfEr,
      monthlyNet: net,
      annualCtc: (G + pfEr) * 12,
      reason: 'Initial salary structure',
      createdBy: superAdmin.userId,
    });
    await SalaryHistoryModel.create({
      organizationId: orgId,
      employeeId: e._id,
      structureId: s._id,
      effectiveFrom: dateOnly(e.joining),
      newCtc: (G + pfEr) * 12,
      newGross: G,
      reason: 'Initial salary structure',
      changedBy: superAdmin.userId,
    });
    structures.set(String(e._id), { id: s._id, gross: G, basic, hra, special, pf, pfEr, pt, esi, deductions, net });
  }

  /* Leave balances */
  const allEmployees = await EmployeeModel.find({ organizationId: orgId }).lean();
  for (const emp of allEmployees) await ensureLeaveBalances(orgId, emp, year);
  const leaveTypes = await LeaveTypeModel.find({ organizationId: orgId }).lean();
  const lt = (c: string) => leaveTypes.find((t) => t.code === c)!;

  /* Working days (last 20 before today) */
  const calendar = await buildWorkCalendar(orgId, addDaysKey(today, -60), addDaysKey(today, 30));
  const pastDays: string[] = [];
  for (let d = addDaysKey(today, -1); pastDays.length < 20; d = addDaysKey(d, -1)) if (calendar.kindOf(d) === 'WORKING') pastDays.unshift(d);
  const futureDays: string[] = [];
  for (let d = addDaysKey(today, 1); futureDays.length < 15; d = addDaysKey(d, 1)) if (calendar.kindOf(d) === 'WORKING') futureDays.push(d);
  const todayIsWorking = calendar.kindOf(today) === 'WORKING';

  /* Leave requests (balances kept consistent) */
  interface LeaveSeed {
    who: string;
    type: string;
    from: string;
    to: string;
    status: 'APPROVED' | 'SUBMITTED' | 'REJECTED' | 'CANCELLED';
    halfDay?: boolean;
    reason: string;
  }
  const leaveSeeds: LeaveSeed[] = [
    { who: 'employee', type: 'CL', from: pastDays[5]!, to: pastDays[6]!, status: 'APPROVED', reason: 'Family function' },
    { who: 'employee', type: 'EL', from: futureDays[6]!, to: futureDays[8]!, status: 'SUBMITTED', reason: 'Short vacation' },
    { who: 'karan', type: 'SL', from: pastDays[12]!, to: pastDays[12]!, status: 'APPROVED', reason: 'Fever' },
    { who: 'sneha', type: 'CL', from: futureDays[2]!, to: futureDays[2]!, status: 'REJECTED', reason: 'Personal errand' },
    { who: 'riya', type: 'CL', from: futureDays[3]!, to: futureDays[3]!, status: 'SUBMITTED', reason: 'Bank work' },
    { who: 'nisha', type: 'EL', from: futureDays[4]!, to: futureDays[6]!, status: 'APPROVED', reason: 'Travel' },
    { who: 'aditya', type: 'SL', from: futureDays[0]!, to: futureDays[0]!, status: 'SUBMITTED', halfDay: true, reason: 'Doctor appointment' },
    { who: 'lakshmi', type: 'CL', from: pastDays[15]!, to: pastDays[15]!, status: 'CANCELLED', reason: 'Plans changed' },
    { who: 'tanvi', type: 'EL', from: pastDays[2]!, to: pastDays[4]!, status: 'APPROVED', reason: 'Wedding in the family' },
    ...(todayIsWorking ? [{ who: 'diya', type: 'CL', from: today, to: today, status: 'APPROVED' as const, reason: 'Personal day' }] : []),
  ];
  const onLeave = new Set<string>();
  let leaveCount = 0;
  for (const l of leaveSeeds) {
    const emp = E(l.who);
    const type = lt(l.type);
    const workDates = calendar.workingDates(l.from, l.to);
    const days = l.halfDay ? 0.5 : workDates.length;
    const mgrKey = emp.person.manager;
    const approver = mgrKey ? E(mgrKey) : superAdmin;
    const approverName = `${approver.person.firstName} ${approver.person.lastName}`;
    const decided = l.status === 'APPROVED' || l.status === 'REJECTED';
    const step = {
      approverType: 'MANAGER' as const,
      status: l.status === 'APPROVED' ? ('APPROVED' as const) : l.status === 'REJECTED' ? ('REJECTED' as const) : l.status === 'CANCELLED' ? ('SKIPPED' as const) : ('PENDING' as const),
      actedBy: decided ? approver.userId : null,
      actedByName: decided ? approverName : undefined,
      actedAt: decided ? now : null,
      comment: l.status === 'REJECTED' ? 'Team deliverable due that day' : undefined,
    };
    const submittedAt = zonedInstant(addDaysKey(l.from, -7), '10:30', TZ);
    const req = await LeaveRequestModel.create({
      organizationId: orgId,
      employeeId: emp._id,
      leaveTypeId: type._id,
      startDate: dateOnly(l.from),
      endDate: dateOnly(l.to),
      halfDay: !!l.halfDay,
      halfDaySession: l.halfDay ? 'FIRST_HALF' : null,
      days,
      reason: l.reason,
      status: l.status,
      approvalSteps: [step],
      currentStep: 0,
      currentApproverType: l.status === 'SUBMITTED' ? 'MANAGER' : null,
      rejectionReason: l.status === 'REJECTED' ? 'Team deliverable due that day' : undefined,
      cancellationReason: l.status === 'CANCELLED' ? 'Plans changed' : undefined,
      submittedAt: submittedAt > now ? now : submittedAt,
      decidedAt: decided ? now : null,
      requestedBy: emp.userId,
    });
    leaveCount++;
    const balance = await LeaveBalanceModel.findOne({ organizationId: orgId, employeeId: emp._id, leaveTypeId: type._id, year });
    if (balance) {
      if (l.status === 'APPROVED') {
        balance.used += days;
        balance.transactions.push({ type: 'USED', days, reason: l.reason, leaveRequestId: req._id, by: approver.userId, at: now });
      } else if (l.status === 'SUBMITTED') {
        balance.pending += days;
      }
      await balance.save();
    }
    if (l.status === 'APPROVED') for (const d of workDates) onLeave.add(`${emp._id}:${d}`);
  }

  /* Attendance: last 20 working days + today's check-ins */
  const attendanceDocs: Record<string, unknown>[] = [];
  const [nowH, nowM] = timeInTz(now, TZ).split(':').map(Number);
  const nowMinutesIst = nowH! * 60 + nowM!;
  for (const e of employees.values()) {
    const days = [...pastDays, ...(todayIsWorking ? [today] : [])].filter((d) => d >= e.joining);
    for (const d of days) {
      const shiftId = e.person.nightShift ? nightShift!._id : generalShift!._id;
      const base = { organizationId: orgId, employeeId: e._id, date: dateOnly(d), shiftId, source: 'WEB' };
      if (onLeave.has(`${e._id}:${d}`)) {
        attendanceDocs.push({ ...base, status: 'LEAVE', source: 'SYSTEM' });
        continue;
      }
      const r = rng();
      const isToday = d === today;
      if (r < 0.04) {
        if (!isToday) attendanceDocs.push({ ...base, status: 'ABSENT', source: 'SYSTEM' });
        continue;
      }
      const remote = e.person.location === 'REMOTE' || r < 0.1;
      const late = rng() < 0.15;
      const startMin = e.person.nightShift ? 21 * 60 : 9 * 60;
      const inOffset = late ? 16 + Math.floor(rng() * 25) : Math.floor(rng() * 16);
      const inMin = startMin + inOffset;
      if (isToday && (e.person.nightShift || inMin > nowMinutesIst)) continue;
      const checkIn = zonedInstant(d, hhmm(inMin), TZ);
      const lateMinutes = Math.max(0, inOffset - 15);
      const halfDay = !remote && rng() < 0.03;
      if (isToday) {
        attendanceDocs.push({
          ...base,
          checkIn,
          workMode: remote ? 'REMOTE' : 'OFFICE',
          status: remote ? 'WORK_FROM_HOME' : lateMinutes > 0 ? 'LATE' : 'PRESENT',
          isLate: lateMinutes > 0,
          lateMinutes,
        });
        continue;
      }
      const outMin = halfDay ? startMin + 4 * 60 + 30 : startMin + 9 * 60 + Math.floor(rng() * 76);
      const outKey = outMin >= 24 * 60 ? addDaysKey(d, 1) : d;
      const checkOut = zonedInstant(outKey, hhmm(outMin), TZ);
      const breakStartMin = startMin + 4 * 60;
      const breaks = halfDay
        ? []
        : [
            {
              start: zonedInstant(breakStartMin >= 24 * 60 ? addDaysKey(d, 1) : d, hhmm(breakStartMin), TZ),
              end: zonedInstant(breakStartMin + 60 >= 24 * 60 ? addDaysKey(d, 1) : d, hhmm(breakStartMin + 60), TZ),
            },
          ];
      const breakMinutes = halfDay ? 0 : 60;
      const workingMinutes = outMin - inMin - breakMinutes;
      const endOfShift = startMin + 9 * 60;
      attendanceDocs.push({
        ...base,
        checkIn,
        checkOut,
        breaks,
        workMode: remote ? 'REMOTE' : 'OFFICE',
        status: remote ? 'WORK_FROM_HOME' : workingMinutes < 240 ? 'HALF_DAY' : lateMinutes > 0 ? 'LATE' : 'PRESENT',
        workingMinutes,
        breakMinutes,
        overtimeMinutes: Math.max(0, workingMinutes - 9 * 60),
        lateMinutes,
        isLate: lateMinutes > 0,
        earlyDepartureMinutes: Math.max(0, endOfShift - outMin),
        isEarlyDeparture: outMin < endOfShift,
      });
    }
  }
  await AttendanceModel.insertMany(attendanceDocs);

  /* Recruitment */
  const nextSeq = async (key: string) => (await CounterModel.findOneAndUpdate({ organizationId: orgId, key }, { $inc: { value: 1 } }, { upsert: true, new: true }).lean())!.value;
  const jobSeeds = [
    { title: 'Senior Backend Engineer', dept: 'ENG' as const, desig: 'SSE', loc: 'BLR' as const, status: 'OPEN', openings: 2, manager: 'manager', skills: ['Node.js', 'MongoDB', 'TypeScript'], min: 18, max: 32 },
    { title: 'Product Designer', dept: 'PRD' as const, desig: 'PA', loc: 'BLR' as const, status: 'OPEN', openings: 1, manager: 'arjun', skills: ['Figma', 'User research'], min: 12, max: 20 },
    { title: 'Account Executive', dept: 'SAL' as const, desig: 'SEX', loc: 'MUM' as const, status: 'OPEN', openings: 2, manager: 'sanjay', skills: ['B2B sales', 'CRM'], min: 8, max: 14 },
    { title: 'Marketing Intern', dept: 'MKT' as const, desig: 'MS', loc: 'MUM' as const, status: 'CLOSED', openings: 1, manager: 'isha', skills: ['Content', 'Social media'], min: 2, max: 3 },
  ];
  const jobs: Types.ObjectId[] = [];
  for (const j of jobSeeds) {
    const doc = await JobOpeningModel.create({
      organizationId: orgId,
      code: `JOB-${String(await nextSeq('job')).padStart(4, '0')}`,
      title: j.title,
      departmentId: departments.get(j.dept),
      designationId: designations.get(j.desig)!.id,
      locationId: locations.get(j.loc),
      employmentType: j.title.includes('Intern') ? 'INTERN' : 'FULL_TIME',
      openings: j.openings,
      filled: j.status === 'CLOSED' ? 1 : 0,
      experienceMin: j.title.includes('Intern') ? 0 : 3,
      experienceMax: j.title.includes('Intern') ? 1 : 8,
      salaryMin: j.min * 100000,
      salaryMax: j.max * 100000,
      currency: CURRENCY,
      skills: j.skills,
      description: `<p>We are hiring a ${j.title} to join the ${j.dept} team.</p>`,
      requirements: 'Relevant experience and strong communication skills.',
      status: j.status,
      hiringManagerId: E(j.manager)._id,
      publishedAt: zonedInstant(addDaysKey(today, -40), '10:00', TZ),
      closingDate: dateOnly(addDaysKey(today, j.status === 'CLOSED' ? -5 : 30)),
      createdBy: userOf('recruiter'),
    });
    jobs.push(doc._id);
  }
  const candidateSeeds: { first: string; last: string; job: number; stage: string; source: string; exp: number }[] = [
    { first: 'Ishaan', last: 'Bajaj', job: 0, stage: 'APPLIED', source: 'CAREERS_PAGE', exp: 5 },
    { first: 'Meghna', last: 'Sethi', job: 0, stage: 'SCREENING', source: 'LINKEDIN', exp: 6 },
    { first: 'Rohit', last: 'Chauhan', job: 0, stage: 'INTERVIEW', source: 'REFERRAL', exp: 7 },
    { first: 'Sana', last: 'Mirza', job: 0, stage: 'OFFERED', source: 'JOB_BOARD', exp: 6 },
    { first: 'Yash', last: 'Tiwari', job: 0, stage: 'REJECTED', source: 'AGENCY', exp: 4 },
    { first: 'Aditi', last: 'Bhalla', job: 1, stage: 'SHORTLISTED', source: 'LINKEDIN', exp: 4 },
    { first: 'Kunal', last: 'Mehra', job: 1, stage: 'INTERVIEW', source: 'CAREERS_PAGE', exp: 5 },
    { first: 'Zoya', last: 'Khan', job: 1, stage: 'APPLIED', source: 'JOB_BOARD', exp: 3 },
    { first: 'Pranav', last: 'Jain', job: 2, stage: 'ASSESSMENT', source: 'REFERRAL', exp: 3 },
    { first: 'Shruti', last: 'Kaul', job: 2, stage: 'SCREENING', source: 'CAREERS_PAGE', exp: 2 },
    { first: 'Dev', last: 'Anand', job: 2, stage: 'APPLIED', source: 'LINKEDIN', exp: 4 },
    { first: 'Mira', last: 'Sen', job: 3, stage: 'HIRED', source: 'CAMPUS', exp: 0 },
  ];
  const ORDER = ['APPLIED', 'SCREENING', 'SHORTLISTED', 'INTERVIEW', 'ASSESSMENT', 'SELECTED', 'OFFERED', 'HIRED'];
  const candidates: Types.ObjectId[] = [];
  for (const [i, c] of candidateSeeds.entries()) {
    const reached = c.stage === 'REJECTED' ? ['APPLIED', 'SCREENING'] : ORDER.slice(0, ORDER.indexOf(c.stage) + 1);
    const history = [...reached.slice(1), ...(c.stage === 'REJECTED' ? ['REJECTED'] : [])].map((to, idx, arr) => ({
      from: idx === 0 ? 'APPLIED' : arr[idx - 1],
      to,
      by: userOf('recruiter'),
      at: zonedInstant(addDaysKey(today, -30 + idx * 4), '11:00', TZ),
    }));
    const doc = await CandidateModel.create({
      organizationId: orgId,
      jobId: jobs[c.job],
      firstName: c.first,
      lastName: c.last,
      email: `candidate.${c.first}.${c.last}@${DEMO_DOMAIN}`.toLowerCase(),
      phone: `+91 98000 ${String(20000 + i * 53).slice(-5)}`,
      skills: jobSeeds[c.job]!.skills,
      experienceYears: c.exp,
      currentCompany: c.exp ? 'Example Systems Pvt Ltd' : undefined,
      expectedSalary: jobSeeds[c.job]!.max * 90000,
      noticePeriodDays: c.exp ? 30 : 0,
      source: c.source,
      stage: c.stage,
      stageHistory: history,
      rating: c.stage === 'REJECTED' ? 2 : 3 + (i % 3),
      rejectionReason: c.stage === 'REJECTED' ? 'Not enough depth in distributed systems' : undefined,
      hiredAt: c.stage === 'HIRED' ? zonedInstant(addDaysKey(today, -6), '12:00', TZ) : undefined,
      createdBy: userOf('recruiter'),
      createdAt: zonedInstant(addDaysKey(today, -32 + i), '09:30', TZ),
    });
    candidates.push(doc._id);
  }
  await InterviewModel.insertMany([
    {
      organizationId: orgId,
      candidateId: candidates[2],
      jobId: jobs[0],
      interviewerIds: [E('manager')._id, E('karan')._id],
      scheduledAt: zonedInstant(futureDays[1]!, '11:00', TZ),
      durationMinutes: 60,
      type: 'TECHNICAL',
      round: 2,
      meetingLink: 'https://meet.stencil-demo.test/tech-round',
      status: 'SCHEDULED',
      createdBy: userOf('recruiter'),
    },
    {
      organizationId: orgId,
      candidateId: candidates[6],
      jobId: jobs[1],
      interviewerIds: [E('arjun')._id],
      scheduledAt: zonedInstant(futureDays[2]!, '15:00', TZ),
      durationMinutes: 45,
      type: 'VIDEO',
      round: 1,
      meetingLink: 'https://meet.stencil-demo.test/design-chat',
      status: 'SCHEDULED',
      createdBy: userOf('recruiter'),
    },
    {
      organizationId: orgId,
      candidateId: candidates[2],
      jobId: jobs[0],
      interviewerIds: [E('diya')._id],
      scheduledAt: zonedInstant(pastDays[10]!, '14:00', TZ),
      durationMinutes: 45,
      type: 'PHONE',
      round: 1,
      status: 'COMPLETED',
      feedback: [
        { interviewerId: E('diya')._id, interviewerName: 'Diya Menon', rating: 4, feedback: 'Solid fundamentals, clear communicator.', recommendation: 'HIRE', at: zonedInstant(pastDays[10]!, '15:00', TZ) },
      ],
      rating: 4,
      createdBy: userOf('recruiter'),
    },
  ]);

  /* Performance */
  const month = Number(today.slice(5, 7));
  const half = month >= 7 ? 2 : 1;
  const cycleStart = half === 2 ? `${year}-07-01` : `${year}-01-01`;
  const cycleEnd = half === 2 ? `${year}-12-31` : `${year}-06-30`;
  const prevStart = half === 2 ? `${year}-01-01` : `${year - 1}-07-01`;
  const prevEnd = half === 2 ? `${year}-06-30` : `${year - 1}-12-31`;
  const ratingLabels = [
    { value: 1, label: 'Needs improvement' },
    { value: 2, label: 'Partially meets expectations' },
    { value: 3, label: 'Meets expectations' },
    { value: 4, label: 'Exceeds expectations' },
    { value: 5, label: 'Outstanding' },
  ];
  const [prevCycle, cycle] = await PerformanceCycleModel.create([
    {
      organizationId: orgId,
      name: `H${half === 2 ? 1 : 2} ${half === 2 ? year : year - 1} Performance Review`,
      startDate: dateOnly(prevStart),
      endDate: dateOnly(prevEnd),
      status: 'COMPLETED',
      ratingScale: { min: 1, max: 5, labels: ratingLabels },
      competencies: ['Ownership', 'Collaboration', 'Craft'],
      createdBy: hrUser.userId,
    },
    {
      organizationId: orgId,
      name: `H${half} ${year} Performance Review`,
      description: 'Half-yearly goals and review cycle',
      startDate: dateOnly(cycleStart),
      endDate: dateOnly(cycleEnd),
      selfReviewDue: dateOnly(addDaysKey(cycleEnd, -30)),
      managerReviewDue: dateOnly(addDaysKey(cycleEnd, -15)),
      status: 'IN_PROGRESS',
      ratingScale: { min: 1, max: 5, labels: ratingLabels },
      competencies: ['Ownership', 'Collaboration', 'Craft'],
      createdBy: hrUser.userId,
    },
  ]);
  const goalOwners = ['employee', 'karan', 'diya', 'aditya', 'sneha', 'rahul', 'deepak', 'tanvi', 'varun', 'riya'];
  const goalTemplates = [
    { title: 'Ship quarterly roadmap commitments', category: 'OKR', weight: 50 },
    { title: 'Improve code review turnaround', category: 'KPI', weight: 30 },
    { title: 'Complete a professional certification', category: 'DEVELOPMENT', weight: 20 },
  ];
  const goalDocs: Record<string, unknown>[] = [];
  for (const [i, key] of goalOwners.entries()) {
    const emp = E(key);
    for (const [j, g] of goalTemplates.entries()) {
      const progress = Math.min(100, (i * 17 + j * 29) % 101);
      goalDocs.push({
        organizationId: orgId,
        title: g.title,
        category: g.category,
        weight: g.weight,
        progress,
        status: progress >= 100 ? 'COMPLETED' : progress === 0 ? 'NOT_STARTED' : 'IN_PROGRESS',
        dueDate: dateOnly(cycleEnd),
        employeeId: emp._id,
        managerId: emp.person.manager ? E(emp.person.manager)._id : null,
        cycleId: cycle!._id,
        keyResults: [{ title: 'Milestone 1', progress: Math.min(100, progress + 10) }],
        createdBy: emp.userId ?? superAdmin.userId,
      });
    }
  }
  await GoalModel.insertMany(goalDocs);
  const reviewDocs: Record<string, unknown>[] = [];
  for (const [i, key] of goalOwners.entries()) {
    const emp = E(key);
    const managerId = emp.person.manager ? E(emp.person.manager)._id : null;
    const status = key === 'employee' || key === 'karan' ? 'PENDING_MANAGER' : 'PENDING_SELF';
    reviewDocs.push({
      organizationId: orgId,
      cycleId: cycle!._id,
      employeeId: emp._id,
      managerId,
      status,
      selfReview: status === 'PENDING_MANAGER' ? { overallRating: 4, strengths: 'Consistent delivery', improvements: 'Delegation', submittedAt: now, submittedBy: emp.userId } : null,
    });
    const final = 3 + (i % 3);
    reviewDocs.push({
      organizationId: orgId,
      cycleId: prevCycle!._id,
      employeeId: emp._id,
      managerId,
      status: 'COMPLETED',
      selfReview: { overallRating: final, submittedAt: dateOnly(addDaysKey(prevEnd, -20)) },
      managerReview: { overallRating: final, comments: 'Good half.', submittedAt: dateOnly(addDaysKey(prevEnd, -10)) },
      goalScore: 60 + i * 3,
      finalRating: final,
      finalRatingLabel: ratingLabels[final - 1]!.label,
      completedAt: dateOnly(addDaysKey(prevEnd, -5)),
    });
  }
  await PerformanceReviewModel.insertMany(reviewDocs);

  /* Assets */
  const assetSeeds: { name: string; category: string; brand: string; model: string; cost: number; assignee?: string; status?: string }[] = [
    { name: 'MacBook Pro 14"', category: 'LAPTOP', brand: 'Apple', model: 'M3 Pro', cost: 199900, assignee: 'employee' },
    { name: 'MacBook Pro 14"', category: 'LAPTOP', brand: 'Apple', model: 'M3 Pro', cost: 199900, assignee: 'manager' },
    { name: 'ThinkPad T14', category: 'LAPTOP', brand: 'Lenovo', model: 'Gen 4', cost: 124000, assignee: 'karan' },
    { name: 'ThinkPad T14', category: 'LAPTOP', brand: 'Lenovo', model: 'Gen 4', cost: 124000, assignee: 'diya' },
    { name: 'ThinkPad T14', category: 'LAPTOP', brand: 'Lenovo', model: 'Gen 4', cost: 124000, assignee: 'aditya' },
    { name: 'Latitude 5440', category: 'LAPTOP', brand: 'Dell', model: '5440', cost: 98000, assignee: 'hr' },
    { name: 'Latitude 5440', category: 'LAPTOP', brand: 'Dell', model: '5440', cost: 98000, assignee: 'pooja' },
    { name: 'Latitude 5440', category: 'LAPTOP', brand: 'Dell', model: '5440', cost: 98000 },
    { name: 'UltraSharp 27" Monitor', category: 'MONITOR', brand: 'Dell', model: 'U2723QE', cost: 52000, assignee: 'employee' },
    { name: 'UltraSharp 27" Monitor', category: 'MONITOR', brand: 'Dell', model: 'U2723QE', cost: 52000 },
    { name: 'UltraSharp 27" Monitor', category: 'MONITOR', brand: 'Dell', model: 'U2723QE', cost: 52000, status: 'REPAIR' },
    { name: 'iPhone 15', category: 'PHONE', brand: 'Apple', model: '15', cost: 79900, assignee: 'sanjay' },
    { name: 'Galaxy S23', category: 'PHONE', brand: 'Samsung', model: 'S23', cost: 64999, status: 'RETIRED' },
  ];
  for (const [i, a] of assetSeeds.entries()) {
    const tag = `AST-${String(await nextSeq('asset')).padStart(4, '0')}`;
    const purchase = addDaysKey(today, -(120 + i * 30));
    const asset = await AssetModel.create({
      organizationId: orgId,
      assetTag: tag,
      name: a.name,
      category: a.category,
      brand: a.brand,
      model: a.model,
      serialNumber: `SN-DEMO-${1000 + i}`,
      purchaseDate: dateOnly(purchase),
      purchaseCost: a.cost,
      warrantyExpiry: dateOnly(addDaysKey(purchase, 3 * 365)),
      vendor: 'Demo IT Supplies',
      locationId: locations.get('BLR'),
      status: a.assignee ? 'ASSIGNED' : (a.status ?? 'AVAILABLE'),
      condition: a.status === 'REPAIR' ? 'DAMAGED' : i < 4 ? 'NEW' : 'GOOD',
      statusHistory: [{ from: null, to: 'AVAILABLE', note: 'Purchased', by: superAdmin.userId, at: dateOnly(purchase) }],
    });
    if (a.assignee) {
      const emp = E(a.assignee);
      const assignedDate = emp.joining > purchase ? emp.joining : purchase;
      const assignment = await AssetAssignmentModel.create({
        organizationId: orgId,
        assetId: asset._id,
        employeeId: emp._id,
        assignedDate: dateOnly(assignedDate),
        conditionAtAssignment: 'GOOD',
        status: 'ACTIVE',
        assignedBy: hrUser.userId,
      });
      asset.currentAssignmentId = assignment._id;
      asset.currentEmployeeId = emp._id;
      asset.statusHistory.push({ from: 'AVAILABLE', to: 'ASSIGNED', note: `Assigned to ${emp.person.firstName}`, by: hrUser.userId, at: dateOnly(assignedDate) });
      await asset.save();
    } else if (a.status) {
      asset.statusHistory.push({ from: 'AVAILABLE', to: a.status, note: a.status === 'REPAIR' ? 'Screen flicker' : 'End of life', by: hrUser.userId, at: now });
      await asset.save();
    }
  }

  /* Expenses (chain: MANAGER → FINANCE) */
  const expenseSeeds: { who: string; category: string; amount: number; desc: string; merchant: string; state: 'DRAFT' | 'AWAIT_MANAGER' | 'AWAIT_FINANCE' | 'APPROVED' | 'REJECTED' | 'PAID'; daysAgo: number }[] = [
    { who: 'employee', category: 'TRAVEL', amount: 2450, desc: 'Cab to client workshop', merchant: 'Demo Cabs', state: 'AWAIT_MANAGER', daysAgo: 3 },
    { who: 'employee', category: 'COMMUNICATION', amount: 799, desc: 'Mobile data plan', merchant: 'Demo Telecom', state: 'PAID', daysAgo: 35 },
    { who: 'karan', category: 'SOFTWARE', amount: 4999, desc: 'IDE licence renewal', merchant: 'Demo Software', state: 'AWAIT_FINANCE', daysAgo: 6 },
    { who: 'rahul', category: 'MEALS', amount: 1200, desc: 'Team lunch after release', merchant: 'Demo Bistro', state: 'APPROVED', daysAgo: 10 },
    { who: 'riya', category: 'TRAVEL', amount: 8600, desc: 'Flight to Pune for client meeting', merchant: 'Demo Airways', state: 'PAID', daysAgo: 20 },
    { who: 'aman', category: 'ACCOMMODATION', amount: 6400, desc: 'Hotel stay (2 nights)', merchant: 'Demo Inn', state: 'REJECTED', daysAgo: 14 },
    { who: 'nisha', category: 'OFFICE_SUPPLIES', amount: 950, desc: 'Printing for event', merchant: 'Demo Prints', state: 'DRAFT', daysAgo: 1 },
    { who: 'sanjay', category: 'TRAINING', amount: 15000, desc: 'Sales leadership workshop', merchant: 'Demo Academy', state: 'AWAIT_MANAGER', daysAgo: 4 },
  ];
  for (const x of expenseSeeds) {
    const emp = E(x.who);
    const mgr = emp.person.manager ? E(emp.person.manager) : superAdmin;
    const fin = E('finance');
    const acted = (who: typeof mgr, status: 'APPROVED' | 'REJECTED') => ({ status, actedBy: who.userId, actedByName: `${who.person.firstName} ${who.person.lastName}`, actedAt: now });
    let steps: Record<string, unknown>[] = [];
    let status = 'DRAFT';
    let current: string | null = null;
    let currentStep = 0;
    switch (x.state) {
      case 'DRAFT':
        steps = [];
        break;
      case 'AWAIT_MANAGER':
        steps = [{ approverType: 'MANAGER', status: 'PENDING' }, { approverType: 'FINANCE', status: 'PENDING' }];
        status = 'SUBMITTED';
        current = 'MANAGER';
        break;
      case 'AWAIT_FINANCE':
        steps = [{ approverType: 'MANAGER', ...acted(mgr, 'APPROVED') }, { approverType: 'FINANCE', status: 'PENDING' }];
        status = 'PENDING_APPROVAL';
        current = 'FINANCE';
        currentStep = 1;
        break;
      case 'APPROVED':
      case 'PAID':
        steps = [{ approverType: 'MANAGER', ...acted(mgr, 'APPROVED') }, { approverType: 'FINANCE', ...acted(fin, 'APPROVED') }];
        status = x.state;
        currentStep = 1;
        break;
      case 'REJECTED':
        steps = [{ approverType: 'MANAGER', ...acted(mgr, 'REJECTED'), comment: 'Please use the corporate travel desk' }, { approverType: 'FINANCE', status: 'PENDING' }];
        status = 'REJECTED';
        break;
    }
    const date = addDaysKey(today, -x.daysAgo);
    await ExpenseModel.create({
      organizationId: orgId,
      expenseNumber: `EXP-${String(await nextSeq('expense')).padStart(4, '0')}`,
      employeeId: emp._id,
      category: x.category,
      amount: x.amount,
      currency: CURRENCY,
      date: dateOnly(date),
      description: x.desc,
      merchant: x.merchant,
      status,
      approvalSteps: steps,
      currentStep,
      currentApproverType: current,
      rejectionReason: x.state === 'REJECTED' ? 'Please use the corporate travel desk' : undefined,
      submittedAt: x.state === 'DRAFT' ? undefined : zonedInstant(date, '18:00', TZ),
      approvedAt: x.state === 'APPROVED' || x.state === 'PAID' ? now : undefined,
      paidAt: x.state === 'PAID' ? now : undefined,
      paidBy: x.state === 'PAID' ? fin.userId : undefined,
      paymentReference: x.state === 'PAID' ? `NEFT-DEMO-${x.daysAgo}` : undefined,
      createdBy: emp.userId,
    });
  }

  /* Payroll: previous two months, paid */
  let payslipCount = 0;
  for (let back = 2; back >= 1; back--) {
    const d = new Date(Date.UTC(year, Number(today.slice(5, 7)) - 1 - back, 1));
    const py = d.getUTCFullYear();
    const pm = d.getUTCMonth() + 1;
    const { start, end, days } = monthRange(py, pm);
    const eligible = [...employees.values()].filter((e) => e.joining <= start);
    const slips = eligible.map((e) => {
      const s = structures.get(String(e._id))!;
      return { e, s };
    });
    const totals = slips.reduce((a, { s }) => ({ gross: a.gross + s.gross, ded: a.ded + s.deductions, net: a.net + s.net, er: a.er + s.pfEr }), { gross: 0, ded: 0, net: 0, er: 0 });
    const paidOn = zonedInstant(end, '18:00', TZ);
    const payrollDoc = await PayrollModel.create({
      organizationId: orgId,
      month: pm,
      year: py,
      periodStart: dateOnly(start),
      periodEnd: dateOnly(end),
      periodKey: `${py}-${pad(pm)}`,
      status: 'PAID',
      currency: CURRENCY,
      employeeCount: slips.length,
      totalGross: totals.gross,
      totalDeductions: totals.ded,
      totalNet: totals.net,
      totalEmployerContributions: totals.er,
      processedAt: paidOn,
      processedBy: userOf('payroll'),
      approvedAt: paidOn,
      approvedBy: userOf('finance'),
      paidAt: paidOn,
      paidBy: userOf('payroll'),
      paymentDate: dateOnly(end),
      paymentReference: `SAL-${py}${pad(pm)}`,
      paymentMode: 'BANK_TRANSFER',
      createdBy: userOf('payroll'),
      statusHistory: ['DRAFT', 'PROCESSING', 'REVIEW', 'APPROVED', 'PAID'].map((st) => ({ status: st, at: paidOn, by: userOf('payroll') })),
    });
    const workingDays = calendar.workingDates(start, end).length || 22;
    await PayslipModel.insertMany(
      slips.map(({ e, s }) => ({
        organizationId: orgId,
        payrollId: payrollDoc._id,
        employeeId: e._id,
        month: pm,
        year: py,
        currency: CURRENCY,
        status: 'PAID',
        employeeSnapshot: {
          employeeId: e.code,
          name: `${e.person.firstName} ${e.person.lastName}`,
          workEmail: e.person.login ? `${e.person.login.local}@${DEMO_DOMAIN}` : `${e.person.firstName}.${e.person.lastName}@${DEMO_DOMAIN}`.toLowerCase(),
          department: DEPARTMENTS.find((x) => x.code === e.person.dept)!.name,
          designation: designations.get(e.person.designation)!.name,
          location: LOCATIONS.find((l) => l.key === e.person.location)!.name,
          joiningDate: dateOnly(e.joining),
        },
        structureId: s.id,
        daysInPeriod: days,
        workingDays,
        payableDays: days,
        presentDays: workingDays,
        paidLeaveDays: 0,
        unpaidLeaveDays: 0,
        absentDays: 0,
        holidays: 0,
        weekOffs: days - workingDays,
        earnings: [
          { code: 'BASIC', name: 'Basic Salary', amount: s.basic, category: 'EARNING' },
          { code: 'HRA', name: 'House Rent Allowance', amount: s.hra, category: 'EARNING' },
          { code: 'TRANSPORT', name: 'Transport Allowance', amount: 1600, category: 'EARNING' },
          { code: 'MEDICAL', name: 'Medical Allowance', amount: 1250, category: 'EARNING' },
          { code: 'SPECIAL', name: 'Special Allowance', amount: s.special, category: 'EARNING' },
        ],
        deductions: [
          { code: 'PF', name: 'Provident Fund (Employee)', amount: s.pf, category: 'STATUTORY' },
          ...(s.esi ? [{ code: 'ESI', name: 'ESI (Employee)', amount: s.esi, category: 'STATUTORY' }] : []),
          { code: 'PT', name: 'Professional Tax', amount: s.pt, category: 'STATUTORY' },
        ],
        employerContributions: [{ code: 'PF_ER', name: 'Provident Fund (Employer)', amount: s.pfEr, category: 'STATUTORY' }],
        grossEarnings: s.gross,
        totalDeductions: s.deductions,
        netPay: s.net,
        paymentDate: dateOnly(end),
        paymentReference: `SAL-${py}${pad(pm)}`,
        paymentMode: 'BANK_TRANSFER',
      })),
    );
    payslipCount += slips.length;
  }

  /* Onboarding for the recent joiner */
  const template = await OnboardingTemplateModel.findOne({ organizationId: orgId, isDefault: true }).lean();
  if (template) {
    const pooja = E('pooja');
    const tasks = template.tasks.map((t, i) => ({
      title: t.title,
      description: t.description,
      category: t.category,
      assignee: t.assignee,
      required: t.required ?? true,
      dueDate: dateOnly(addDaysKey(pooja.joining, t.dueInDays ?? 0)),
      status: i < 4 ? 'COMPLETED' : i < 6 ? 'IN_PROGRESS' : 'PENDING',
      completedAt: i < 4 ? now : undefined,
      completedBy: i < 4 ? hrUser.userId : null,
    }));
    await OnboardingModel.create({
      organizationId: orgId,
      employeeId: pooja._id,
      templateId: template._id,
      startDate: dateOnly(pooja.joining),
      status: 'IN_PROGRESS',
      tasks,
      progress: Math.round((tasks.filter((t) => t.status === 'COMPLETED').length / Math.max(1, tasks.length)) * 100),
      createdBy: hrUser.userId,
    });
  }

  /* Announcements (published → audience notified in-app) */
  const announcementSeeds = [
    {
      title: 'Welcome to Stencil HRMS',
      content:
        '<h3>Our new people platform is live</h3><p>You can now apply for leave, check in, view payslips and more in one place.</p><ul><li>Update your <strong>profile</strong> and emergency contact</li><li>Review your <em>leave balances</em></li></ul><p>Questions? Read the <a href="https://help.stencil-demo.test/getting-started">getting started guide</a>.</p>',
      priority: 'HIGH',
      audience: 'ALL',
      pinned: true,
    },
    {
      title: 'Engineering all-hands this Friday',
      content: '<p>Join us for the monthly engineering all-hands: roadmap review, demos and Q&amp;A.</p><blockquote>Bring one thing you learned this month.</blockquote>',
      priority: 'NORMAL',
      audience: 'DEPARTMENTS',
      departmentIds: [departments.get('ENG')!],
      pinned: false,
    },
  ] as const;
  for (const [i, a] of announcementSeeds.entries()) {
    const doc = await AnnouncementModel.create({
      organizationId: orgId,
      title: a.title,
      content: sanitizeHtml(a.content),
      priority: a.priority,
      audience: a.audience,
      departmentIds: 'departmentIds' in a ? a.departmentIds : [],
      publishAt: new Date(now.getTime() - (i + 1) * 3_600_000),
      pinned: a.pinned,
      createdBy: hrUser.userId!,
    });
    await publishAnnouncement(doc._id);
  }

  /* A few audit entries so the activity feed is not empty */
  await audit(actorCtx('ceo'), { action: 'ORGANIZATION_REGISTERED', module: 'organization', recordId: orgId, recordLabel: org.name });
  for (const key of ['pooja', 'deepak', 'nikhil']) {
    const e = E(key);
    await audit(actorCtx('hr'), {
      action: 'EMPLOYEE_CREATED',
      module: 'employees',
      recordId: e._id,
      recordLabel: `${e.person.firstName} ${e.person.lastName} (${e.code})`,
      newValues: { employeeId: e.code, workEmail: `${e.person.firstName}.${e.person.lastName}@${DEMO_DOMAIN}`.toLowerCase() },
    });
  }
  await audit(actorCtx('manager'), { action: 'LEAVE_APPROVED', module: 'leave', recordLabel: 'Ananya Sharma - Casual Leave' });

  const counts = {
    employees: employees.size,
    users: credentials.length,
    departments: departments.size,
    designations: designations.size,
    locations: locations.size,
    holidays: holidayDocs.length,
    attendance: attendanceDocs.length,
    leaveRequests: leaveCount,
    jobs: jobs.length,
    candidates: candidates.length,
    assets: assetSeeds.length,
    expenses: expenseSeeds.length,
    payslips: payslipCount,
    announcements: announcementSeeds.length,
    roles: SYSTEM_ROLE_KEYS.length,
  };
  return { organizationId: orgId, credentials, counts };
};

/** Prints the demo credentials table (CLI). */
export const printCredentials = (result: SeedResult) => {
  const rows = result.credentials.map((c) => ({ Role: c.role, Email: c.email, Password: c.password, Name: c.name }));
  // eslint-disable-next-line no-console
  console.log('\nStencil Demo Co. seeded. Demo accounts (password for all: %s):\n', DEMO_PASSWORD);
  // eslint-disable-next-line no-console
  console.table(rows);
  // eslint-disable-next-line no-console
  console.log('Counts:', result.counts);
};
