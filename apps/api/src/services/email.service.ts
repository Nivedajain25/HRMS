import nodemailer, { type Transporter } from 'nodemailer';
import type { Types } from 'mongoose';
import { env, isTest } from '../config/env';
import { logger } from '../config/logger';
import { templates, type EmailTemplate, type TemplateData } from '../emails/templates';
import { enqueue, registerJobHandler } from '../jobs/queue';
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

/** Sent emails, captured in tests for assertions (e.g. extracting reset tokens). */
export const sentEmails: { to: string; template: string; subject: string; text: string }[] = [];

interface EmailJob {
  to: string;
  template: EmailTemplate;
  data: unknown;
  organizationId?: string | null;
  logId: string;
}

registerJobHandler<EmailJob>('email.send', async (job) => {
  const render = templates[job.template] as (d: unknown) => { subject: string; html: string; text: string };
  const rendered = render(job.data);
  if (isTest) sentEmails.push({ to: job.to, template: job.template, subject: rendered.subject, text: rendered.text });
  try {
    const info = await getTransporter().sendMail({
      from: env.EMAIL_FROM,
      to: job.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
    await EmailLogModel.updateOne(
      { _id: job.logId },
      { status: smtpConfigured() ? 'SENT' : 'SKIPPED', messageId: info.messageId, sentAt: new Date(), subject: rendered.subject },
    );
    if (!smtpConfigured() && !isTest) {
      logger.info({ to: job.to, subject: rendered.subject }, 'Email rendered (SMTP not configured, not delivered)');
      logger.debug({ text: rendered.text }, 'Email body');
    }
  } catch (err) {
    await EmailLogModel.updateOne({ _id: job.logId }, { status: 'FAILED', error: (err as Error).message });
    throw err;
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

export const verifyEmailTransport = async () => {
  if (!smtpConfigured()) return { configured: false, ok: false };
  try {
    await getTransporter().verify();
    return { configured: true, ok: true };
  } catch (err) {
    return { configured: true, ok: false, error: (err as Error).message };
  }
};
