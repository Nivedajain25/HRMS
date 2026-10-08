import { CircleUserRound, Bell, DoorOpen, KeyRound, MessageSquareWarning, type LucideIcon } from 'lucide-react';
import { NAVIGATION, isAllowed } from '@/app/navigation';
import type { ModuleTone } from '@/lib/module-colors';
import { usePermissions } from '@/store/auth';

export interface PageResult {
  label: string;
  /** The menu section it sits in ("Leave", "Payroll"…), shown under the label. */
  section: string;
  to: string;
  icon: LucideIcon;
  tone: ModuleTone;
}

/** Other words people type for a page (so "salary slip" finds Payslips, "check in" finds Attendance). */
const KEYWORDS: Record<string, string> = {
  '/': 'home dashboard overview',
  '/attendance': 'check in check out clock punch present late today attendance',
  '/regularization': 'fix correction missed punch regularize regularise',
  '/holidays': 'holiday festival day off',
  '/shifts': 'shift timing schedule',
  '/leave': 'leave apply request vacation time off sick casual',
  '/leave/calendar': 'leave calendar who is off',
  '/leave/types': 'leave types policy',
  '/payslips': 'salary slip pay slip payslip',
  '/salary': 'salary structure ctc pay',
  '/payroll': 'payroll run salary',
  '/loans': 'loan advance',
  '/performance/goals': 'goals target okr',
  '/performance/reviews': 'review appraisal rating',
  '/performance/learning': 'learning course',
  '/performance/training': 'training course',
  '/expenses': 'expense claim reimbursement bill',
  '/travel-claims': 'travel trip claim',
  '/expenses/approvals': 'expense approvals pay',
  '/assets': 'laptop asset equipment device',
  '/assets/assignments': 'asset allocation assign',
  '/documents': 'document file policy upload',
  '/tasks': 'task todo work assign',
  '/announcements': 'notice news announcement',
  '/emergencies': 'emergency sos siren urgent',
  '/employees': 'staff people employee directory',
  '/employees/org-chart': 'org chart hierarchy reporting manager team',
  '/departments': 'department team',
  '/designations': 'designation job title role',
  '/locations': 'office branch location',
  '/onboarding': 'onboarding new joiner',
  '/recruitment/jobs': 'jobs openings hiring',
  '/recruitment/candidates': 'candidates referral applicants hiring',
  '/recruitment/interviews': 'interview hiring',
  '/sales': 'sales target',
  '/incentives': 'incentive bonus commission',
  '/reports': 'reports export analytics',
  '/settings': 'settings configure users roles working days',
  '/account': 'my account password security',
  '/help': 'help support faq',
  '/profile': 'my profile personal details bank address',
  '/notifications': 'notifications alerts',
  '/resignation': 'resign resignation exit notice period quit',
  '/complaints': 'complaint grievance issue',
  '/change-password': 'password change reset',
};

/** Pages reached from places other than the menu (My Account, the top bar). */
const EXTRA_PAGES: (PageResult & { employeeOnly?: boolean })[] = [
  { label: 'My profile', section: 'My Account', to: '/profile', icon: CircleUserRound, tone: 'blue', employeeOnly: true },
  { label: 'Notifications', section: 'My Account', to: '/notifications', icon: Bell, tone: 'red' },
  { label: 'Resignation', section: 'My Account', to: '/resignation', icon: DoorOpen, tone: 'gray', employeeOnly: true },
  { label: 'Complaints', section: 'My Account', to: '/complaints', icon: MessageSquareWarning, tone: 'red' },
  { label: 'Change password', section: 'My Account', to: '/change-password', icon: KeyRound, tone: 'amber' },
];

/** Every page this person can open, matched against what they typed (all words must match). */
export const usePageResults = (query: string, limit = 6): PageResult[] => {
  const { user, isManager, hasEmployee } = usePermissions();
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const perms = user?.permissions ?? [];
  const pages: PageResult[] = [];
  for (const g of NAVIGATION) {
    if (!isAllowed(g, perms, isManager, hasEmployee)) continue;
    if (g.to) pages.push({ label: g.label, section: 'Menu', to: g.to, icon: g.icon, tone: g.tone });
    for (const c of g.children ?? []) {
      if (isAllowed(c, perms, isManager, hasEmployee)) pages.push({ label: c.label, section: g.label, to: c.to, icon: c.icon, tone: c.tone ?? g.tone });
    }
  }
  for (const p of EXTRA_PAGES) if (!p.employeeOnly || hasEmployee) pages.push(p);
  const seen = new Set<string>();
  return pages
    .filter((p) => {
      if (seen.has(p.to)) return false;
      seen.add(p.to);
      const haystack = `${p.label} ${p.section} ${KEYWORDS[p.to] ?? ''}`.toLowerCase();
      return words.every((w) => haystack.includes(w));
    })
    .sort((a, b) => Number(!a.label.toLowerCase().startsWith(words[0]!)) - Number(!b.label.toLowerCase().startsWith(words[0]!)))
    .slice(0, limit);
};
