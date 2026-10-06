import { env } from '../config/env';

export const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

interface Rendered {
  subject: string;
  html: string;
  text: string;
}

const layout = (title: string, bodyHtml: string, cta?: { label: string; url: string }) => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2330">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:560px;background:#fff;border-radius:12px;border:1px solid #e6e8ee">
<tr><td style="padding:24px 32px;border-bottom:1px solid #eef0f4">
<span style="display:inline-block;width:28px;height:28px;border-radius:8px;background:#4f46e5;color:#fff;font-weight:700;text-align:center;line-height:28px;vertical-align:middle">S</span>
<span style="font-weight:700;font-size:16px;letter-spacing:.08em;vertical-align:middle;margin-left:8px">STENCIL</span>
</td></tr>
<tr><td style="padding:32px">
<h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(title)}</h1>
<div style="font-size:14px;line-height:1.6;color:#3b4150">${bodyHtml}</div>
${
  cta
    ? `<p style="margin:28px 0 8px"><a href="${escapeHtml(cta.url)}" style="background:#4f46e5;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600;font-size:14px;display:inline-block">${escapeHtml(cta.label)}</a></p>
<p style="font-size:12px;color:#8a90a0;word-break:break-all">Or open: ${escapeHtml(cta.url)}</p>`
    : ''
}
</td></tr>
<tr><td style="padding:16px 32px;border-top:1px solid #eef0f4;font-size:12px;color:#8a90a0">Sent by Stencil HRMS. You are receiving this because of your account activity.</td></tr>
</table></td></tr></table></body></html>`;

const p = (text: string) => `<p style="margin:0 0 12px">${escapeHtml(text)}</p>`;
// CLIENT_URL may list several origins (web, mobile web); email links go to the first (the web app).
const url = (path: string) => `${env.CLIENT_URL.split(',')[0]!.trim().replace(/\/$/, '')}${path}`;

export const templates = {
  welcome: (d: { name: string; organization: string; setupUrl?: string }): Rendered => ({
    subject: `Welcome to ${d.organization} on Stencil`,
    html: layout(
      `Welcome, ${d.name}`,
      p(`Your account at ${d.organization} has been created.`) +
        p(d.setupUrl ? 'Set your password to get started.' : 'You can now sign in.'),
      { label: d.setupUrl ? 'Set your password' : 'Sign in', url: d.setupUrl ?? url('/login') },
    ),
    text: `Welcome ${d.name}. Your account at ${d.organization} is ready. ${d.setupUrl ?? url('/login')}`,
  }),
  verification: (d: { name: string; token: string }): Rendered => {
    const link = url(`/verify-email?token=${d.token}`);
    return {
      subject: 'Verify your email address',
      html: layout('Verify your email', p(`Hi ${d.name}, please confirm your email address.`) + p('This link expires in 48 hours.'), {
        label: 'Verify email',
        url: link,
      }),
      text: `Verify your email: ${link}`,
    };
  },
  passwordReset: (d: { name: string; token: string }): Rendered => {
    const link = url(`/reset-password?token=${d.token}`);
    return {
      subject: 'Reset your password',
      html: layout(
        'Reset your password',
        p(`Hi ${d.name}, we received a request to reset your password.`) +
          p('This link expires in 1 hour. If you did not request this, you can ignore this email.'),
        { label: 'Reset password', url: link },
      ),
      text: `Reset your password: ${link}`,
    };
  },
  invite: (d: { name: string; organization: string; token: string }): Rendered => {
    const link = url(`/accept-invite?token=${d.token}`);
    return {
      subject: `You're invited to ${d.organization} on Stencil`,
      html: layout(`Join ${d.organization}`, p(`Hi ${d.name}, an account has been created for you.`) + p('Set a password to activate it. The link expires in 7 days.'), {
        label: 'Activate account',
        url: link,
      }),
      text: `Activate your account: ${link}`,
    };
  },
  notification: (d: { name: string; title: string; message: string; link?: string }): Rendered => ({
    subject: d.title,
    html: layout(d.title, p(`Hi ${d.name},`) + p(d.message), d.link ? { label: 'Open in Stencil', url: url(d.link) } : undefined),
    text: `${d.title}\n\n${d.message}${d.link ? `\n\n${url(d.link)}` : ''}`,
  }),
  payslip: (d: { name: string; period: string; link: string }): Rendered => ({
    subject: `Your payslip for ${d.period} is ready`,
    html: layout('Payslip available', p(`Hi ${d.name}, your payslip for ${d.period} has been published.`), {
      label: 'View payslip',
      url: url(d.link),
    }),
    text: `Your payslip for ${d.period} is ready: ${url(d.link)}`,
  }),
  interview: (d: { name: string; when: string; type: string; meetingLink?: string; job: string }): Rendered => ({
    subject: `Interview scheduled: ${d.job}`,
    html: layout(
      'Interview scheduled',
      p(`Hi ${d.name}, an interview has been scheduled for ${d.job}.`) + p(`When: ${d.when}`) + p(`Format: ${d.type}`),
      d.meetingLink ? { label: 'Join meeting', url: d.meetingLink } : undefined,
    ),
    text: `Interview for ${d.job} on ${d.when} (${d.type}). ${d.meetingLink ?? ''}`,
  }),
  announcement: (d: { name: string; title: string; excerpt: string }): Rendered => ({
    subject: `Announcement: ${d.title}`,
    html: layout(d.title, p(`Hi ${d.name},`) + p(d.excerpt), { label: 'Read announcement', url: url('/announcements') }),
    text: `${d.title}\n\n${d.excerpt}`,
  }),
  documentExpiry: (d: { name: string; document: string; expiryDate: string }): Rendered => ({
    subject: `Document expiring: ${d.document}`,
    html: layout('Document expiring soon', p(`Hi ${d.name}, "${d.document}" expires on ${d.expiryDate}.`) + p('Please upload a renewed copy.'), {
      label: 'View documents',
      url: url('/documents'),
    }),
    text: `"${d.document}" expires on ${d.expiryDate}.`,
  }),
} as const;

export type EmailTemplate = keyof typeof templates;
export type TemplateData<T extends EmailTemplate> = Parameters<(typeof templates)[T]>[0];
