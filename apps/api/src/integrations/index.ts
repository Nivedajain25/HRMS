/**
 * Integration abstractions (spec: "integration ready — no fake integrations").
 *
 * Each category defines the contract a real provider must implement. No
 * provider is bundled yet, so every integration reports NOT_CONFIGURED until an
 * implementation is registered with `registerIntegrationProvider`.
 */
import type { Types } from 'mongoose';

export type IntegrationCategory =
  | 'IDENTITY'
  | 'CALENDAR'
  | 'CHAT'
  | 'MESSAGING'
  | 'ACCOUNTING'
  | 'BIOMETRIC'
  | 'PAYMENTS';

/** Directory & calendar sync (Google Workspace, Microsoft 365). */
export interface DirectoryProvider {
  syncUsers(organizationId: Types.ObjectId): Promise<{ created: number; updated: number }>;
  createCalendarEvent(organizationId: Types.ObjectId, event: { title: string; start: Date; end: Date; attendees: string[] }): Promise<string>;
}

/** Team chat notifications (Slack, Microsoft Teams). */
export interface ChatProvider {
  postMessage(organizationId: Types.ObjectId, channel: string, text: string): Promise<void>;
}

/** Transactional messaging (WhatsApp Business). */
export interface MessagingProvider {
  sendTemplate(organizationId: Types.ObjectId, to: string, template: string, variables: Record<string, string>): Promise<void>;
}

/** Accounting export (payroll journals, expense reimbursements). */
export interface AccountingProvider {
  exportPayrollJournal(organizationId: Types.ObjectId, payrollId: Types.ObjectId): Promise<string>;
  exportExpense(organizationId: Types.ObjectId, expenseId: Types.ObjectId): Promise<string>;
}

/** Biometric / access-control devices pushing punches into attendance. */
export interface BiometricProvider {
  pullPunches(organizationId: Types.ObjectId, since: Date): Promise<{ employeeCode: string; timestamp: Date; direction: 'IN' | 'OUT' }[]>;
}

/** Salary/reimbursement payouts. */
export interface PaymentProvider {
  createPayout(organizationId: Types.ObjectId, payout: { reference: string; amount: number; currency: string; beneficiaryEmployeeId: Types.ObjectId }): Promise<string>;
}

export interface IntegrationDefinition {
  key: string;
  name: string;
  category: IntegrationCategory;
  description: string;
  capabilities: string[];
}

export const INTEGRATIONS: IntegrationDefinition[] = [
  { key: 'google-workspace', name: 'Google Workspace', category: 'IDENTITY', description: 'Directory sync and calendar events for interviews and leave.', capabilities: ['User provisioning', 'Calendar events'] },
  { key: 'microsoft-365', name: 'Microsoft 365', category: 'IDENTITY', description: 'Entra ID directory sync and Outlook calendar events.', capabilities: ['User provisioning', 'Calendar events'] },
  { key: 'slack', name: 'Slack', category: 'CHAT', description: 'Post approvals and announcements to channels.', capabilities: ['Channel notifications'] },
  { key: 'teams', name: 'Microsoft Teams', category: 'CHAT', description: 'Post approvals and announcements to Teams channels.', capabilities: ['Channel notifications'] },
  { key: 'whatsapp', name: 'WhatsApp Business', category: 'MESSAGING', description: 'Template messages for payslips and reminders.', capabilities: ['Template messages'] },
  { key: 'accounting', name: 'Accounting system', category: 'ACCOUNTING', description: 'Export payroll journals and expense reimbursements.', capabilities: ['Payroll journal export', 'Expense export'] },
  { key: 'biometric', name: 'Biometric devices', category: 'BIOMETRIC', description: 'Import punches from biometric / access-control devices.', capabilities: ['Punch import'] },
  { key: 'payments', name: 'Payment gateway', category: 'PAYMENTS', description: 'Initiate salary and reimbursement payouts.', capabilities: ['Payouts'] },
];

type AnyProvider = DirectoryProvider | ChatProvider | MessagingProvider | AccountingProvider | BiometricProvider | PaymentProvider;
const providers = new Map<string, AnyProvider>();

export const registerIntegrationProvider = (key: string, provider: AnyProvider) => {
  if (!INTEGRATIONS.some((i) => i.key === key)) throw new Error(`Unknown integration ${key}`);
  providers.set(key, provider);
};

export const listIntegrations = () =>
  INTEGRATIONS.map((i) => ({ ...i, status: providers.has(i.key) ? ('AVAILABLE' as const) : ('NOT_CONFIGURED' as const) }));
