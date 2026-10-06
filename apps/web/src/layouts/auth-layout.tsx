import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CalendarCheck, ShieldCheck, Users, Wallet } from 'lucide-react';
import { Logo } from '@/components/common/brand';

const HIGHLIGHTS = [
  { icon: Users, title: 'People, in one place', text: 'Profiles, org structure and history that stays accurate.' },
  { icon: CalendarCheck, title: 'Time & leave', text: 'Clock-ins, shifts, holidays and approvals that just work.' },
  { icon: Wallet, title: 'Configurable payroll', text: 'Salary structures, payroll runs and payslips.' },
  { icon: ShieldCheck, title: 'Secure by design', text: 'Role-based access, tenant isolation and audit trails.' },
];

export const AuthLayout = ({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) => (
  <div className="grid min-h-full lg:grid-cols-[1fr_1.05fr]">
    <div className="flex flex-col justify-center px-6 py-10 sm:px-12">
      <div className="mx-auto w-full max-w-sm">
        <Link to="/login" aria-label="Stencil HRMS">
          <Logo size="lg" />
        </Link>
        <h1 className="mt-10 text-2xl font-semibold tracking-tight text-fg">{title}</h1>
        {subtitle && <p className="mt-1.5 text-sm text-muted">{subtitle}</p>}
        <div className="mt-8">{children}</div>
        {footer && <div className="mt-8 text-center text-sm text-muted">{footer}</div>}
      </div>
    </div>
    <div className="relative hidden overflow-hidden bg-brand-700 lg:block">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.14),transparent_45%),radial-gradient(circle_at_80%_70%,rgba(129,140,248,0.45),transparent_50%)]" />
      <svg className="absolute -right-24 -bottom-24 h-[520px] w-[520px] opacity-15" viewBox="0 0 100 100" aria-hidden>
        <path d="M20 30h60M20 50h40M20 70h60" stroke="white" strokeWidth="7" strokeLinecap="round" />
      </svg>
      <div className="relative flex h-full flex-col justify-center px-14 text-white">
        <p className="text-sm font-semibold tracking-[0.2em] text-brand-200 uppercase">Stencil HRMS</p>
        <h2 className="mt-3 max-w-md text-3xl leading-tight font-semibold">The operating system for your people.</h2>
        <ul className="mt-10 space-y-6">
          {HIGHLIGHTS.map(({ icon: Icon, title, text }) => (
            <li key={title} className="flex gap-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/20">
                <Icon className="h-5 w-5" />
              </span>
              <span>
                <span className="block font-medium">{title}</span>
                <span className="block text-sm text-brand-100">{text}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  </div>
);
