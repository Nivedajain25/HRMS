import { Types } from 'mongoose';
import { beforeAll, describe, expect, it } from 'vitest';
import { runBirthdayReminders } from '../../src/jobs/reminders';
import { AnnouncementModel, EmployeeModel, JobRunModel, NotificationModel } from '../../src/models';
import { publishDueAnnouncements } from '../../src/services/announcement.service';
import { sentEmails } from '../../src/services/email.service';
import { notify } from '../../src/services/notification.service';
import { dateOnly, todayKey } from '../../src/utils/dates';
import { excerpt, sanitizeHtml } from '../../src/utils/sanitize-html';
import { as, createEmployeeUser, registerOrg } from '../helpers';

describe('HTML sanitizer', () => {
  it('keeps allowed formatting', () => {
    const html = '<h2>Title</h2><p>Hello <strong>bold</strong> <em>it</em> <u>u</u> <s>s</s></p><ul><li>one</li></ul><ol><li>two</li></ol><blockquote>q</blockquote><pre><code>x = 1</code></pre><hr><br/>';
    expect(sanitizeHtml(html)).toBe(
      '<h2>Title</h2><p>Hello <strong>bold</strong> <em>it</em> <u>u</u> <s>s</s></p><ul><li>one</li></ul><ol><li>two</li></ol><blockquote>q</blockquote><pre><code>x = 1</code></pre><hr><br>',
    );
  });

  it.each([
    ['<script>alert(1)</script><p>ok</p>', '<p>ok</p>'],
    ['<img src=x onerror=alert(1)>text', 'text'],
    ['<p onclick="alert(1)" style="color:red">hi</p>', '<p>hi</p>'],
    ['<a href="javascript:alert(1)">x</a>', '<a>x</a>'],
    ['<a href="JaVaScRiPt:alert(1)">x</a>', '<a>x</a>'],
    ['<a href="java&#115;cript:alert(1)">x</a>', '<a>x</a>'],
    ['<a href="&#x6A;avascript&#58;alert(1)">x</a>', '<a>x</a>'],
    ['<a href=" javascript:alert(1)">x</a>', '<a>x</a>'],
    ['<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>', '<a>x</a>'],
    ['<a href="vbscript:msgbox(1)">x</a>', '<a>x</a>'],
    ['<iframe src="https://evil.test"></iframe>after', 'after'],
    ['<svg onload=alert(1)><circle/></svg>ok', 'ok'],
    ['<style>body{display:none}</style>ok', 'ok'],
    ['<scr<script>ipt>alert(1)</script>', '&lt;scr'],
    ['<!-- <script>alert(1)</script> -->ok', 'ok'],
    ['<p>unclosed <strong>bold', '<p>unclosed <strong>bold</strong></p>'],
    ['</p>stray close', 'stray close'],
    ['<p/onclick=alert(1)>x', '&lt;p/onclick=alert(1)&gt;x'],
    ['a < b && c > d', 'a &lt; b &amp;&amp; c &gt; d'],
    ['<math><mi xlink:href="javascript:alert(1)">x</mi></math>y', 'y'],
    ['<form action="https://evil.test"><input name=a></form>t', 't'],
  ])('neutralizes %s', (input, expected) => {
    expect(sanitizeHtml(input)).toBe(expected);
  });

  it('forces safe link attributes and keeps http/https/mailto', () => {
    expect(sanitizeHtml('<a href="https://example.test/a?b=1&amp;c=2" onclick="x" target="_self">l</a>')).toBe(
      '<a href="https://example.test/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">l</a>',
    );
    expect(sanitizeHtml("<a href='mailto:hr@example.test'>m</a>")).toBe('<a href="mailto:hr@example.test" target="_blank" rel="noopener noreferrer">m</a>');
    expect(sanitizeHtml('<a href="http://x.test/&quot;onmouseover=&quot;alert(1)">l</a>')).toBe(
      '<a href="http://x.test/&quot;onmouseover=&quot;alert(1)" target="_blank" rel="noopener noreferrer">l</a>',
    );
  });

  it('builds plain-text excerpts', () => {
    expect(excerpt('<p>Hello&nbsp;<b>world</b></p><p>Again</p>')).toBe('Hello world Again');
    expect(excerpt(`<p>${'x'.repeat(300)}</p>`, 200)).toHaveLength(200);
  });
});

describe('Announcements & notifications', () => {
  let admin: Awaited<ReturnType<typeof registerOrg>>;
  let eng: Awaited<ReturnType<typeof createEmployeeUser>>;
  let sales: Awaited<ReturnType<typeof createEmployeeUser>>;
  let engDept: string;
  let salesDept: string;
  const userIdOf = (e: { employee: { userId: { _id: string } } }) => e.employee.userId._id;

  beforeAll(async () => {
    admin = await registerOrg();
    engDept = (await as(admin.token).post('/api/v1/departments', { name: 'Engineering', code: 'ENG' })).body.data._id;
    salesDept = (await as(admin.token).post('/api/v1/departments', { name: 'Sales', code: 'SAL' })).body.data._id;
    eng = await createEmployeeUser(admin.token, { firstName: 'Eng', departmentId: engDept });
    sales = await createEmployeeUser(admin.token, { firstName: 'Sal', departmentId: salesDept });
  });

  it('sanitizes content, targets departments and hides them from others', async () => {
    const all = await as(admin.token).post('/api/v1/announcements', {
      title: 'Company update',
      content: '<p>Hello <strong>all</strong></p><script>alert(1)</script><img src=x onerror=alert(1)>',
      priority: 'HIGH',
    });
    expect(all.status).toBe(201);
    expect(all.body.data.content).toBe('<p>Hello <strong>all</strong></p>');
    expect(all.body.data.status).toBe('PUBLISHED');

    const deptOnly = await as(admin.token).post('/api/v1/announcements', {
      title: 'Engineering only',
      content: '<p>Deploy freeze</p>',
      audience: 'DEPARTMENTS',
      departmentIds: [engDept],
    });
    expect(deptOnly.status).toBe(201);

    const engList = await as(eng.token).get('/api/v1/announcements');
    expect(engList.status).toBe(200);
    const engTitles = engList.body.data.map((a: { title: string }) => a.title);
    expect(engTitles).toEqual(expect.arrayContaining(['Company update', 'Engineering only']));
    expect(engList.body.data.every((a: { read: boolean }) => a.read === false)).toBe(true);

    const salesList = await as(sales.token).get('/api/v1/announcements');
    const salesTitles = salesList.body.data.map((a: { title: string }) => a.title);
    expect(salesTitles).toContain('Company update');
    expect(salesTitles).not.toContain('Engineering only');
    expect((await as(sales.token).get(`/api/v1/announcements/${deptOnly.body.data._id}`)).status).toBe(404);
    expect((await as(sales.token).post(`/api/v1/announcements/${deptOnly.body.data._id}/read`)).status).toBe(404);

    // Published → targeted users notified in-app.
    const engNotifs = await NotificationModel.find({ userId: userIdOf(eng), type: 'ANNOUNCEMENT' }).lean();
    expect(engNotifs.map((n) => n.title)).toEqual(expect.arrayContaining(['Company update', 'Engineering only']));
    const salesNotifs = await NotificationModel.find({ userId: userIdOf(sales), type: 'ANNOUNCEMENT' }).lean();
    expect(salesNotifs.map((n) => n.title)).not.toContain('Engineering only');
  });

  it('validates targets and requires announcement:manage', async () => {
    expect((await as(eng.token).post('/api/v1/announcements', { title: 'x', content: '<p>x</p>' })).status).toBe(403);
    expect((await as(eng.token).get('/api/v1/announcements?scope=all')).status).toBe(403);
    const bad = await as(admin.token).post('/api/v1/announcements', {
      title: 'Bad',
      content: '<p>x</p>',
      audience: 'DEPARTMENTS',
      departmentIds: [new Types.ObjectId().toString()],
    });
    expect(bad.status).toBe(400);
    const empty = await as(admin.token).post('/api/v1/announcements', { title: 'Empty', content: '<script>x</script>' });
    expect(empty.status).toBe(400);
  });

  it('tracks reads idempotently and reports read stats', async () => {
    const a = await as(admin.token).post('/api/v1/announcements', {
      title: 'Read me',
      content: '<p>Tracking</p>',
      audience: 'EMPLOYEES',
      employeeIds: [eng.employee._id, sales.employee._id],
    });
    const id = a.body.data._id;
    expect((await as(eng.token).post(`/api/v1/announcements/${id}/read`)).status).toBe(200);
    expect((await as(eng.token).post(`/api/v1/announcements/${id}/read`)).status).toBe(200);
    const one = await as(eng.token).get(`/api/v1/announcements/${id}`);
    expect(one.body.data.read).toBe(true);

    const stats = await as(admin.token).get(`/api/v1/announcements/${id}/reads`);
    expect(stats.status).toBe(200);
    expect(stats.body.data).toMatchObject({ total: 2, read: 1, unread: 1, readPercent: 50 });
    expect((await as(eng.token).get(`/api/v1/announcements/${id}/reads`)).status).toBe(403);

    const managed = await as(admin.token).get('/api/v1/announcements?scope=all');
    expect(managed.body.data.find((x: { _id: string }) => x._id === id).readCount).toBe(1);
  });

  it('schedules announcements and publishes them via the job (email when requested)', async () => {
    const publishAt = new Date(Date.now() + 3_600_000).toISOString();
    const a = await as(admin.token).post('/api/v1/announcements', {
      title: 'Scheduled news',
      content: '<p>Coming <b>soon</b> to everyone</p>',
      publishAt,
      sendEmail: true,
      priority: 'URGENT',
    });
    expect(a.status).toBe(201);
    expect(a.body.data.status).toBe('SCHEDULED');
    const id = a.body.data._id;
    expect((await as(eng.token).get('/api/v1/announcements')).body.data.map((x: { _id: string }) => x._id)).not.toContain(id);
    expect((await as(admin.token).get('/api/v1/announcements?scope=all')).body.data.find((x: { _id: string }) => x._id === id).status).toBe('SCHEDULED');

    // PATCH only touches provided fields (priority stays URGENT).
    const patched = await as(admin.token).patch(`/api/v1/announcements/${id}`, { pinned: true });
    expect(patched.status).toBe(200);
    expect(patched.body.data).toMatchObject({ pinned: true, priority: 'URGENT', audience: 'ALL', sendEmail: true });

    await AnnouncementModel.updateOne({ _id: id }, { publishAt: new Date(Date.now() - 1000) });
    const res = await publishDueAnnouncements();
    expect(res.published).toBeGreaterThanOrEqual(1);
    expect((await publishDueAnnouncements()).published).toBe(0);

    const doc = await AnnouncementModel.findById(id).lean();
    expect(doc!.notifiedAt).toBeTruthy();
    expect(await NotificationModel.countDocuments({ userId: userIdOf(eng), entityId: id })).toBe(1);
    const mail = sentEmails.find((m) => m.to === eng.email && m.template === 'announcement');
    expect(mail?.text).toContain('Coming soon to everyone');
    const list = await as(eng.token).get('/api/v1/announcements');
    expect(list.body.data[0]._id).toBe(id); // pinned first
  });

  it('lists, counts, reads and deletes my notifications only', async () => {
    const orgId = new Types.ObjectId(admin.user.organization._id);
    await NotificationModel.deleteMany({ userId: userIdOf(sales) });
    for (let i = 0; i < 3; i++) {
      await notify({ organizationId: orgId, userIds: [userIdOf(sales)], type: 'GENERAL', title: `Note ${i}`, message: 'Hello' });
    }
    await notify({ organizationId: orgId, userIds: [userIdOf(eng)], type: 'GENERAL', title: 'Not yours', message: 'x' });

    const list = await as(sales.token).get('/api/v1/notifications?limit=2');
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(2);
    expect(list.body.pagination.total).toBe(3);
    expect((await as(sales.token).get('/api/v1/notifications/unread-count')).body.data.count).toBe(3);

    const first = list.body.data[0]._id;
    const read = await as(sales.token).post(`/api/v1/notifications/${first}/read`);
    expect(read.status).toBe(200);
    expect(read.body.data.readAt).toBeTruthy();
    expect((await as(sales.token).get('/api/v1/notifications?unread=true')).body.pagination.total).toBe(2);

    const others = await NotificationModel.findOne({ userId: userIdOf(eng), title: 'Not yours' }).lean();
    expect((await as(sales.token).post(`/api/v1/notifications/${others!._id}/read`)).status).toBe(404);
    expect((await as(sales.token).delete(`/api/v1/notifications/${others!._id}`)).status).toBe(404);

    const all = await as(sales.token).post('/api/v1/notifications/read-all');
    expect(all.body.data.updated).toBe(2);
    expect((await as(sales.token).get('/api/v1/notifications/unread-count')).body.data.count).toBe(0);

    expect((await as(sales.token).delete(`/api/v1/notifications/${first}`)).status).toBe(200);
    expect((await as(sales.token).get('/api/v1/notifications')).body.pagination.total).toBe(2);
  });

  it('merges notification preferences with defaults and applies them', async () => {
    const prefs = await as(sales.token).get('/api/v1/notifications/preferences');
    expect(prefs.status).toBe(200);
    expect(prefs.body.data).toHaveLength(16);
    expect(prefs.body.data.find((p: { type: string }) => p.type === 'LEAVE_APPROVED')).toEqual({ type: 'LEAVE_APPROVED', inApp: true, email: true });
    expect(prefs.body.data.find((p: { type: string }) => p.type === 'ANNOUNCEMENT')).toEqual({ type: 'ANNOUNCEMENT', inApp: true, email: false });

    const put = await as(sales.token).put('/api/v1/notifications/preferences', { preferences: [{ type: 'GENERAL', inApp: false, email: true }] });
    expect(put.status).toBe(200);
    expect(put.body.data.find((p: { type: string }) => p.type === 'GENERAL')).toEqual({ type: 'GENERAL', inApp: false, email: true });
    expect(put.body.data.find((p: { type: string }) => p.type === 'LEAVE_APPROVED').email).toBe(true);
    expect((await as(sales.token).put('/api/v1/notifications/preferences', { preferences: [{ type: 'NOPE', inApp: true, email: true }] })).status).toBe(400);

    const orgId = new Types.ObjectId(admin.user.organization._id);
    const before = await NotificationModel.countDocuments({ userId: userIdOf(sales) });
    await notify({ organizationId: orgId, userIds: [userIdOf(sales)], type: 'GENERAL', title: 'Muted in-app', message: 'Email only' });
    expect(await NotificationModel.countDocuments({ userId: userIdOf(sales) })).toBe(before);
    expect(sentEmails.some((m) => m.to === sales.email && m.subject === 'Muted in-app')).toBe(true);
  });

  it('posts a pinned birthday announcement for everyone, once per day', async () => {
    const orgId = new Types.ObjectId(admin.user.organization._id);
    const today = todayKey('UTC');
    await EmployeeModel.updateOne({ _id: eng.employee._id }, { dateOfBirth: dateOnly(`1990-${today.slice(5)}`) });
    const first = await runBirthdayReminders({ force: true, organizationId: orgId });
    expect(first.notified).toBeGreaterThanOrEqual(1);
    const post = await AnnouncementModel.findOne({ organizationId: orgId, title: /^🎂 Happy Birthday, Eng/ }).lean();
    expect(post?.pinned).toBe(true);
    expect(post?.audience).toBe('ALL');
    // Everyone (here: another employee) gets the announcement notification.
    const n = await NotificationModel.findOne({ userId: userIdOf(sales), type: 'ANNOUNCEMENT', title: /Happy Birthday, Eng/ }).lean();
    expect(n).toBeTruthy();
    expect(await JobRunModel.countDocuments({ key: `birthdays:${orgId}:${today}` })).toBe(1);
    expect((await runBirthdayReminders({ force: true, organizationId: orgId })).notified).toBe(0);
  });
});

describe('Announcement highlights (pop-up + pinned bar)', () => {
  let admin: Awaited<ReturnType<typeof registerOrg>>;
  let emp: Awaited<ReturnType<typeof createEmployeeUser>>;
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
  const create = async (title: string, extra: Record<string, unknown> = {}) => {
    const res = await as(admin.token).post('/api/v1/announcements', { title, content: `<p>${title} body</p>`, ...extra });
    expect(res.status).toBe(201);
    return res.body.data._id as string;
  };
  const titles = (items: { title: string }[]) => items.map((i) => i.title);

  beforeAll(async () => {
    admin = await registerOrg();
    emp = await createEmployeeUser(admin.token, { firstName: 'Ria' });
  });

  it('pops up unread announcements once, then keeps them pinned at the top', async () => {
    const normal = await create('Office party');
    const urgent = await create('Fire drill', { priority: 'URGENT' });
    const pinnedOld = await create('Holiday policy', { pinned: true });
    const old = await create('Old news');
    await AnnouncementModel.updateOne({ _id: pinnedOld }, { publishAt: daysAgo(30) });
    await AnnouncementModel.updateOne({ _id: old }, { publishAt: daysAgo(10) });
    const expired = await create('Gone');
    await AnnouncementModel.updateOne({ _id: expired }, { publishAt: daysAgo(3), expiresAt: daysAgo(1) });

    const h = await as(emp.token).get('/api/v1/announcements/highlights');
    expect(h.status).toBe(200);
    // Urgent first; older than 14 days (the pinned one) and expired never pop up.
    expect(titles(h.body.data.popup)).toEqual(['Fire drill', 'Old news', 'Office party']);
    expect(h.body.data.popup[0]).toMatchObject({ read: false, excerpt: 'Fire drill body' });
    // Bar: pinned (any age) first, then the last 7 days newest first; 10-day-old non-pinned and expired are out.
    expect(titles(h.body.data.bar)).toEqual(['Holiday policy', 'Fire drill', 'Office party']);

    // "Got it" = mark read → no longer pops up, still pinned in the bar.
    expect((await as(emp.token).post(`/api/v1/announcements/${urgent}/read`)).status).toBe(200);
    expect((await as(emp.token).post(`/api/v1/announcements/${normal}/read`)).status).toBe(200);
    const after = await as(emp.token).get('/api/v1/announcements/highlights');
    expect(titles(after.body.data.popup)).toEqual(['Old news']);
    expect(titles(after.body.data.bar)).toEqual(['Holiday policy', 'Fire drill', 'Office party']);
    expect(after.body.data.bar.find((a: { title: string }) => a.title === 'Fire drill').read).toBe(true);

    // The author never gets a pop-up for their own announcement.
    const own = await as(admin.token).get('/api/v1/announcements/highlights');
    expect(own.body.data.popup).toEqual([]);
    expect(titles(own.body.data.bar)).toContain('Office party');
  });
});
