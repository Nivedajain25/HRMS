import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';

/**
 * Core HR journey from the product spec:
 * admin creates an employee → employee clocks in/out and applies for leave →
 * manager approves → the employee's balance updates → payroll is processed and
 * approved → the employee downloads a payslip.
 *
 * Uses the seeded demo organization (see apps/api/src/seed). Invited users
 * cannot set a password without email access, so the journey continues with
 * the seeded employee account.
 */

const PASSWORD = 'Demo@12345';
const USERS = {
  hr: 'hr@stencil-demo.test',
  employee: 'employee@stencil-demo.test',
  manager: 'manager@stencil-demo.test',
  payroll: 'payroll@stencil-demo.test',
  superadmin: 'superadmin@stencil-demo.test',
};
const API = 'http://localhost:5000/api/v1';

const apiToken = async (request: APIRequestContext, email: string) => {
  const res = await request.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { data: { accessToken: string } }).data.accessToken;
};

const apiGet = async <T>(request: APIRequestContext, token: string, path: string) => {
  const res = await request.get(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(res.ok(), `${path} → ${res.status()}`).toBeTruthy();
  return ((await res.json()) as { data: T }).data;
};

const signIn = async (browser: Browser, email: string): Promise<Page> => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  // Anchored so the "Show password" toggle doesn't match.
  await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
  return page;
};

/** Confirms a `useConfirm()` dialog if one opens. */
const confirmIfAsked = async (page: Page, name: RegExp) => {
  const button = page.getByRole('dialog').getByRole('button', { name });
  const shown = await button
    .waitFor({ state: 'visible', timeout: 3_000 })
    .then(() => true)
    .catch(() => false);
  if (shown) await button.click();
};

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

test.describe.serial('Stencil HRMS core journey', () => {
  const unique = Date.now().toString(36);
  let leaveDate = '';
  let leaveId = '';

  test('HR admin creates an employee', async ({ browser }) => {
    const page = await signIn(browser, USERS.hr);
    await page.goto('/employees');
    await page.getByRole('button', { name: 'Add employee' }).first().click();
    const drawer = page.getByRole('dialog', { name: 'Add employee' });
    await drawer.getByLabel('First name').fill('Playwright');
    await drawer.getByLabel('Last name').fill(`Tester ${unique}`);
    await drawer.getByLabel('Work email').fill(`pw.${unique}@stencil-demo.test`);
    await drawer.getByRole('button', { name: 'Create employee' }).click();
    await expect(page).toHaveURL(/\/employees\/[a-f0-9]{24}$/);
    await expect(page.getByRole('heading', { name: `Playwright Tester ${unique}` })).toBeVisible();
    await page.context().close();
  });

  test('employee clocks in and out', async ({ browser, request }) => {
    const page = await signIn(browser, USERS.employee);
    await page.goto('/attendance');
    const clockIn = page.getByRole('button', { name: 'Check in', exact: true });
    // Wait for the clock widget to settle in whichever state today's record is in.
    await expect(page.getByRole('button', { name: /^Check (in|out)$/ }).or(page.getByText(/day complete|checked out/i)).first()).toBeVisible({ timeout: 30_000 });
    if (await clockIn.isVisible()) {
      await clockIn.click();
      await confirmIfAsked(page, /check in/i);
    }
    // The seeded day may already be clocked in (or finished by an earlier run on a reused server).
    const clockOut = page.getByRole('button', { name: 'Check out', exact: true });
    const canClockOut = await clockOut
      .waitFor({ state: 'visible', timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (canClockOut) {
      await clockOut.click();
      await confirmIfAsked(page, /check out/i);
    }
    const token = await apiToken(request, USERS.employee);
    type Today = { record: { checkIn: string | null; checkOut: string | null; workingMinutes: number } | null };
    await expect.poll(async () => (await apiGet<Today>(request, token, '/attendance/today')).record?.checkOut ?? null).toBeTruthy();
    const today = await apiGet<Today>(request, token, '/attendance/today');
    expect(today.record?.checkIn).toBeTruthy();
    expect(today.record?.workingMinutes).toBeGreaterThanOrEqual(0);
    await page.context().close();
  });

  test('employee applies for leave', async ({ browser, request }) => {
    const token = await apiToken(request, USERS.employee);
    // Pick a working day ~3 weeks out that is not a holiday.
    const year = new Date().getUTCFullYear();
    const holidays = new Set<string>();
    for (const y of [year, year + 1]) {
      const rows = await apiGet<{ date: string }[]>(request, token, `/holidays?year=${y}`);
      rows.forEach((h) => holidays.add(h.date.slice(0, 10)));
    }
    // Skip days already covered by this employee's requests (keeps reruns on a reused server valid).
    const existing = await apiGet<{ startDate: string; endDate: string; status: string }[]>(request, token, '/leaves?scope=me&limit=100');
    const booked = (key: string) =>
      existing.some((l) => !['REJECTED', 'CANCELLED'].includes(l.status) && l.startDate.slice(0, 10) <= key && key <= l.endDate.slice(0, 10));
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 21);
    while ([0, 6].includes(d.getUTCDay()) || holidays.has(isoDate(d)) || booked(isoDate(d))) d.setUTCDate(d.getUTCDate() + 1);
    leaveDate = isoDate(d);

    const page = await signIn(browser, USERS.employee);
    await page.goto('/leave');
    await page.getByRole('button', { name: 'Apply leave' }).first().click();
    const drawer = page.getByRole('dialog');
    await drawer.getByRole('radio', { name: /Casual Leave/ }).check({ force: true });
    await drawer.getByRole('textbox', { name: 'From', exact: true }).fill(leaveDate);
    await drawer.getByRole('textbox', { name: 'To', exact: true }).fill(leaveDate);
    await drawer.getByRole('textbox', { name: 'Reason', exact: true }).fill(`Playwright leave ${unique}`);
    await expect(drawer.getByRole('region', { name: 'Leave preview' })).toContainText('1');
    await drawer.getByRole('button', { name: 'Submit request' }).click();
    await expect(drawer).toBeHidden();

    const mine = await apiGet<{ _id: string; reason: string; status: string }[]>(request, token, '/leaves?scope=me&limit=50');
    const created = mine.find((l) => l.reason === `Playwright leave ${unique}`);
    expect(created?.status).toBe('SUBMITTED');
    leaveId = created!._id;
    await page.context().close();
  });

  test('manager approves and the balance updates', async ({ browser, request }) => {
    const employeeToken = await apiToken(request, USERS.employee);
    type Balance = { leaveType: { code: string }; used: number; pending: number };
    const balanceYear = leaveDate.slice(0, 4);
    const before = (await apiGet<Balance[]>(request, employeeToken, `/leaves/balances?year=${balanceYear}`)).find((b) => b.leaveType.code === 'CL')!;
    expect(before.pending).toBeGreaterThanOrEqual(1);

    const page = await signIn(browser, USERS.manager);
    await page.goto('/leave?tab=approvals');
    await page.getByRole('button', { name: 'Approve leave for Ananya Sharma' }).first().click();
    await confirmIfAsked(page, /approve/i);
    await expect.poll(async () => (await apiGet<{ status: string }>(request, employeeToken, `/leaves/${leaveId}`)).status).toBe('APPROVED');

    const after = (await apiGet<Balance[]>(request, employeeToken, `/leaves/balances?year=${balanceYear}`)).find((b) => b.leaveType.code === 'CL')!;
    expect(after.used).toBe(before.used + 1);
    expect(after.pending).toBe(before.pending - 1);
    await page.context().close();
  });

  test('payroll is processed, approved and the payslip downloaded', async ({ browser, request }) => {
    const now = new Date();
    const month = now.getUTCMonth() + 1;
    const year = now.getUTCFullYear();

    const payrollToken = await apiToken(request, USERS.payroll);
    type Run = { _id: string; status: string; month: number; year: number; isOffCycle?: boolean };
    const findRun = async () =>
      (await apiGet<Run[]>(request, payrollToken, `/payroll?year=${year}&limit=50`)).find((r) => r.month === month && r.year === year && !r.isOffCycle && r.status !== 'CANCELLED');

    // Payroll admin creates (unless a rerun already did) and processes the run.
    const payroll = await signIn(browser, USERS.payroll);
    let run = await findRun();
    if (!run) {
      await payroll.goto('/payroll');
      await payroll.getByRole('button', { name: 'New payroll run' }).first().click();
      const modal = payroll.getByRole('dialog', { name: 'New payroll run' });
      await modal.getByRole('button', { name: /create|new payroll run/i }).last().click();
      await expect(payroll).toHaveURL(/\/payroll\/[a-f0-9]{24}$/);
      run = (await findRun())!;
    }
    if (run.status === 'DRAFT') {
      await payroll.goto(`/payroll/${run._id}`);
      await payroll.getByRole('button', { name: /^Process( payroll)?$/ }).first().click();
      await confirmIfAsked(payroll, /^process$/i);
      await expect.poll(async () => (await apiGet<Run>(request, payrollToken, `/payroll/${run!._id}`)).status, { timeout: 60_000 }).toBe('REVIEW');
      run.status = 'REVIEW';
    }
    await payroll.context().close();

    // A different approver (maker-checker) approves.
    if (run.status === 'REVIEW') {
      const admin = await signIn(browser, USERS.superadmin);
      await admin.goto(`/payroll/${run._id}`);
      await admin.getByRole('button', { name: 'Approve', exact: true }).click();
      await confirmIfAsked(admin, /^approve$/i);
      await expect.poll(async () => (await apiGet<Run>(request, payrollToken, `/payroll/${run!._id}`)).status).toBe('APPROVED');
      await admin.context().close();
    }

    // The employee sees and downloads the payslip PDF.
    const employee = await signIn(browser, USERS.employee);
    const token = await apiToken(request, USERS.employee);
    const slips = await apiGet<{ _id: string; month: number; year: number }[]>(request, token, '/payslips');
    const slip = slips.find((s) => s.month === month && s.year === year);
    expect(slip).toBeTruthy();
    await employee.goto(`/payslips/${slip!._id}`);
    const [download] = await Promise.all([
      employee.waitForEvent('download'),
      employee.getByRole('dialog').getByRole('button', { name: /Download payslip PDF/ }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^payslip-.+\.pdf$/);
    await employee.context().close();
  });
});
