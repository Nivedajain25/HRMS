import { z } from 'zod';
import type { NotificationType } from './enums';

/**
 * Automated HR notifications: the events that send in-app notifications and emails on their own, who can receive
 * them, and the default rules / templates. Organizations override rules and templates in Settings → Notification
 * rules (stored in `settings.notificationRules`); the API merges overrides over these defaults.
 */

export const NOTIFICATION_EVENTS = [
  'LEAVE_SUBMITTED',
  'LEAVE_APPROVED',
  'LEAVE_REJECTED',
  'LEAVE_CANCELLED',
  'LEAVE_MODIFIED',
  'INTERVIEW_SCHEDULED',
  'INTERVIEW_RESCHEDULED',
  'INTERVIEW_CANCELLED',
  'INTERVIEW_RESULT',
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

/**
 * Who receives an event:
 *  - EMPLOYEE: the person the leave is for. MANAGER: their reporting manager — if that manager is on leave or
 *    unavailable, the next manager up the reporting line (escalation). HR: HR Admins / HR Managers. ADMIN: Super
 *    Admins and Admins. INTERVIEWERS, HIRING_MANAGER (of the job opening), RECRUITERS (Recruiter role and whoever
 *    created the opening), CANDIDATE (email only — candidates have no account).
 */
export const NOTIFICATION_RECIPIENTS = ['EMPLOYEE', 'MANAGER', 'HR', 'ADMIN', 'INTERVIEWERS', 'HIRING_MANAGER', 'RECRUITERS', 'CANDIDATE'] as const;
export type NotificationRecipient = (typeof NOTIFICATION_RECIPIENTS)[number];

export const NOTIFICATION_RECIPIENT_LABELS: Record<NotificationRecipient, string> = {
  EMPLOYEE: 'Employee',
  MANAGER: 'Reporting manager',
  HR: 'HR',
  ADMIN: 'Admin',
  INTERVIEWERS: 'Interviewers',
  HIRING_MANAGER: 'Hiring manager',
  RECRUITERS: 'Recruiters',
  CANDIDATE: 'Candidate',
};

/** Recipients the "self" template is for (the person the event is about); everyone else gets the "team" one. */
export const SELF_RECIPIENTS: NotificationRecipient[] = ['EMPLOYEE', 'CANDIDATE'];

export interface NotificationRule {
  enabled: boolean;
  /** Bell / dashboard notification and phone push (people with an account). */
  inApp: boolean;
  email: boolean;
  recipients: NotificationRecipient[];
  /** HR in CC on the emails (always on for leave unless switched off here). */
  ccHr: boolean;
  /** Manager on leave or unavailable → the next manager up the reporting line gets it (leave events). */
  escalate: boolean;
  /** Message to the team (manager, HR, admin, interviewers…). `{{placeholders}}` are filled in. */
  subject: string;
  body: string;
  /** Message to the person it's about (the employee / candidate). */
  selfSubject: string;
  selfBody: string;
}

export interface NotificationEventInfo {
  label: string;
  group: 'Leave' | 'Interviews';
  description: string;
  /** In-app notification type (icons, personal preferences). */
  type: NotificationType;
  recipients: NotificationRecipient[];
  placeholders: string[];
  defaults: NotificationRule;
}

const LEAVE_PLACEHOLDERS = ['employeeName', 'employeeCode', 'leaveType', 'dates', 'days', 'reason', 'note', 'actorName', 'approver', 'managerName', 'organization', 'link'];
const INTERVIEW_PLACEHOLDERS = ['candidateName', 'jobTitle', 'when', 'round', 'interviewType', 'meetingLink', 'location', 'interviewers', 'reason', 'result', 'rating', 'actorName', 'organization', 'link'];
const LEAVE_RECIPIENTS: NotificationRecipient[] = ['EMPLOYEE', 'MANAGER', 'HR', 'ADMIN'];
const INTERVIEW_RECIPIENTS: NotificationRecipient[] = ['INTERVIEWERS', 'HIRING_MANAGER', 'RECRUITERS', 'HR', 'ADMIN', 'CANDIDATE'];

const leave = (
  label: string,
  type: NotificationType,
  description: string,
  recipients: NotificationRecipient[],
  t: Pick<NotificationRule, 'subject' | 'body' | 'selfSubject' | 'selfBody'>,
): NotificationEventInfo => ({
  label,
  group: 'Leave',
  description,
  type,
  recipients: LEAVE_RECIPIENTS,
  placeholders: LEAVE_PLACEHOLDERS,
  defaults: { enabled: true, inApp: true, email: true, recipients, ccHr: true, escalate: true, ...t },
});

const interview = (
  label: string,
  type: NotificationType,
  description: string,
  recipients: NotificationRecipient[],
  t: Pick<NotificationRule, 'subject' | 'body' | 'selfSubject' | 'selfBody'>,
): NotificationEventInfo => ({
  label,
  group: 'Interviews',
  description,
  type,
  recipients: INTERVIEW_RECIPIENTS,
  placeholders: INTERVIEW_PLACEHOLDERS,
  defaults: { enabled: true, inApp: true, email: true, recipients, ccHr: false, escalate: false, ...t },
});

export const NOTIFICATION_EVENT_INFO: Record<NotificationEvent, NotificationEventInfo> = {
  LEAVE_SUBMITTED: leave('Leave requested', 'LEAVE_SUBMITTED', 'An employee submits a leave request.', ['MANAGER', 'HR', 'ADMIN'], {
    subject: 'Leave request: {{employeeName}} · {{dates}}',
    body: '{{employeeName}} has requested {{leaveType}} for {{dates}} ({{days}}).\n\nReason: {{reason}}\n\nWaiting for approval from {{approver}}.',
    selfSubject: 'Your leave request was submitted',
    selfBody: 'Your {{leaveType}} request for {{dates}} ({{days}}) was submitted and is waiting for approval from {{approver}}.',
  }),
  LEAVE_APPROVED: leave('Leave approved', 'LEAVE_APPROVED', 'A leave request gets its final approval.', ['EMPLOYEE', 'MANAGER', 'HR', 'ADMIN'], {
    subject: 'Leave approved: {{employeeName}} · {{dates}}',
    body: "{{employeeName}}'s {{leaveType}} for {{dates}} ({{days}}) was approved by {{actorName}}.\n\n{{note}}",
    selfSubject: 'Your leave was approved',
    selfBody: 'Your {{leaveType}} for {{dates}} ({{days}}) was approved by {{actorName}}.\n\n{{note}}',
  }),
  LEAVE_REJECTED: leave('Leave rejected', 'LEAVE_REJECTED', 'A leave request is rejected.', ['EMPLOYEE', 'MANAGER', 'HR', 'ADMIN'], {
    subject: 'Leave rejected: {{employeeName}} · {{dates}}',
    body: "{{employeeName}}'s {{leaveType}} for {{dates}} ({{days}}) was rejected by {{actorName}}.\n\nReason: {{note}}",
    selfSubject: 'Your leave was rejected',
    selfBody: 'Your {{leaveType}} for {{dates}} ({{days}}) was rejected by {{actorName}}.\n\nReason: {{note}}',
  }),
  LEAVE_CANCELLED: leave('Leave cancelled', 'LEAVE_CANCELLED', 'A pending or approved leave is cancelled.', ['EMPLOYEE', 'MANAGER', 'HR', 'ADMIN'], {
    subject: 'Leave cancelled: {{employeeName}} · {{dates}}',
    body: "{{employeeName}}'s {{leaveType}} for {{dates}} ({{days}}) was cancelled by {{actorName}}.\n\n{{note}}",
    selfSubject: 'Your leave was cancelled',
    selfBody: 'Your {{leaveType}} for {{dates}} ({{days}}) was cancelled by {{actorName}}.\n\n{{note}}',
  }),
  LEAVE_MODIFIED: leave('Leave changed', 'LEAVE_MODIFIED', 'A pending leave request is edited (dates, type or reason).', ['MANAGER', 'HR', 'ADMIN'], {
    subject: 'Leave request changed: {{employeeName}} · {{dates}}',
    body: '{{employeeName}} changed their leave request. It is now {{leaveType}} for {{dates}} ({{days}}).\n\nReason: {{reason}}\n\n{{note}}',
    selfSubject: 'Your leave request was changed',
    selfBody: 'Your leave request is now {{leaveType}} for {{dates}} ({{days}}).',
  }),
  INTERVIEW_SCHEDULED: interview('Interview scheduled', 'INTERVIEW_SCHEDULED', 'A candidate interview is scheduled.', ['INTERVIEWERS', 'HIRING_MANAGER', 'RECRUITERS', 'CANDIDATE'], {
    subject: 'Interview scheduled: {{candidateName}} · {{jobTitle}}',
    body: '{{round}} interview with {{candidateName}} for {{jobTitle}} on {{when}} ({{interviewType}}).\n\nInterviewers: {{interviewers}}\nJoin: {{meetingLink}}\nLocation: {{location}}',
    selfSubject: 'Your interview for {{jobTitle}} at {{organization}}',
    selfBody: 'Hello {{candidateName}},\n\nYour {{round}} interview for {{jobTitle}} is scheduled on {{when}} ({{interviewType}}).\n\nJoin: {{meetingLink}}\nLocation: {{location}}\n\nWe look forward to speaking with you.',
  }),
  INTERVIEW_RESCHEDULED: interview('Interview rescheduled', 'INTERVIEW_SCHEDULED', 'An interview moves to a new time or changes details.', ['INTERVIEWERS', 'HIRING_MANAGER', 'RECRUITERS', 'CANDIDATE'], {
    subject: 'Interview rescheduled: {{candidateName}} · {{when}}',
    body: 'The {{round}} interview with {{candidateName}} for {{jobTitle}} is now on {{when}} ({{interviewType}}).\n\nInterviewers: {{interviewers}}\nJoin: {{meetingLink}}\nLocation: {{location}}',
    selfSubject: 'Your interview for {{jobTitle}} has been rescheduled',
    selfBody: 'Hello {{candidateName}},\n\nYour {{round}} interview for {{jobTitle}} has moved to {{when}} ({{interviewType}}).\n\nJoin: {{meetingLink}}\nLocation: {{location}}',
  }),
  INTERVIEW_CANCELLED: interview('Interview cancelled', 'INTERVIEW_CANCELLED', 'An interview is cancelled.', ['INTERVIEWERS', 'HIRING_MANAGER', 'RECRUITERS', 'CANDIDATE'], {
    subject: 'Interview cancelled: {{candidateName}} · {{when}}',
    body: 'The {{round}} interview with {{candidateName}} for {{jobTitle}} on {{when}} was cancelled by {{actorName}}.\n\nReason: {{reason}}',
    selfSubject: 'Your interview for {{jobTitle}} was cancelled',
    selfBody: 'Hello {{candidateName}},\n\nYour {{round}} interview for {{jobTitle}} on {{when}} has been cancelled. Our team will contact you about next steps.',
  }),
  INTERVIEW_RESULT: interview('Interview result', 'INTERVIEW_RESULT', 'An interviewer submits feedback (rating and recommendation).', ['HIRING_MANAGER', 'RECRUITERS', 'HR'], {
    subject: 'Interview feedback: {{candidateName}} · {{result}}',
    body: '{{actorName}} submitted feedback for the {{round}} interview with {{candidateName}} ({{jobTitle}}).\n\nRecommendation: {{result}}\nRating: {{rating}}',
    selfSubject: 'An update on your application for {{jobTitle}}',
    selfBody: 'Hello {{candidateName}},\n\nThank you for interviewing for {{jobTitle}}. Our team has reviewed your interview and will be in touch about next steps.',
  }),
};

const recipients = z.array(z.enum(NOTIFICATION_RECIPIENTS)).max(NOTIFICATION_RECIPIENTS.length);
const text = (max: number) => z.string().trim().max(max);

/** One event's rule as saved by Settings → Notification rules (every field optional: omitted = default). */
export const notificationRuleSchema = z
  .object({
    enabled: z.boolean(),
    inApp: z.boolean(),
    email: z.boolean(),
    recipients,
    ccHr: z.boolean(),
    escalate: z.boolean(),
    subject: text(200),
    body: text(4000),
    selfSubject: text(200),
    selfBody: text(4000),
  })
  .partial();
export type NotificationRuleInput = z.infer<typeof notificationRuleSchema>;

export const notificationRulesUpdateSchema = z.object({
  rules: z.partialRecord(z.enum(NOTIFICATION_EVENTS), notificationRuleSchema.nullable()),
});
export type NotificationRulesUpdate = z.infer<typeof notificationRulesUpdateSchema>;

export const notificationPreviewSchema = z.object({
  event: z.enum(NOTIFICATION_EVENTS),
  audience: z.enum(['team', 'self']).default('team'),
  rule: notificationRuleSchema.optional(),
  /** Send the rendered sample to the signed-in user's own email. */
  sendTest: z.boolean().optional(),
});
export type NotificationPreviewInput = z.infer<typeof notificationPreviewSchema>;

/** Fills `{{name}}` placeholders; unknown names become empty. Lines left with only a label (e.g. "Join: ") are dropped. */
export const fillPlaceholders = (template: string, vars: Record<string, string | number | null | undefined>) =>
  template
    .replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (_, key: string) => {
      const v = vars[key];
      return v === undefined || v === null ? '' : String(v);
    })
    .split('\n')
    .filter((line) => !/^[A-Za-z][A-Za-z ]{0,30}:\s*$/.test(line.trim()))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
