import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, ChevronDown, Clock, CreditCard, FileText, LifeBuoy, Search, Settings, ShieldCheck, Siren, Smartphone, TrendingUp, Users } from 'lucide-react';
import { Card, EmptyState, IconTitle, PageHeader } from '@/components/ui/display';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/store/auth';

interface Faq {
  q: string;
  a: ReactNode;
}
interface Topic {
  key: string;
  title: string;
  icon: ReactNode;
  tone: string;
  /** Only for HR / admin. */
  admin?: boolean;
  faqs: Faq[];
}

const TOPICS: Topic[] = [
  {
    key: 'attendance',
    title: 'Attendance',
    icon: <Clock className="h-5 w-5" />,
    tone: 'bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300',
    faqs: [
      { q: 'How do I clock in and clock out?', a: 'On the Dashboard, press Clock in at the start of your day and Clock out when you leave. You may be asked for a selfie and your location — allow the camera and location when your browser or phone asks.' },
      { q: 'How do I take a break?', a: 'After clocking in, press Break on the Dashboard clock card, and End break when you are back. Break time is not counted as worked time.' },
      { q: 'I forgot to clock in or out. What do I do?', a: 'Go to Attendance › Regularization and request a correction for that day with the right times and a reason. Your manager or HR will approve it.' },
      { q: 'Why does my selfie look mirrored?', a: 'The camera preview is shown the way you see yourself in a mirror; the saved photo is the same as the preview.' },
      { q: 'Where can I see my attendance history?', a: 'Attendance shows your month calendar, totals, timeline and recent activity. Live Board shows who in your team is in today.' },
    ],
  },
  {
    key: 'leave',
    title: 'Leave & holidays',
    icon: <CalendarDays className="h-5 w-5" />,
    tone: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
    faqs: [
      { q: 'How do I apply for leave?', a: 'Go to Leave › Requests and press Apply leave. Pick the leave type and dates, add a reason and submit. You will be notified when it is approved or declined.' },
      { q: 'How many leaves do I have left?', a: 'Your balance for each leave type is shown at the top of Leave › Requests.' },
      { q: 'Can I cancel a leave request?', a: 'Yes — open the request in Leave › Requests and cancel it while it is still pending.' },
      { q: 'Where are the company holidays?', a: 'Attendance › Holidays lists this year’s holidays. Upcoming ones also appear on your Dashboard.' },
    ],
  },
  {
    key: 'pay',
    title: 'Payslips & expenses',
    icon: <CreditCard className="h-5 w-5" />,
    tone: 'bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300',
    faqs: [
      { q: 'Where do I download my payslip?', a: 'Payroll › Payslips lists your payslips by month — open one to view or download it.' },
      { q: 'How do I claim an expense?', a: 'Go to Expenses › Expenses, press New expense, fill in the amount and category and attach the receipt photo or PDF. You can follow its status in the same list.' },
    ],
  },
  {
    key: 'sales',
    title: 'Sales',
    icon: <TrendingUp className="h-5 w-5" />,
    tone: 'bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300',
    faqs: [
      { q: 'How do I log a sale?', a: 'Open Sales and press Add sale. Enter the date, amount, customer and an optional note. You can edit or delete it later from the list.' },
      { q: 'How do I get my sales report?', a: 'On the Sales page pick a period (This month, Last month, Last 3 months, This year or All time) and press Download report. It downloads a CSV file that opens in Excel.' },
    ],
  },
  {
    key: 'emergency',
    title: 'Emergencies, tasks & documents',
    icon: <Siren className="h-5 w-5" />,
    tone: 'bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300',
    faqs: [
      { q: 'I have an emergency and need to leave. What do I do?', a: 'Raise an emergency from the mobile app. HR and admins are alerted at once; when they approve or decline, you get a popup and a notification.' },
      { q: 'Where are the tasks assigned to me?', a: 'Tasks lists everything assigned to you. Update the status as you work; My tasks on the Dashboard shows the latest ones.' },
      { q: 'Where are my documents?', a: 'Documents holds your offer letter, ID proofs and other files shared with you.' },
    ],
  },
  {
    key: 'account',
    title: 'Account & mobile app',
    icon: <Smartphone className="h-5 w-5" />,
    tone: 'bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300',
    faqs: [
      { q: 'How do I change my password?', a: 'Go to Settings and change your password there. If you forgot it, use Forgot password on the sign-in page.' },
      { q: 'How do I switch between light and dark mode?', a: 'Use the theme button in the top bar, or choose a theme in Settings.' },
      { q: 'Can I use Stencil on my phone?', a: 'Yes. The mobile app lets you clock in with a selfie, apply for leave, claim expenses, raise emergencies and see notifications. Sign in with the same email and password.' },
    ],
  },
  {
    key: 'people',
    title: 'Managing people (HR & admin)',
    icon: <Users className="h-5 w-5" />,
    tone: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300',
    admin: true,
    faqs: [
      { q: 'How do I add a new employee?', a: 'Go to People › Employees and press Add employee. Fill in their details, department, designation, manager and joining date. They get a sign-in invite by email.' },
      { q: 'How do I approve leave, regularizations and expenses?', a: 'Pending requests appear in Pending approvals on the Dashboard. You can also open Leave › Requests, Attendance › Regularization or Expenses › Approvals.' },
      { q: 'How do I approve an emergency request?', a: 'An alert pops up on the web and the phone. Press Approve or Decline — the employee is notified straight away. All past alerts are under Emergencies.' },
      { q: 'How do I see today’s attendance for everyone?', a: 'Attendance shows today’s totals, the department breakdown, late arrivals and exceptions. Live Board shows who is in, on break or out; Records lists every clock-in with selfies and locations, and Export Report downloads it.' },
      { q: 'How do I update the company sales figures?', a: 'On Sales, use the upload button on the Sales overview chart to upload the monthly sheet (month, sales, target). Team sales below shows what employees log themselves.' },
    ],
  },
];

const QUICK_LINKS = [
  { label: 'Attendance', to: '/attendance', icon: <Clock className="h-4 w-4" /> },
  { label: 'Apply leave', to: '/leave', icon: <CalendarDays className="h-4 w-4" /> },
  { label: 'Payslips', to: '/payslips', icon: <FileText className="h-4 w-4" /> },
  { label: 'Settings', to: '/settings', icon: <Settings className="h-4 w-4" /> },
];

const FaqItem = ({ faq, open }: { faq: Faq; open?: boolean }) => (
  <details className="group border-b border-line last:border-0" open={open}>
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3.5 text-sm font-medium text-fg hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
      {faq.q}
      <ChevronDown className="h-4 w-4 shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden />
    </summary>
    <div className="px-5 pb-4 text-sm leading-relaxed text-fg-2">{faq.a}</div>
  </details>
);

/** Help: common questions by topic (HR / admin see their own topics too), search, and quick links. */
export const HelpPage = () => {
  const { canAny } = usePermissions();
  const isAdmin = canAny('employee:read', 'report:read');
  const [search, setSearch] = useState('');
  const term = search.trim().toLowerCase();

  const topics = useMemo(
    () =>
      TOPICS.filter((t) => !t.admin || isAdmin)
        .map((t) => ({ ...t, faqs: term ? t.faqs.filter((f) => `${f.q} ${typeof f.a === 'string' ? f.a : ''}`.toLowerCase().includes(term)) : t.faqs }))
        .filter((t) => t.faqs.length),
    [isAdmin, term],
  );

  return (
    <>
      <PageHeader title={<IconTitle icon={<LifeBuoy />}>Help</IconTitle>} description="Answers to common questions about using Stencil HRMS." />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-4">
          <Input leftIcon={<Search className="h-4 w-4" />} placeholder="Search help — e.g. leave, payslip, clock in" aria-label="Search help" value={search} onChange={(e) => setSearch(e.target.value)} />

          {topics.length === 0 ? (
            <Card>
              <EmptyState className="py-12" icon={<Search className="h-6 w-6" />} title="No answers match your search" description="Try a different word, or contact HR below." />
            </Card>
          ) : (
            topics.map((t) => (
              <Card key={t.key} className="overflow-hidden">
                <div className="flex items-center gap-3 border-b border-line px-5 py-3">
                  <span className={cn('flex h-9 w-9 items-center justify-center rounded-lg', t.tone)} aria-hidden>
                    {t.icon}
                  </span>
                  <h2 className="text-base font-semibold text-fg">{t.title}</h2>
                </div>
                {t.faqs.map((f) => (
                  <FaqItem key={f.q} faq={f} open={!!term} />
                ))}
              </Card>
            ))
          )}
        </div>

        <div className="space-y-4">
          <Card className="p-5">
            <h2 className="text-base font-semibold text-fg">Quick links</h2>
            <ul className="mt-3 space-y-1">
              {QUICK_LINKS.map((l) => (
                <li key={l.to}>
                  <Link to={l.to} className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm font-medium text-fg-2 hover:bg-surface-2 hover:text-fg">
                    <span className="text-muted">{l.icon}</span>
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          <Card className="p-5">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300" aria-hidden>
              <ShieldCheck className="h-5 w-5" />
            </span>
            <h2 className="mt-3 text-base font-semibold text-fg">Still need help?</h2>
            <p className="mt-1 text-sm text-fg-2">Contact your HR team or the IT department — they can fix your account, attendance or payroll details.</p>
          </Card>
        </div>
      </div>
    </>
  );
};
