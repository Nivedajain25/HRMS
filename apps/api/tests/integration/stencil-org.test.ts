import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { DepartmentModel, DesignationModel, EmployeeModel, OrganizationModel } from '../../src/models';
import { STENCIL_ADMIN, STENCIL_PEOPLE, seedStencil } from '../../src/seed/stencil-org';
import { getApp } from '../helpers';

describe('Stencil organization seed (org chart)', () => {
  it('creates every employee with the chart designation and reporting line', async () => {
    const result = await seedStencil();
    expect(result.employees).toBe(18);

    const org = await OrganizationModel.findOne({ slug: 'stencil' }).lean();
    const employees = await EmployeeModel.find({ organizationId: org!._id })
      .populate({ path: 'designationId', select: 'name' })
      .populate({ path: 'departmentId', select: 'name' })
      .populate({ path: 'managerId', select: 'firstName' })
      .lean();
    const byName = new Map(employees.map((e) => [e.firstName, e as unknown as { designationId: { name: string }; managerId: { firstName: string } | null; lastName: string }]));

    expect(byName.get('Nitin')!.managerId).toBeNull();
    expect(byName.get('Nitin')!.designationId.name).toBe('Head');
    expect(byName.get('Nitin')!.lastName).toBe('');
    expect(byName.get('Suchithra')!.designationId.name).toBe('Junior Accountant');
    expect(byName.get('Suchithra')!.managerId!.firstName).toBe('Deepak');
    expect(byName.get('Chaitra')!.managerId!.firstName).toBe('Ambritha');
    expect(byName.get('Srinivas')!.managerId!.firstName).toBe('Rahul');
    expect(byName.get('Vijay')!.designationId.name).toBe('Labour');
    expect(byName.get('Sunny')!.managerId!.firstName).toBe('Chiranjeevi');
    for (const p of STENCIL_PEOPLE) expect(byName.has(p.name)).toBe(true);

    expect(await DepartmentModel.countDocuments({ organizationId: org!._id })).toBe(7);
    expect(await DesignationModel.countDocuments({ organizationId: org!._id })).toBe(15);

    // The head can sign in and sees 5 direct reports under Deepak.
    const login = await request(getApp()).post('/api/v1/auth/login').send({ email: STENCIL_ADMIN.email, password: STENCIL_ADMIN.password });
    expect(login.status).toBe(200);
    expect(login.body.data.user.isManager).toBe(true);
    const deepak = employees.find((e) => e.firstName === 'Deepak')!;
    expect(await EmployeeModel.countDocuments({ managerId: deepak._id })).toBe(5);

    // Re-running refuses to overwrite existing (possibly real) data…
    await expect(seedStencil()).rejects.toThrow(/already exists/);
    // …unless replacing is explicit; it then replaces instead of duplicating.
    await seedStencil({ replace: true });
    expect(await OrganizationModel.countDocuments({ slug: 'stencil' })).toBe(1);
  });
});
