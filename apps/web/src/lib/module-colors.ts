/**
 * One colour = one meaning, used the same way everywhere (sidebar icons, dashboard cards, clock buttons, badges).
 *
 *  green   in / present / approved / money received (check in, sales achieved)
 *  red     out / absent / rejected / urgent (check out, emergencies, complaints)
 *  amber   waiting / break / needs attention (pending, late, follow-ups)
 *  blue    people & time (people, attendance, leave, holidays)
 *  purple  company & brand (dashboard, announcements, reports, settings)
 *  teal    pay to staff (payroll, payslips, loans, incentives)
 *  orange  money spent by staff (expenses, travel claims)
 *  indigo  sales (sales, targets, architect meetings)
 *  pink    growth (performance, goals, learning, training)
 *  gray    things & records (assets, documents, tasks)
 */
export type ModuleTone = 'green' | 'red' | 'amber' | 'blue' | 'purple' | 'teal' | 'orange' | 'indigo' | 'pink' | 'gray';

/** Icon / text colour. */
export const TONE_TEXT: Record<ModuleTone, string> = {
  green: 'text-emerald-600 dark:text-emerald-400',
  red: 'text-rose-600 dark:text-rose-400',
  amber: 'text-amber-500 dark:text-amber-400',
  blue: 'text-sky-600 dark:text-sky-400',
  purple: 'text-violet-600 dark:text-violet-400',
  teal: 'text-teal-600 dark:text-teal-400',
  orange: 'text-orange-500 dark:text-orange-400',
  indigo: 'text-indigo-600 dark:text-indigo-400',
  pink: 'text-pink-600 dark:text-pink-400',
  gray: 'text-slate-500 dark:text-slate-400',
};

/** Solid icon tile (white icon). */
export const TONE_SOLID: Record<ModuleTone, string> = {
  green: 'bg-emerald-500',
  red: 'bg-rose-500',
  amber: 'bg-amber-500',
  blue: 'bg-sky-500',
  purple: 'bg-violet-500',
  teal: 'bg-teal-500',
  orange: 'bg-orange-500',
  indigo: 'bg-indigo-500',
  pink: 'bg-pink-500',
  gray: 'bg-slate-500',
};

/** Coloured drop shadow for solid tiles (the sidebar's app-icon look). */
export const TONE_SHADOW: Record<ModuleTone, string> = {
  green: 'shadow-emerald-500/35',
  red: 'shadow-rose-500/35',
  amber: 'shadow-amber-500/35',
  blue: 'shadow-sky-500/35',
  purple: 'shadow-violet-500/35',
  teal: 'shadow-teal-500/35',
  orange: 'shadow-orange-500/35',
  indigo: 'shadow-indigo-500/35',
  pink: 'shadow-pink-500/35',
  gray: 'shadow-slate-500/30',
};

/** Soft card background + border. */
export const TONE_SOFT: Record<ModuleTone, string> = {
  green: 'border-emerald-100 bg-emerald-50/60 dark:border-emerald-500/20 dark:bg-emerald-500/5',
  red: 'border-rose-100 bg-rose-50/60 dark:border-rose-500/20 dark:bg-rose-500/5',
  amber: 'border-amber-100 bg-amber-50/60 dark:border-amber-500/20 dark:bg-amber-500/5',
  blue: 'border-sky-100 bg-sky-50/60 dark:border-sky-500/20 dark:bg-sky-500/5',
  purple: 'border-violet-100 bg-violet-50/60 dark:border-violet-500/20 dark:bg-violet-500/5',
  teal: 'border-teal-100 bg-teal-50/60 dark:border-teal-500/20 dark:bg-teal-500/5',
  orange: 'border-orange-100 bg-orange-50/60 dark:border-orange-500/20 dark:bg-orange-500/5',
  indigo: 'border-indigo-100 bg-indigo-50/60 dark:border-indigo-500/20 dark:bg-indigo-500/5',
  pink: 'border-pink-100 bg-pink-50/60 dark:border-pink-500/20 dark:bg-pink-500/5',
  gray: 'border-slate-200 bg-slate-50/60 dark:border-slate-500/20 dark:bg-slate-500/5',
};
