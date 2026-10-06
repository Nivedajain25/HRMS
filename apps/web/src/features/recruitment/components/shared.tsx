import { useState, type KeyboardEvent } from 'react';
import { toast } from 'sonner';
import { Star, X } from 'lucide-react';
import { CANDIDATE_PIPELINE, CANDIDATE_STAGES } from '@stencil/shared';
import { statusTone } from '@/components/common/status-badge';
import type { Tone } from '@/components/ui/display';
import { Input } from '@/components/ui/input';
import { useConfirm } from '@/components/ui/overlay';
import { label } from '@/lib/i18n';
import { cn, formatMoney } from '@/lib/utils';
import { useMoveStage, type CandidateStage, type JobOpening, type JobStatus } from '../api';

/* -------------------------------- Stages -------------------------------- */

export const STAGES = CANDIDATE_STAGES as readonly CandidateStage[];
/** Stages rendered as open kanban columns (REJECTED is collapsed separately). */
export const BOARD_STAGES = STAGES.filter((s) => s !== 'REJECTED');
export const CLOSED_STAGES: CandidateStage[] = ['HIRED', 'REJECTED'];

/** Stages a candidate can be moved to manually (HIRED only via the hire flow). */
export const manualTargets = (stage: CandidateStage) => CANDIDATE_PIPELINE.next(stage).filter((s) => s !== 'HIRED');
export const canHireFrom = (stage: CandidateStage) => CANDIDATE_PIPELINE.can(stage, 'HIRED');

const toneBg: Record<Tone, string> = {
  gray: 'bg-slate-400',
  brand: 'bg-brand-500',
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-red-500',
  blue: 'bg-sky-500',
  purple: 'bg-violet-500',
  teal: 'bg-teal-500',
};
export const stageColor = (stage: string) => toneBg[statusTone(stage)];

/* ------------------------------ Stage mover ----------------------------- */

/**
 * Returns `move(candidate, to)` which confirms rejections (with a reason)
 * before calling the stage endpoint.
 */
export const useStageMover = () => {
  const confirm = useConfirm();
  const mutation = useMoveStage();
  const move = async (candidate: { _id: string; firstName: string; lastName: string }, to: CandidateStage) => {
    const name = `${candidate.firstName} ${candidate.lastName}`;
    let rejectionReason: string | undefined;
    if (to === 'REJECTED') {
      const res = await confirm({
        title: `Reject ${name}?`,
        message: 'The candidate is moved out of the active pipeline. This cannot be undone.',
        confirmLabel: 'Reject candidate',
        requireReason: true,
        reasonLabel: 'Rejection reason',
      });
      if (!res.confirmed) return false;
      rejectionReason = res.reason;
    }
    try {
      await mutation.mutateAsync({ id: candidate._id, stage: to, rejectionReason });
      toast.success(to === 'REJECTED' ? `${name} rejected` : `${name} moved to ${label(to)}`);
      return true;
    } catch {
      return false;
    }
  };
  return { move, pending: mutation.isPending, movingId: mutation.isPending ? mutation.variables?.id : undefined };
};

/* ------------------------------- Job status ----------------------------- */

export const JOB_ACTIONS: Record<JobStatus, { to: JobStatus; label: string }[]> = {
  DRAFT: [
    { to: 'OPEN', label: 'Publish' },
    { to: 'CLOSED', label: 'Close' },
  ],
  OPEN: [
    { to: 'ON_HOLD', label: 'Put on hold' },
    { to: 'CLOSED', label: 'Close' },
  ],
  ON_HOLD: [
    { to: 'OPEN', label: 'Resume hiring' },
    { to: 'CLOSED', label: 'Close' },
  ],
  CLOSED: [{ to: 'OPEN', label: 'Reopen' }],
};

export const experienceLabel = (job: Pick<JobOpening, 'experienceMin' | 'experienceMax'>) => {
  const { experienceMin: min, experienceMax: max } = job;
  if (!min && !max) return 'Any experience';
  if (max && max > min) return `${min}–${max} yrs`;
  return `${min}+ yrs`;
};

export const salaryLabel = (job: Pick<JobOpening, 'salaryMin' | 'salaryMax' | 'currency'>, fallbackCurrency: string) => {
  const currency = job.currency || fallbackCurrency;
  if (!job.salaryMin && !job.salaryMax) return null;
  if (job.salaryMax && job.salaryMax !== job.salaryMin) return `${formatMoney(job.salaryMin, currency)} – ${formatMoney(job.salaryMax, currency)}`;
  return formatMoney(job.salaryMin || job.salaryMax, currency);
};

/* ------------------------------ Timezones ------------------------------- */

/** `YYYY-MM-DD` and `HH:mm` of an instant in the given IANA timezone. */
export const zonedParts = (iso: string, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
};

const safeTz = (timeZone: string) => {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone });
    return timeZone;
  } catch {
    return undefined;
  }
};

/** Formats an instant in the organization timezone. */
export const formatInTz = (iso: string, timeZone: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(undefined, { timeZone: safeTz(timeZone), ...opts }).format(new Date(iso));

export const interviewWhen = (iso: string, timeZone: string) => ({
  day: formatInTz(iso, timeZone, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }),
  time: formatInTz(iso, timeZone, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
});

export const todayInTz = (timeZone: string) => zonedParts(new Date().toISOString(), safeTz(timeZone) ?? 'UTC').date;

/* -------------------------------- Rating -------------------------------- */

export const RatingStars = ({ value, className, showValue = true }: { value?: number | null; className?: string; showValue?: boolean }) => {
  if (value === null || value === undefined) return <span className="text-xs text-muted">Not rated</span>;
  return (
    <span className={cn('inline-flex items-center gap-1', className)} aria-label={`Rating ${value.toFixed(1)} out of 5`}>
      <span className="flex" aria-hidden>
        {[1, 2, 3, 4, 5].map((i) => (
          <Star key={i} className={cn('h-3.5 w-3.5', i <= Math.round(value) ? 'fill-amber-400 text-amber-400' : 'text-line-strong')} />
        ))}
      </span>
      {showValue && <span className="text-xs font-medium text-fg-2 tabular-nums" aria-hidden>{value.toFixed(1)}</span>}
    </span>
  );
};

/** Accessible 1–5 rating input (radio group, arrow keys supported). */
export const RatingInput = ({ value, onChange, id, invalid }: { value?: number; onChange: (v: number) => void; id?: string; invalid?: boolean }) => {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value ?? 0;
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = Math.min(5, (value ?? 0) + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = Math.max(1, (value ?? 2) - 1);
    if (next === null) return;
    e.preventDefault();
    onChange(next);
    e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next - 1]?.focus();
  };
  const words = ['Poor', 'Below average', 'Average', 'Good', 'Excellent'];
  return (
    <div className="flex items-center gap-3">
      <div id={id} role="radiogroup" aria-invalid={invalid || undefined} className="flex gap-1" onKeyDown={onKeyDown} onMouseLeave={() => setHover(null)}>
        {[1, 2, 3, 4, 5].map((i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={value === i}
            aria-label={`${i} – ${words[i - 1]}`}
            tabIndex={value === i || (!value && i === 1) ? 0 : -1}
            onMouseEnter={() => setHover(i)}
            onClick={() => onChange(i)}
            className="rounded-md p-0.5 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
          >
            <Star className={cn('h-7 w-7 transition-colors', i <= shown ? 'fill-amber-400 text-amber-400' : 'text-line-strong')} />
          </button>
        ))}
      </div>
      <span className="text-sm text-muted">{shown ? words[shown - 1] : 'Select a rating'}</span>
    </div>
  );
};

/* ------------------------------- Tag input ------------------------------ */

/** Chip input for skills: Enter or comma adds, Backspace on empty removes the last. */
export const TagInput = ({
  value,
  onChange,
  id,
  placeholder = 'Type and press Enter',
  max = 30,
  invalid,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  id?: string;
  placeholder?: string;
  max?: number;
  invalid?: boolean;
}) => {
  const [text, setText] = useState('');
  const add = (raw: string) => {
    const parts = raw
      .split(',')
      .map((s) => s.trim().slice(0, 50))
      .filter(Boolean);
    if (!parts.length) return;
    const next = [...value];
    for (const p of parts) if (!next.some((t) => t.toLowerCase() === p.toLowerCase()) && next.length < max) next.push(p);
    onChange(next);
    setText('');
  };
  return (
    <div>
      {value.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Selected skills">
          {value.map((tag) => (
            <li key={tag} className="inline-flex items-center gap-1 rounded-md bg-brand-50 py-0.5 pr-1 pl-2 text-xs font-medium text-brand-700 ring-1 ring-brand-200 ring-inset dark:bg-brand-500/15 dark:text-brand-300 dark:ring-brand-500/30">
              {tag}
              <button type="button" aria-label={`Remove ${tag}`} onClick={() => onChange(value.filter((t) => t !== tag))} className="rounded p-0.5 hover:bg-brand-100 dark:hover:bg-brand-500/25">
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Input
        id={id}
        value={text}
        aria-invalid={invalid || undefined}
        disabled={value.length >= max}
        placeholder={value.length >= max ? `Maximum ${max} reached` : placeholder}
        onChange={(e) => {
          if (e.target.value.includes(',')) add(e.target.value);
          else setText(e.target.value);
        }}
        onBlur={() => add(text)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add(text);
          } else if (e.key === 'Backspace' && !text && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
      />
    </div>
  );
};

export const SkillChips = ({ skills, limit, className }: { skills: string[]; limit?: number; className?: string }) => {
  if (!skills.length) return null;
  const shown = limit ? skills.slice(0, limit) : skills;
  const rest = skills.length - shown.length;
  return (
    <ul className={cn('flex flex-wrap gap-1', className)} aria-label="Skills">
      {shown.map((s) => (
        <li key={s} className="rounded bg-surface-3 px-1.5 py-0.5 text-[11px] font-medium text-fg-2">
          {s}
        </li>
      ))}
      {rest > 0 && <li className="px-1 py-0.5 text-[11px] text-muted">+{rest}</li>}
    </ul>
  );
};
