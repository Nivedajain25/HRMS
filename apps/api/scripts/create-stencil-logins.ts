/**
 * `pnpm --filter @stencil/api logins:stencil`
 *
 * Creates a login for every Stencil employee that does not have one yet (existing
 * logins are never touched, so it is safe to re-run after adding employees).
 *  - login email = the employee's work email
 *  - role: Employee; + Manager for anyone with direct reports
 *  - a unique random temporary password each (stored only as a hash in the database)
 *
 * The temporary passwords are written ONCE to a private CSV outside the project
 * (default: ~/Documents/stencil-initial-logins-<timestamp>.csv) for handing out.
 * People should change them after their first sign-in (Profile → Security).
 */
import { randomInt } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Types } from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { DesignationModel, EmployeeModel, OrganizationModel, RoleModel, UserModel } from '../src/models';
import { STENCIL_SLUG } from '../src/seed/stencil-org';
import { hashPassword } from '../src/services/auth.service';

/** Readable (no 0/O, 1/l/I), always has lower + upper + digit, e.g. `Kp7m-Rx4t-Wq2n`. */
const temporaryPassword = () => {
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digit = '23456789';
  const pick = (set: string) => set[randomInt(set.length)]!;
  const group = () => pick(upper) + pick(lower) + pick(digit) + pick(lower);
  return `${group()}-${group()}-${group()}`;
};

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

const main = async () => {
  await connectDatabase();
  try {
    const org = await OrganizationModel.findOne({ slug: STENCIL_SLUG }).select('_id name').lean();
    if (!org) throw new Error('Stencil organization not found. Run `pnpm seed:stencil` first.');

    const roles = await RoleModel.find({ organizationId: org._id, key: { $in: ['employee', 'manager'] } }).lean();
    const roleId = (key: string) => {
      const r = roles.find((x) => x.key === key);
      if (!r) throw new Error(`Role "${key}" missing in the Stencil organization.`);
      return r._id as Types.ObjectId;
    };

    const employees = await EmployeeModel.find({ organizationId: org._id, employmentStatus: 'ACTIVE' }).sort({ employeeId: 1 }).lean();
    const managerIds = new Set(employees.map((e) => String(e.managerId ?? '')).filter(Boolean));
    const designations = new Map(
      (await DesignationModel.find({ organizationId: org._id }).select('name').lean()).map((d) => [String(d._id), d.name]),
    );

    const created: string[][] = [];
    const skipped: string[] = [];
    for (const e of employees) {
      const name = [e.firstName, e.lastName].filter(Boolean).join(' ');
      if (e.userId) {
        skipped.push(`${name} (already has a login)`);
        continue;
      }
      if (!e.workEmail) {
        skipped.push(`${name} (no work email)`);
        continue;
      }
      const email = e.workEmail.toLowerCase();
      if (await UserModel.exists({ email })) {
        skipped.push(`${name} (${email} is already used by another login)`);
        continue;
      }

      const isManager = managerIds.has(String(e._id));
      const password = temporaryPassword();
      const [user] = await UserModel.create([
        {
          organizationId: org._id,
          employeeId: e._id,
          email,
          passwordHash: await hashPassword(password),
          firstName: e.firstName,
          lastName: e.lastName ?? '',
          roles: isManager ? [roleId('employee'), roleId('manager')] : [roleId('employee')],
          status: 'ACTIVE',
          emailVerified: true,
          passwordChangedAt: new Date(),
        },
      ]);
      await EmployeeModel.updateOne({ _id: e._id }, { userId: user!._id });
      created.push([
        e.employeeId,
        name,
        designations.get(String(e.designationId)) ?? '',
        isManager ? 'Employee + Manager' : 'Employee',
        email,
        password,
      ]);
    }

    if (created.length) {
      const dir = fs.existsSync(path.join(os.homedir(), 'Documents')) ? path.join(os.homedir(), 'Documents') : os.homedir();
      const file = path.join(dir, `stencil-initial-logins-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.csv`);
      const rows = [['Employee ID', 'Name', 'Designation', 'Access', 'Login email', 'Temporary password'], ...created];
      fs.writeFileSync(file, rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n', { flag: 'wx' });
      console.log(`\nCreated ${created.length} login(s). Temporary passwords saved to:\n  ${file}\n`);
      console.table(created.map(([id, n, , access, email]) => ({ id, name: n, access, email })));
    } else {
      console.log('\nNo new logins needed.');
    }
    if (skipped.length) console.log(`Skipped: ${skipped.join('; ')}`);
  } finally {
    await disconnectDatabase();
  }
};

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
