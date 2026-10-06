import type { Types } from 'mongoose';
import { logger } from '../config/logger';
import { AnnouncementModel, EmployeeModel, JobRunModel, OrganizationModel, RoleModel, UserModel } from '../models';
import { publishAnnouncement, publishDueAnnouncements } from '../services/announcement.service';
import { sendDueReminders } from '../services/reminder.service';
import { dateKeyInTz, timeInTz } from '../utils/dates';
import { defineScheduledJob } from './index';

/** Local hour (org timezone) from which the daily reminders are sent. */
const REMINDER_HOUR = 8;

/**
 * Claims a run key. Returns false when the run already happened (duplicate
 * key), which makes every daily job idempotent across retries, multiple
 * workers and hourly re-triggers.
 */
export const claimJobRun = async (key: string, job: string, organizationId: Types.ObjectId | null = null) => {
  try {
    await JobRunModel.create({ key, job, organizationId });
    return true;
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return false;
    throw err;
  }
};

type Kind = 'birthdays' | 'anniversaries' | 'weddings';

/** Date field celebrated by each kind. */
const FIELD: Record<Kind, 'dateOfBirth' | 'joiningDate' | 'weddingAnniversary'> = {
  birthdays: 'dateOfBirth',
  anniversaries: 'joiningDate',
  weddings: 'weddingAnniversary',
};

/** The day's celebration post for one person (title, body, emoji-led). */
const celebration = (kind: Kind, first: string, full: string, years: number, org: string) => {
  if (kind === 'birthdays') return { title: `🎂 Happy Birthday, ${first}!`, body: `Wishing ${full} a very happy birthday from everyone at ${org}. Have a wonderful day! 🎉` };
  if (kind === 'weddings')
    return { title: `💍 Happy Wedding Anniversary, ${first}!`, body: `Warm wishes to ${full} on their wedding anniversary${years > 0 ? ` — ${years} year${years === 1 ? '' : 's'} together` : ''}. 💐` };
  return {
    title: `🎉 Happy ${years} Year Work Anniversary, ${first}!`,
    body: `${full} completes ${years} year${years === 1 ? '' : 's'} with ${org} today. Thank you for everything you do! 👏`,
  };
};

interface ReminderOptions {
  /** Evaluate as of this instant (tests); defaults to now. */
  now?: Date;
  /** Ignore the local-hour gate (tests / manual runs). */
  force?: boolean;
  organizationId?: Types.ObjectId;
}

const runReminders = async (kind: Kind, opts: ReminderOptions = {}) => {
  const now = opts.now ?? new Date();
  // Wedding anniversaries follow the anniversary setting.
  const settingKey = kind === 'birthdays' ? 'settings.notifications.birthdayReminders' : 'settings.notifications.anniversaryReminders';
  const orgs = await OrganizationModel.find({ status: 'ACTIVE', [settingKey]: { $ne: false }, ...(opts.organizationId ? { _id: opts.organizationId } : {}) })
    .select('timezone name')
    .lean();
  let notified = 0;
  for (const org of orgs) {
    try {
      const tz = org.timezone ?? 'UTC';
      if (!opts.force && Number(timeInTz(now, tz).slice(0, 2)) < REMINDER_HOUR) continue;
      const today = dateKeyInTz(now, tz);
      if (!(await claimJobRun(`${kind}:${org._id}:${today}`, `reminders.${kind}`, org._id))) continue;

      const month = Number(today.slice(5, 7));
      const dayOfMonth = Number(today.slice(8, 10));
      const fieldName = FIELD[kind];
      const field = `$${fieldName}`;
      const leapFallback = month === 2 && dayOfMonth === 28 && !isLeapYear(Number(today.slice(0, 4)));
      const dayMatch = leapFallback ? { $in: [{ $dayOfMonth: field }, [28, 29]] } : { $eq: [{ $dayOfMonth: field }, dayOfMonth] };
      const people = await EmployeeModel.find({
        organizationId: org._id,
        deletedAt: null,
        employmentStatus: { $nin: ['EXITED', 'ARCHIVED'] },
        [fieldName]: { $ne: null },
        $expr: { $and: [{ $eq: [{ $month: field }, month] }, dayMatch] },
      })
        .select('firstName lastName userId joiningDate weddingAnniversary')
        .lean();
      if (!people.length) continue;

      // Posted "by" an active super admin (announcements need an author); shown to everyone, pinned for the day.
      const author = await authorFor(org._id);
      if (!author) continue;
      const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000 - (Number(timeInTz(now, tz).slice(0, 2)) * 60 * 60 * 1000));
      for (const p of people) {
        const from = kind === 'weddings' ? p.weddingAnniversary : kind === 'anniversaries' ? p.joiningDate : null;
        const years = from ? Number(today.slice(0, 4)) - from.getUTCFullYear() : 0;
        if (kind === 'anniversaries' && years < 1) continue;
        const full = `${p.firstName} ${p.lastName ?? ''}`.trim();
        const { title, body } = celebration(kind, p.firstName, full, years, org.name);
        // Company-wide announcement: pinned bar, Latest announcements, and a notification to every employee.
        const doc = await AnnouncementModel.create({
          organizationId: org._id,
          title,
          content: `<p>${body}</p>`,
          priority: 'NORMAL',
          audience: 'ALL',
          departmentIds: [],
          employeeIds: [],
          attachmentIds: [],
          publishAt: now,
          expiresAt,
          pinned: true,
          sendEmail: false,
          createdBy: author,
        });
        await publishAnnouncement(doc._id);
        notified++;
      }
    } catch (err) {
      logger.error({ err, organizationId: String(org._id), kind }, 'Reminder job failed for organization');
    }
  }
  return { notified };
};

const isLeapYear = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** An active super admin of the organization, to author automatic celebration posts. */
const authorFor = async (organizationId: Types.ObjectId) => {
  const role = await RoleModel.findOne({ organizationId, key: 'super_admin' }).select('_id').lean();
  if (!role) return null;
  const user = await UserModel.findOne({ organizationId, status: 'ACTIVE', roles: role._id }).select('_id').sort({ createdAt: 1 }).lean();
  return user?._id ?? null;
};

export const runBirthdayReminders = (opts?: ReminderOptions) => runReminders('birthdays', opts);
export const runAnniversaryReminders = (opts?: ReminderOptions) => runReminders('anniversaries', opts);
export const runWeddingReminders = (opts?: ReminderOptions) => runReminders('weddings', opts);

let registered = false;

/**
 * Registers the communication jobs. Idempotent. Daily reminders run hourly and
 * fire once per organization per local day after 08:00 org time (JobRun keys
 * `birthdays:<orgId>:<date>` / `anniversaries:<orgId>:<date>`).
 */
export const registerReminderJobs = () => {
  if (registered) return;
  registered = true;
  defineScheduledJob({
    name: 'reminders.birthdays',
    schedule: '5 * * * *',
    handler: async () => {
      await runBirthdayReminders();
    },
  });
  defineScheduledJob({
    name: 'reminders.anniversaries',
    schedule: '10 * * * *',
    handler: async () => {
      await runAnniversaryReminders();
    },
  });
  defineScheduledJob({
    name: 'reminders.weddings',
    schedule: '15 * * * *',
    handler: async () => {
      await runWeddingReminders();
    },
  });
  defineScheduledJob({
    name: 'reminders.calendar',
    schedule: '* * * * *',
    handler: async () => {
      await sendDueReminders();
    },
  });
  defineScheduledJob({
    name: 'announcements.publish',
    schedule: '*/5 * * * *',
    handler: async () => {
      await publishDueAnnouncements();
    },
  });
};
