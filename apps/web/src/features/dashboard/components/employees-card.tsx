import { Link } from 'react-router-dom';
import { Avatar, Card } from '@/components/ui/display';
import { useEmployees } from '@/features/employees/api';
import { cn } from '@/lib/utils';

/** Pastel tag colours; a department always gets the same one. */
const TAGS = [
  'bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-200',
  'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-200',
  'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-200',
  'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/15 dark:text-fuchsia-200',
  'bg-pink-100 text-pink-700 dark:bg-pink-500/15 dark:text-pink-200',
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200',
  'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200',
  'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200',
];
const tagFor = (name: string) => TAGS[[...name].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7) % TAGS.length];

/** Newest people first: photo, name, designation and a coloured department tag. */
export const EmployeesCard = ({ className }: { className?: string }) => {
  const list = useEmployees({ page: 1, limit: 6, sortBy: 'createdAt', sortOrder: 'desc' });
  const items = list.data?.data ?? [];
  return (
    <Card className={cn('flex flex-col overflow-hidden motion-safe:animate-fade-up', className)}>
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <h3 className="text-base font-semibold text-fg">
          <span aria-hidden className="mr-1.5">👥</span>
          Employees
        </h3>
        <Link to="/employees" className="inline-flex h-7 items-center rounded-md border border-line bg-surface-2 px-2.5 text-xs font-medium text-fg hover:bg-surface-3">
          View All
        </Link>
      </div>
      {list.isLoading ? (
        <div className="space-y-3 p-5" aria-busy>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-9 animate-pulse rounded-lg bg-surface-2" />
          ))}
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((e) => {
            const name = `${e.firstName} ${e.lastName}`.trim();
            const dept = e.departmentId?.name;
            return (
              <li key={e._id}>
                <Link to={`/employees/${e._id}`} className="flex items-center gap-2.5 px-4 py-2 hover:bg-surface-2">
                  <Avatar name={name} src={e.profilePhoto} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-fg">{name}</span>
                    <span className="block truncate text-[11px] text-muted">{e.designationId?.name ?? e.employeeId}</span>
                  </span>
                  {dept ? <span className={cn('shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold', tagFor(dept))}>{dept}</span> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
};
