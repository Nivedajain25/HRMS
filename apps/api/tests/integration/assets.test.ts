import { beforeAll, describe, expect, it } from 'vitest';
import { AuditLogModel, NotificationModel } from '../../src/models';
import { as, createEmployeeUser, registerOrg } from '../helpers';

describe('Assets', () => {
  let admin: Awaited<ReturnType<typeof registerOrg>>;
  let hr: Awaited<ReturnType<typeof createEmployeeUser>>;
  let emp: Awaited<ReturnType<typeof createEmployeeUser>>;
  let other: Awaited<ReturnType<typeof createEmployeeUser>>;

  const laptop = (extra: Record<string, unknown> = {}) => ({
    name: 'MacBook Pro 14',
    category: 'LAPTOP',
    brand: 'Apple',
    serialNumber: `SN-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    purchaseDate: '2024-02-01',
    purchaseCost: 2000,
    ...extra,
  });

  beforeAll(async () => {
    admin = await registerOrg();
    hr = await createEmployeeUser(admin.token, { firstName: 'Hr', roles: ['hr_admin'] });
    emp = await createEmployeeUser(admin.token, { firstName: 'Emp' });
    other = await createEmployeeUser(admin.token, { firstName: 'Other' });
  });

  it('creates assets with auto tags and rejects duplicate tags', async () => {
    const a = await as(hr.token).post('/api/v1/assets', laptop());
    expect(a.status).toBe(201);
    expect(a.body.data.assetTag).toMatch(/^AST-\d{4}$/);
    expect(a.body.data.status).toBe('AVAILABLE');
    expect(a.body.data.condition).toBe('NEW');

    const tagged = await as(hr.token).post('/api/v1/assets', laptop({ assetTag: 'lap-100' }));
    expect(tagged.status).toBe(201);
    expect(tagged.body.data.assetTag).toBe('LAP-100');
    const dup = await as(hr.token).post('/api/v1/assets', laptop({ assetTag: 'LAP-100' }));
    expect(dup.status).toBe(409);

    // PATCH only touches provided fields (condition keeps its value).
    const upd = await as(hr.token).patch(`/api/v1/assets/${tagged.body.data._id}`, { notes: 'Spare charger included' });
    expect(upd.status).toBe(200);
    expect(upd.body.data.condition).toBe('NEW');
    expect(upd.body.data.notes).toBe('Spare charger included');

    // Plain employees cannot manage assets.
    expect((await as(emp.token).post('/api/v1/assets', laptop())).status).toBe(403);
    expect((await as(emp.token).post(`/api/v1/assets/${a.body.data._id}/assign`, { employeeId: emp.employee._id, assignedDate: '2024-03-01' })).status).toBe(403);
  });

  it('assigns, returns, repairs and retires with full history', async () => {
    const created = await as(hr.token).post('/api/v1/assets', laptop());
    const id = created.body.data._id;

    const assign = await as(hr.token).post(`/api/v1/assets/${id}/assign`, {
      employeeId: emp.employee._id,
      assignedDate: '2024-03-01',
      condition: 'GOOD',
    });
    expect(assign.status).toBe(200);
    expect(assign.body.data.status).toBe('ASSIGNED');
    expect(assign.body.data.currentEmployeeId._id).toBe(emp.employee._id);
    expect(await AuditLogModel.exists({ action: 'ASSET_ASSIGNED', recordId: id })).toBeTruthy();
    expect(await NotificationModel.exists({ type: 'ASSET', entityId: id })).toBeTruthy();

    // Already assigned → cannot be assigned again.
    const again = await as(hr.token).post(`/api/v1/assets/${id}/assign`, { employeeId: other.employee._id, assignedDate: '2024-03-02' });
    expect(again.status).toBe(422);
    // Status endpoint cannot bypass the return flow.
    expect((await as(hr.token).post(`/api/v1/assets/${id}/status`, { status: 'AVAILABLE' })).status).toBe(422);
    // Cannot delete an assigned asset.
    expect((await as(admin.token).delete(`/api/v1/assets/${id}`)).status).toBe(422);

    // Employee sees their own assets only.
    const mine = await as(emp.token).get('/api/v1/assets/mine');
    expect(mine.body.data.map((a: { assetId: { _id: string } }) => a.assetId._id)).toContain(id);
    const scoped = await as(emp.token).get('/api/v1/assets');
    expect(scoped.status).toBe(200);
    expect(scoped.body.data.map((a: { _id: string }) => a._id)).toEqual([id]);
    expect((await as(emp.token).get(`/api/v1/assets/${id}`)).status).toBe(200);
    expect((await as(other.token).get(`/api/v1/assets/${id}`)).status).toBe(403);
    expect((await as(other.token).get('/api/v1/assets?scope=all')).status).toBe(403);

    // Return damaged → goes to repair.
    const ret = await as(hr.token).post(`/api/v1/assets/${id}/return`, { returnedDate: '2024-06-01', condition: 'DAMAGED', notes: 'Cracked screen' });
    expect(ret.status).toBe(200);
    expect(ret.body.data.status).toBe('REPAIR');
    expect(ret.body.data.currentEmployeeId).toBeNull();
    expect(await AuditLogModel.exists({ action: 'ASSET_RETURNED', recordId: id })).toBeTruthy();
    expect((await as(emp.token).get('/api/v1/assets/mine')).body.data).toHaveLength(0);

    // Repair → available → retired; retired cannot be assigned.
    expect((await as(hr.token).post(`/api/v1/assets/${id}/status`, { status: 'AVAILABLE', notes: 'Screen replaced' })).body.data.status).toBe('AVAILABLE');
    expect((await as(hr.token).post(`/api/v1/assets/${id}/status`, { status: 'RETIRED' })).body.data.status).toBe('RETIRED');
    const retiredAssign = await as(hr.token).post(`/api/v1/assets/${id}/assign`, { employeeId: emp.employee._id, assignedDate: '2024-07-01' });
    expect(retiredAssign.status).toBe(422);
    expect(retiredAssign.body.code).toBe('INVALID_TRANSITION');
    expect((await as(hr.token).post(`/api/v1/assets/${id}/status`, { status: 'AVAILABLE' })).status).toBe(422);

    const detail = await as(hr.token).get(`/api/v1/assets/${id}`);
    expect(detail.body.data.assignments).toHaveLength(1);
    expect(detail.body.data.assignments[0]).toMatchObject({ status: 'RETURNED', conditionAtReturn: 'DAMAGED', returnNotes: 'Cracked screen' });
    expect(detail.body.data.statusHistory.map((h: { to: string }) => h.to)).toEqual(['AVAILABLE', 'ASSIGNED', 'REPAIR', 'AVAILABLE', 'RETIRED']);

    const history = await as(hr.token).get(`/api/v1/assets/assignments?employeeId=${emp.employee._id}`);
    expect(history.body.data.some((a: { assetId: { _id: string } }) => a.assetId._id === id)).toBe(true);
    expect((await as(other.token).get(`/api/v1/assets/assignments?employeeId=${emp.employee._id}`)).status).toBe(403);

    expect((await as(admin.token).delete(`/api/v1/assets/${id}`)).status).toBe(200);
    expect((await as(hr.token).get(`/api/v1/assets/${id}`)).status).toBe(404);
  });

  it('validates assignment targets and dates', async () => {
    const created = await as(hr.token).post('/api/v1/assets', laptop());
    const id = created.body.data._id;
    const foreign = await registerOrg();
    const stranger = await createEmployeeUser(foreign.token, { firstName: 'Stranger' });
    expect((await as(hr.token).post(`/api/v1/assets/${id}/assign`, { employeeId: stranger.employee._id, assignedDate: '2024-03-01' })).status).toBe(400);
    const badDates = await as(hr.token).post(`/api/v1/assets/${id}/assign`, {
      employeeId: emp.employee._id,
      assignedDate: '2024-03-01',
      expectedReturnDate: '2024-02-01',
    });
    expect(badDates.status).toBe(400);
    await as(hr.token).post(`/api/v1/assets/${id}/assign`, { employeeId: emp.employee._id, assignedDate: '2024-03-01' });
    const early = await as(hr.token).post(`/api/v1/assets/${id}/return`, { returnedDate: '2024-02-01', condition: 'GOOD' });
    expect(early.status).toBe(400);
    const ok = await as(hr.token).post(`/api/v1/assets/${id}/return`, { returnedDate: '2024-03-10', condition: 'GOOD' });
    expect(ok.body.data.status).toBe('AVAILABLE');

    // Tenant isolation.
    expect((await as(foreign.token).get(`/api/v1/assets/${id}`)).status).toBe(404);
    expect((await as(foreign.token).post(`/api/v1/assets/${id}/assign`, { employeeId: stranger.employee._id, assignedDate: '2024-03-01' })).status).toBe(404);
  });

  it('summarizes assets by status and category', async () => {
    const res = await as(hr.token).get('/api/v1/assets/summary');
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBeGreaterThanOrEqual(3);
    expect(res.body.data.totalValue).toBe(res.body.data.total * 2000);
    expect(res.body.data.byCategory.find((c: { category: string }) => c.category === 'LAPTOP').count).toBe(res.body.data.total);
    expect((await as(emp.token).get('/api/v1/assets/summary')).status).toBe(403);
  });

  it('clears optional asset fields with null; required fields and the tag cannot be cleared', async () => {
    const created = await as(hr.token).post('/api/v1/assets', laptop({ warrantyExpiry: '2027-02-01', vendor: 'Acme' }));
    const id = created.body.data._id as string;
    const cleared = await as(hr.token).patch(`/api/v1/assets/${id}`, { purchaseDate: null, warrantyExpiry: null, purchaseCost: null, vendor: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.purchaseDate ?? null).toBeNull();
    expect(cleared.body.data.warrantyExpiry ?? null).toBeNull();
    expect(cleared.body.data.purchaseCost ?? null).toBeNull();
    expect(cleared.body.data.vendor ?? null).toBeNull();
    // Omitted fields are untouched.
    expect(cleared.body.data.brand).toBe('Apple');
    expect(cleared.body.data.assetTag).toBe(created.body.data.assetTag);

    expect((await as(hr.token).patch(`/api/v1/assets/${id}`, { name: null })).status).toBe(400);
    expect((await as(hr.token).patch(`/api/v1/assets/${id}`, { assetTag: null })).status).toBe(400);
    expect((await as(hr.token).patch(`/api/v1/assets/${id}`, { category: null })).status).toBe(400);
  });

  it('searches assignments by asset tag/name/serial and employee name/code; notifications deep-link to the asset', async () => {
    const holder = await createEmployeeUser(admin.token, { firstName: 'Quintessa' });
    const created = await as(hr.token).post('/api/v1/assets', laptop({ name: 'ThinkPad X1 Carbon', serialNumber: 'SER-ZX-9981' }));
    const id = created.body.data._id as string;
    const tag = created.body.data.assetTag as string;
    expect((await as(hr.token).post(`/api/v1/assets/${id}/assign`, { employeeId: holder.employee._id, assignedDate: '2024-04-01' })).status).toBe(200);

    const ids = async (search: string) => {
      const res = await as(hr.token).get(`/api/v1/assets/assignments?search=${encodeURIComponent(search)}`);
      expect(res.status).toBe(200);
      return res.body.data.map((a: { assetId: { _id: string } }) => a.assetId._id) as string[];
    };
    expect(await ids(tag)).toEqual([id]);
    expect(await ids('thinkpad x1')).toEqual([id]);
    expect(await ids('SER-ZX')).toEqual([id]);
    expect(await ids('quintessa')).toEqual([id]);
    expect(await ids(holder.employee.employeeId)).toEqual([id]);
    expect(await ids('no-such-thing-xyz')).toEqual([]);

    const notification = await NotificationModel.findOne({ type: 'ASSET', entityId: id, title: 'Asset assigned to you' }).lean();
    expect(notification?.link).toBe(`/assets/${id}`);
    await as(hr.token).post(`/api/v1/assets/${id}/return`, { returnedDate: '2024-04-10', condition: 'GOOD' });
    const returned = await NotificationModel.findOne({ type: 'ASSET', entityId: id, title: 'Asset returned' }).lean();
    expect(returned?.link).toBe(`/assets/${id}`);
  });
});
