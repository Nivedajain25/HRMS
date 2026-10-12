import nodemailer, { type Transporter } from 'nodemailer';
import type { Types } from 'mongoose';
import { env, isTest } from '../config/env';
import { logger } from '../config/logger';
import { templates, type EmailTemplate, type TemplateData } from '../emails/templates';
import { enqueue, registerJobHandler, usingRedis } from '../jobs/queue';
import { EmailLogModel } from '../models';

let transporter: Transporter | null = null;
const smtpConfigured = () => Boolean(env.SMTP_HOST);

const getTransporter = () => {
  if (transporter) return transporter;
  transporter = smtpConfigured()
    ? nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT ?? 587,
        secure: env.SMTP_SECURE,
        auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
      })
    : // No SMTP: render but don't deliver (logged as SKIPPED). Useful for dev.
      nodemailer.createTransport({ jsonTransport: true });
  return transporter;
};

/** Test hook: replace the mail transport (e.g. to simulate SMTP failures). Pass `null` to reset. */
export const setEmailTransport = (t: Transporter | null) => {
  transporter = t;
};

/** Sent emails, captured in tests for assertions (e.g. extracting reset tokens). */
export const sentEmails: { to: string; cc: string[]; template: string; subject: string; text: string }[] = [];

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

interface EmailJob {
  to: string;
  cc?: string[];
  /** A built-in template, or the automated event name (e.g. `auto:LEAVE_APPROVED`) when `rendered` is given. */
  template: string;
  data?: unknown;
  /** Pre-rendered (automated notifications): sent as-is. */
  rendered?: RenderedEmail;
  organizationId?: string | null;
  logId: string;
}

/** Attempts per email: the first send plus retries 30 s, 2 min and 8 min later (BullMQ keeps its own 5 attempts). */
export const MAX_EMAIL_ATTEMPTS = 4;
const retryDelayMs = (attempt: number) => 30_000 * 4 ** (attempt - 1);

registerJobHandler<EmailJob>('email.send', async (job) => {
  const rendered =
    job.rendered ?? (templates[job.template as EmailTemplate] as (d: unknown) => RenderedEmail)(job.data);
  const cc = (job.cc ?? []).filter((a) => a && !job.to.split(',').map((t) => t.trim().toLowerCase()).includes(a.toLowerCase()));
  const log = await EmailLogModel.findOneAndUpdate(
    { _id: job.logId },
    { $inc: { attempts: 1 }, lastAttemptAt: new Date(), subject: rendered.subject },
    { new: true, projection: { attempts: 1 } },
  ).lean();
  const attempt = log?.attempts ?? 1;
  if (isTest) sentEmails.push({ to: job.to, cc, template: job.template, subject: rendered.subject, text: rendered.text });
  try {
    const info = await getTransporter().sendMail({
      from: env.EMAIL_FROM,
      to: job.to,
      ...(cc.length ? { cc } : {}),
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
    await EmailLogModel.updateOne(
      { _id: job.logId },
      { status: smtpConfigured() ? 'SENT' : 'SKIPPED', messageId: info.messageId, sentAt: new Date(), error: null },
    );
    if (!smtpConfigured() && !isTest) {
      logger.info({ to: job.to, cc, subject: rendered.subject }, 'Email rendered (SMTP not configured, not delivered)');
      logger.debug({ text: rendered.text }, 'Email body');
    }
  } catch (err) {
    const message = (err as Error).message;
    if (usingRedis()) {
      // BullMQ retries with exponential back-off; the row shows the latest failure until a retry succeeds.
      await EmailLogModel.updateOne({ _id: job.logId }, { status: 'FAILED', error: message });
      throw err;
    }
    if (attempt < MAX_EMAIL_ATTEMPTS) {
      await EmailLogModel.updateOne({ _id: job.logId }, { status: 'RETRYING', error: message });
      logger.warn({ to: job.to, attempt, err: message }, 'Email send failed; retrying');
      await enqueue('email.send', job, { delayMs: isTest ? 0 : retryDelayMs(attempt) });
      return;
    }
    await EmailLogModel.updateOne({ _id: job.logId }, { status: 'FAILED', error: message });
    logger.error({ to: job.to, attempts: attempt, err: message }, 'Email delivery failed after all retries');
  }
});

/** Queue a templated email. Never throws into the caller's business flow. */
export const sendEmail = async <T extends EmailTemplate>(
  to: string,
  template: T,
  data: TemplateData<T>,
  organizationId?: Types.ObjectId | string | null,
) => {
  try {
    const log = await EmailLogModel.create({ to, template, organizationId: organizationId ?? null, status: 'QUEUED' });
    await enqueue('email.send', { to, template, data, organizationId: organizationId ? String(organizationId) : null, logId: String(log._id) });
  } catch (err) {
    logger.error({ err, template }, 'Failed to queue email');
  }
};

/**
 * Queue an already-rendered email to several recipients with CC (automated notifications). The rendered copy is
 * kept on the log so a failed email can be re-sent. Returns the log id, or null if it couldn't be queued.
 */
export const sendRenderedEmail = async (input: {
  to: string[];
  cc?: string[];
  template: string;
  rendered: RenderedEmail;
  organizationId: Types.ObjectId | string;
  dispatchId?: Types.ObjectId | null;
}): Promise<Types.ObjectId | null> => {
  const to = [...new Set(input.to.filter(Boolean))];
  if (!to.length) return null;
  try {
    const cc = [...new Set((input.cc ?? []).filter((a) => a && !to.includes(a)))];
    const log = await EmailLogModel.create({
      to: to.join(', '),
      cc,
      template: input.template,
      subject: input.rendered.subject,
      organizationId: input.organizationId,
      dispatchId: input.dispatchId ?? null,
      rendered: input.rendered,
      status: 'QUEUED',
    });
    await enqueue('email.send', {
      to: to.join(', '),
      cc,
      template: input.template,
      rendered: input.rendered,
      organizationId: String(input.organizationId),
      logId: String(log._id),
    } satisfies EmailJob);
    return log._id;
  } catch (err) {
    logger.error({ err, template: input.template }, 'Failed to queue email');
    return null;
  }
};

/** Re-sends a failed email exactly as rendered (Settings → Notification log). False when it can't be re-sent. */
export const resendEmail = async (organizationId: Types.ObjectId, logId: string) => {
  const log = await EmailLogModel.findOne({ _id: logId, organizationId }).select('+rendered').lean();
  if (!log?.rendered?.html) return false;
  await EmailLogModel.updateOne({ _id: log._id }, { status: 'QUEUED', attempts: 0, error: null });
  await enqueue('email.send', {
    to: log.to,
    cc: log.cc ?? [],
    template: log.template,
    rendered: { subject: log.rendered.subject ?? log.subject ?? '', html: log.rendered.html, text: log.rendered.text ?? '' },
    organizationId: String(organizationId),
    logId: String(log._id),
  } satisfies EmailJob);
  return true;
};

export const verifyEmailTransport = async () => {
  if (!smtpConfigured()) return { configured: false, ok: false };
  try {
    await getTransporter().verify();
    return { configured: true, ok: true };
  } catch (err) {
    return { configured: true, ok: false, error: (err as Error).message };
  }
};
