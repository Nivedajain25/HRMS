import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { AuditLogModel, DocumentModel, NotificationModel } from '../../src/models';
import { runDocumentExpiryReminders } from '../../src/services/document.service';
import { as, createEmployeeUser, getApp, registerOrg } from '../helpers';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

/** Downloads a binary response into a Buffer. */
const fetchFile = (token: string, url: string) =>
  request(getApp())
    .get(url)
    .set('Authorization', `Bearer ${token}`)
    .buffer(true)
    .parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(Buffer.from(c)));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });

const uploadDoc = (token: string, fields: Record<string, string>, file = PDF, name = 'passport.pdf') => {
  let req = as(token).upload('/api/v1/documents');
  for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
  return req.attach('file', file, name);
};

const daysFromNow = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

describe('Documents & file storage', () => {
  let admin: Awaited<ReturnType<typeof registerOrg>>;
  let manager: Awaited<ReturnType<typeof createEmployeeUser>>;
  let emp: Awaited<ReturnType<typeof createEmployeeUser>>;
  let other: Awaited<ReturnType<typeof createEmployeeUser>>;
  let hr: Awaited<ReturnType<typeof createEmployeeUser>>;

  beforeAll(async () => {
    admin = await registerOrg();
    manager = await createEmployeeUser(admin.token, { firstName: 'Mgr', roles: ['manager'] });
    emp = await createEmployeeUser(admin.token, { firstName: 'Emp', managerId: manager.employee._id });
    other = await createEmployeeUser(admin.token, { firstName: 'Other' });
    hr = await createEmployeeUser(admin.token, { firstName: 'Hr', roles: ['hr_manager'] });
  });

  it('uploads, downloads and previews with safe headers and an opaque storage key', async () => {
    const up = await uploadDoc(emp.token, { title: 'Passport', category: 'IDENTITY', expiryDate: '2030-01-01' }, PDF, 'my "passport".pdf');
    expect(up.status).toBe(201);
    const doc = up.body.data;
    expect(doc.employeeId).toBe(emp.employee._id);
    expect(doc.mimeType).toBe('application/pdf');
    expect(doc.version).toBe(1);
    expect(doc.storageKey).toBeUndefined();

    const raw = await DocumentModel.findById(doc._id).lean();
    expect(raw?.storageKey).toMatch(new RegExp(`^${admin.user.organization._id}/\\d{4}/\\d{2}/[a-f0-9]{32}\\.pdf$`));
    expect(raw?.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(await AuditLogModel.exists({ action: 'DOCUMENT_UPLOADED', recordId: doc._id })).toBeTruthy();

    const dl = await fetchFile(emp.token, `/api/v1/files/${doc._id}`);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toBe('application/pdf');
    expect(dl.headers['content-disposition']).toBe('attachment; filename="my_passport.pdf"');
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
    expect(dl.headers['cache-control']).toBe('private, no-store');
    expect(Buffer.compare(dl.body as Buffer, PDF)).toBe(0);

    const preview = await fetchFile(emp.token, `/api/v1/files/${doc._id}?inline=1`);
    expect(preview.headers['content-disposition']).toMatch(/^inline;/);

    // No unauthenticated or static access.
    expect((await request(getApp()).get(`/api/v1/files/${doc._id}`)).status).toBe(401);
    expect((await request(getApp()).get(`/uploads/${raw?.storageKey}`)).status).toBe(404);
  });

  it('rejects files whose content does not match an allowed type', async () => {
    const fake = await uploadDoc(emp.token, { title: 'Fake', category: 'OTHER' }, Buffer.from('just some text, not a pdf'), 'fake.pdf');
    expect(fake.status).toBe(400);
    expect(fake.body.code).toBe('UNSUPPORTED_FILE_TYPE');
    const missing = await as(emp.token).upload('/api/v1/documents').field('title', 'x').field('category', 'OTHER');
    expect(missing.status).toBe(400);
    expect(missing.body.code).toBe('FILE_REQUIRED');
  });

  it('versions documents and lists only the latest version', async () => {
    const v1 = await uploadDoc(emp.token, { title: 'Degree', category: 'CERTIFICATE' });
    const v2 = await uploadDoc(emp.token, { title: 'Degree (updated)', category: 'CERTIFICATE', parentDocumentId: v1.body.data._id });
    expect(v2.status).toBe(201);
    expect(v2.body.data.version).toBe(2);
    expect(v2.body.data.rootDocumentId).toBe(v1.body.data._id);

    const list = await as(emp.token).get('/api/v1/documents?category=CERTIFICATE');
    expect(list.body.data.map((d: { _id: string }) => d._id)).toEqual([v2.body.data._id]);

    const versions = await as(emp.token).get(`/api/v1/documents/${v2.body.data._id}/versions`);
    expect(versions.body.data.map((d: { version: number }) => d.version)).toEqual([2, 1]);
    const meta = await as(emp.token).get(`/api/v1/documents/${v1.body.data._id}`);
    expect(meta.status).toBe(200);
    expect(meta.body.data.isLatest).toBe(false);
    expect(meta.body.data.versions).toHaveLength(2);

    // Someone else cannot add a version to my document.
    const hijack = await uploadDoc(other.token, { title: 'x', category: 'CERTIFICATE', parentDocumentId: v2.body.data._id });
    expect(hijack.status).toBe(403);
  });

  it('verifies documents (HR) and enforces delete rules', async () => {
    const up = await uploadDoc(emp.token, { title: 'Tax form', category: 'TAX' });
    const id = up.body.data._id;
    expect((await as(emp.token).post(`/api/v1/documents/${id}/verify`, { status: 'VERIFIED' })).status).toBe(403);
    const ver = await as(hr.token).post(`/api/v1/documents/${id}/verify`, { status: 'VERIFIED', note: 'Looks good' });
    expect(ver.status).toBe(200);
    expect(ver.body.data.verificationStatus).toBe('VERIFIED');
    expect(await AuditLogModel.exists({ action: 'DOCUMENT_VERIFIED', recordId: id })).toBeTruthy();
    // The notification deep-links to the document.
    const note = await NotificationModel.findOne({ entityId: id, title: 'Document verified' }).lean();
    expect(note?.link).toBe(`/documents?highlight=${id}`);

    // Verified: the uploader can no longer delete it; document:delete holders can.
    expect((await as(emp.token).delete(`/api/v1/documents/${id}`)).status).toBe(403);
    expect((await as(admin.token).delete(`/api/v1/documents/${id}`)).status).toBe(200);
    expect((await as(emp.token).get(`/api/v1/documents/${id}`)).status).toBe(404);
    expect(await AuditLogModel.exists({ action: 'DOCUMENT_DELETED', recordId: id })).toBeTruthy();

    // Unverified own upload: deletable by the uploader within 24h (object kept in storage).
    const mine = await uploadDoc(emp.token, { title: 'Scratch', category: 'OTHER' });
    expect((await as(emp.token).delete(`/api/v1/documents/${mine.body.data._id}`)).status).toBe(200);
    expect((await DocumentModel.findById(mine.body.data._id).lean())?.deletedAt).toBeTruthy();
  });

  it('denies other employees and hides confidential documents from managers', async () => {
    const open = await uploadDoc(emp.token, { title: 'Certificate', category: 'CERTIFICATE' });
    const secret = await uploadDoc(emp.token, { title: 'Medical', category: 'OTHER', confidential: 'true' });
    expect(secret.body.data.confidential).toBe(true);

    // Unrelated employee: no access to either.
    expect((await fetchFile(other.token, `/api/v1/files/${open.body.data._id}`)).status).toBe(403);
    expect((await as(other.token).get(`/api/v1/documents/${open.body.data._id}`)).status).toBe(403);
    expect((await as(other.token).get(`/api/v1/documents?employeeId=${emp.employee._id}`)).status).toBe(403);

    // Manager: team documents except confidential ones.
    expect((await fetchFile(manager.token, `/api/v1/files/${open.body.data._id}`)).status).toBe(200);
    expect((await fetchFile(manager.token, `/api/v1/files/${secret.body.data._id}`)).status).toBe(403);
    const teamList = await as(manager.token).get(`/api/v1/documents?employeeId=${emp.employee._id}&limit=100`);
    const ids = teamList.body.data.map((d: { _id: string }) => d._id);
    expect(ids).toContain(open.body.data._id);
    expect(ids).not.toContain(secret.body.data._id);

    // HR (document:read) sees everything.
    expect((await fetchFile(hr.token, `/api/v1/files/${secret.body.data._id}`)).status).toBe(200);
  });

  it('isolates tenants', async () => {
    const foreign = await registerOrg();
    const up = await uploadDoc(emp.token, { title: 'Contract', category: 'EMPLOYMENT_AGREEMENT' });
    expect((await fetchFile(foreign.token, `/api/v1/files/${up.body.data._id}`)).status).toBe(404);
    expect((await as(foreign.token).get(`/api/v1/documents/${up.body.data._id}`)).status).toBe(404);
    expect((await as(foreign.token).delete(`/api/v1/documents/${up.body.data._id}`)).status).toBe(404);
    const list = await as(foreign.token).get('/api/v1/documents?limit=100');
    expect(list.body.data).toHaveLength(0);
    // Cannot upload for an employee of another organization.
    const cross = await uploadDoc(foreign.token, { title: 'x', category: 'OTHER', employeeId: emp.employee._id });
    expect(cross.status).toBe(400);
  });

  it('supports organization-level policy documents readable by everyone', async () => {
    expect((await uploadDoc(emp.token, { title: 'Handbook', category: 'POLICY' })).status).toBe(403);
    const policy = await uploadDoc(admin.token, { title: 'Employee handbook', category: 'POLICY' });
    expect(policy.status).toBe(201);
    expect(policy.body.data.employeeId).toBeNull();
    const list = await as(other.token).get('/api/v1/documents?limit=100');
    expect(list.body.data.map((d: { _id: string }) => d._id)).toContain(policy.body.data._id);
    expect((await fetchFile(other.token, `/api/v1/files/${policy.body.data._id}`)).status).toBe(200);
    // Uploading for someone else requires document:create.
    expect((await uploadDoc(other.token, { title: 'x', category: 'OTHER', employeeId: emp.employee._id })).status).toBe(403);
    expect((await uploadDoc(hr.token, { title: 'Offer', category: 'OFFER_LETTER', employeeId: emp.employee._id })).status).toBe(201);
  });

  it('handles generic attachments and profile photos', async () => {
    const receipt = await as(emp.token).upload('/api/v1/files').field('context', 'EXPENSE').attach('file', PDF, 'receipt.pdf');
    expect(receipt.status).toBe(201);
    expect(receipt.body.data.context).toBe('EXPENSE');
    expect(receipt.body.data.employeeId).toBe(emp.employee._id);
    expect(receipt.body.data.url).toBe(`/api/v1/files/${receipt.body.data._id}`);
    // Receipts are not visible to unrelated employees, nor listed as library documents.
    expect((await fetchFile(other.token, `/api/v1/files/${receipt.body.data._id}`)).status).toBe(403);
    expect((await as(emp.token).get(`/api/v1/documents/${receipt.body.data._id}`)).status).toBe(404);

    // Resumes require recruitment permissions.
    expect((await as(emp.token).upload('/api/v1/files').field('context', 'RESUME').attach('file', PDF, 'cv.pdf')).status).toBe(403);

    // Avatars must be images.
    const badAvatar = await as(emp.token).upload(`/api/v1/employees/${emp.employee._id}/photo`).attach('file', PDF, 'me.png');
    expect(badAvatar.status).toBe(400);
    expect(badAvatar.body.code).toBe('UNSUPPORTED_FILE_TYPE');
    const photo = await as(emp.token).upload(`/api/v1/employees/${emp.employee._id}/photo`).attach('file', PNG, 'me.png');
    expect(photo.status).toBe(200);
    expect(photo.body.data.profilePhoto).toMatch(/^\/api\/v1\/files\/[a-f0-9]{24}$/);
    // Anyone in the organization can see it; nobody else can change it.
    const img = await fetchFile(other.token, photo.body.data.profilePhoto);
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect((await as(other.token).upload(`/api/v1/employees/${emp.employee._id}/photo`).attach('file', PNG, 'x.png')).status).toBe(403);
    expect((await as(admin.token).upload(`/api/v1/employees/${emp.employee._id}/photo`).attach('file', PNG, 'x.png')).status).toBe(200);
  });

  it('lists expiring documents and sends expiry reminders once', async () => {
    const soon = await uploadDoc(emp.token, { title: 'Visa', category: 'IDENTITY', expiryDate: daysFromNow(5) });
    await uploadDoc(emp.token, { title: 'Licence', category: 'IDENTITY', expiryDate: daysFromNow(200) });
    const expiring = await as(hr.token).get('/api/v1/documents/expiring?days=30');
    expect(expiring.status).toBe(200);
    const visa = expiring.body.data.find((d: { _id: string }) => d._id === soon.body.data._id);
    expect(visa.daysLeft).toBe(5);
    expect(expiring.body.data.some((d: { title: string }) => d.title === 'Licence')).toBe(false);
    const filtered = await as(emp.token).get('/api/v1/documents?expiringWithinDays=10');
    expect(filtered.body.data.map((d: { _id: string }) => d._id)).toContain(soon.body.data._id);

    await runDocumentExpiryReminders();
    const reminded = await DocumentModel.findById(soon.body.data._id).lean();
    expect(reminded?.expiryNotifiedAt).toBeTruthy();
    const ownerNotes = await NotificationModel.countDocuments({ entityId: soon.body.data._id, type: 'DOCUMENT_EXPIRY' });
    expect(ownerNotes).toBeGreaterThanOrEqual(2); // owner + HR
    const expiryNote = await NotificationModel.findOne({ entityId: soon.body.data._id, type: 'DOCUMENT_EXPIRY' }).lean();
    expect(expiryNote?.link).toBe(`/documents?highlight=${soon.body.data._id}`);
    await runDocumentExpiryReminders();
    expect(await NotificationModel.countDocuments({ entityId: soon.body.data._id, type: 'DOCUMENT_EXPIRY' })).toBe(ownerNotes);
  });
});
