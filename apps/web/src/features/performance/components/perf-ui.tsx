import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, MessageSquareHeart, RefreshCcw, Target, ClipboardCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge, type Tone } from '@/components/ui/display';
import { Select } from '@/components/ui/input';
import { label } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import type { Cycle, FeedbackType, FeedbackVisibility, Goal, GoalCategory, RatingScale } from '../api';
import { ratingLabel } from '../api';

/* ------------------------------ Badges ------------------------------ */

const CATEGORY_TONES: Record<GoalCategory, Tone> = { KPI: 'brand', OKR: 'purple', DEVELOPMENT: 'teal', PROJECT: 'blue', OTHER: 'gray' };
export const CATEGORY_LABELS: Record<GoalCategory, string> = { KPI: 'KPI', OKR: 'OKR', DEVELOPMENT: 'Development', PROJECT: 'Project', OTHER: 'Other' };

export const CategoryBadge = ({ category }: { category: GoalCategory }) => <Badge tone={CATEGORY_TONES[category] ?? 'gray'}>{CATEGORY_LABELS[category] ?? label(category)}</Badge>;

export const FEEDBACK_TYPES: { value: FeedbackType; label: string; tone: Tone; description: string }[] = [
  { value: 'PRAISE', label: 'Praise', tone: 'green', description: 'Recognize great work' },
  { value: 'CONSTRUCTIVE', label: 'Constructive', tone: 'amber', description: 'Suggest an improvement' },
  { value: 'GENERAL', label: 'General', tone: 'gray', description: 'Share an observation' },
];

export const VISIBILITY_OPTIONS: { value: FeedbackVisibility; label: string; description: string }[] = [
  { value: 'PRIVATE', label: 'Private', description: 'Only the recipient and HR can see it' },
  { value: 'MANAGER', label: 'Recipient & manager', description: 'The recipient, their manager and HR' },
  { value: 'PUBLIC', label: 'Public', description: 'Anyone in the organization' },
];

export const FeedbackTypeBadge = ({ type }: { type: FeedbackType }) => {
  const t = FEEDBACK_TYPES.find((f) => f.value === type);
  return <Badge tone={t?.tone ?? 'gray'}>{t?.label ?? label(type)}</Badge>;
};

export const progressTone = (goal: Pick<Goal, 'status' | 'progress'>) => (goal.status === 'COMPLETED' ? 'green' : goal.status === 'CANCELLED' ? 'amber' : 'brand');

/* -------------------------- Rating controls ------------------------- */

const scalePoints = (scale: RatingScale) => {
  const points: number[] = [];
  for (let v = Math.ceil(scale.min); v <= scale.max; v++) points.push(v);
  return points;
};

/**
 * Keyboard-operable rating picker (radio group with roving focus). Arrow keys
 * move and select; Home/End jump to the ends of the scale.
 */
export const RatingInput = ({
  value,
  onChange,
  scale,
  labelledBy,
  label: ariaLabel,
  invalid,
  disabled,
  allowClear,
}: {
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  scale: RatingScale;
  labelledBy?: string;
  label?: string;
  invalid?: boolean;
  disabled?: boolean;
  allowClear?: boolean;
}) => {
  const points = scalePoints(scale);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIdx = value === null || value === undefined ? -1 : points.indexOf(value);
  const focusIdx = selectedIdx >= 0 ? selectedIdx : 0;

  const move = (idx: number) => {
    const next = Math.max(0, Math.min(points.length - 1, idx));
    onChange(points[next]!);
    refs.current[next]?.focus();
  };
  const onKeyDown = (e: KeyboardEvent, i: number) => {
    const map: Record<string, number> = { ArrowRight: i + 1, ArrowUp: i + 1, ArrowLeft: i - 1, ArrowDown: i - 1, Home: 0, End: points.length - 1 };
    if (e.key in map) {
      e.preventDefault();
      move(map[e.key]!);
    }
  };
  const current = ratingLabel(value, scale);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div
        role="radiogroup"
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : ariaLabel}
        aria-invalid={invalid || undefined}
        className={cn('inline-flex flex-wrap gap-1 rounded-lg', invalid && 'ring-2 ring-red-500/40')}
      >
        {points.map((p, i) => {
          const selected = p === value;
          const pointLabel = scale.labels.find((l) => l.value === p)?.label;
          return (
            <button
              key={p}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={pointLabel ? `${p} – ${pointLabel}` : String(p)}
              title={pointLabel}
              tabIndex={i === focusIdx ? 0 : -1}
              disabled={disabled}
              onClick={() => onChange(p)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cn(
                'h-9 min-w-9 rounded-lg border px-2 text-sm font-semibold tabular-nums transition-colors focus:ring-2 focus:ring-brand-500/40 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60',
                selected ? 'border-brand-600 bg-brand-600 text-white' : 'border-line-strong bg-surface text-fg-2 hover:border-brand-400 hover:text-fg',
              )}
            >
              {p}
            </button>
          );
        })}
      </div>
      <span className="text-sm text-muted" aria-live="polite">
        {current ?? (value !== null && value !== undefined ? `${value} / ${scale.max}` : 'Not rated')}
      </span>
      {allowClear && value !== null && value !== undefined && !disabled && (
        <Button variant="link" size="xs" onClick={() => onChange(null)}>
          Clear
        </Button>
      )}
    </div>
  );
};

/** Read-only rating with label, e.g. "4 / 5 · Exceeds expectations". */
export const RatingValue = ({ value, scale, className }: { value: number | null | undefined; scale: RatingScale; className?: string }) => {
  if (value === null || value === undefined) return <span className={cn('text-muted', className)}>—</span>;
  const lbl = ratingLabel(value, scale);
  return (
    <span className={cn('inline-flex flex-wrap items-baseline gap-x-1.5', className)}>
      <span className="font-semibold text-fg tabular-nums">
        {Number.isInteger(value) ? value : value.toFixed(2)}
        <span className="font-normal text-muted"> / {scale.max}</span>
      </span>
      {lbl && <span className="text-muted">· {lbl}</span>}
    </span>
  );
};

/* ------------------------------ Stepper ----------------------------- */

export const Stepper = ({ steps, current, label: ariaLabel }: { steps: { key: string; label: string; hint?: ReactNode }[]; current: number; label: string }) => (
  <ol aria-label={ariaLabel} className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-0">
    {steps.map((s, i) => {
      const done = i < current;
      const active = i === current;
      return (
        <li key={s.key} aria-current={active ? 'step' : undefined} className="flex flex-1 items-start gap-3 sm:flex-col sm:items-center sm:gap-2 sm:text-center">
          <div className="flex w-auto items-center sm:w-full">
            <span className={cn('hidden h-0.5 flex-1 sm:block', i === 0 ? 'invisible' : done || active ? 'bg-brand-600' : 'bg-line')} aria-hidden />
            <span
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold',
                done && 'border-brand-600 bg-brand-600 text-white',
                active && 'border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300',
                !done && !active && 'border-line-strong bg-surface text-muted',
              )}
            >
              {done ? <Check className="h-4 w-4" aria-hidden /> : i + 1}
            </span>
            <span className={cn('hidden h-0.5 flex-1 sm:block', i === steps.length - 1 ? 'invisible' : done ? 'bg-brand-600' : 'bg-line')} aria-hidden />
          </div>
          <div className="min-w-0 sm:px-2">
            <p className={cn('text-sm font-medium', active ? 'text-fg' : done ? 'text-fg-2' : 'text-muted')}>
              {s.label}
              <span className="sr-only">{done ? ' (done)' : active ? ' (current)' : ''}</span>
            </p>
            {s.hint && <p className="text-xs text-muted">{s.hint}</p>}
          </div>
        </li>
      );
    })}
  </ol>
);

/* --------------------------- Cycle select --------------------------- */

export const CycleSelect = ({
  cycles,
  value,
  onChange,
  placeholder = 'All cycles',
  className,
  id,
}: {
  cycles: Cycle[] | undefined;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  id?: string;
}) => (
  <Select
    id={id}
    aria-label={id ? undefined : 'Cycle'}
    className={className ?? 'w-full sm:w-52'}
    value={value}
    onChange={(e) => onChange(e.target.value)}
    placeholder={placeholder}
    options={(cycles ?? []).map((c) => ({ value: c._id, label: `${c.name}${c.status === 'COMPLETED' ? ' (completed)' : ''}` }))}
  />
);

/* ------------------------- Section navigation ----------------------- */

export const useCanManageCycles = () => {
  const { canAny } = usePermissions();
  return canAny('performance:create', 'performance:review');
};

/** Header links between the performance sections the sidebar doesn't list. */
export const PerformanceLinks = ({ current }: { current: 'goals' | 'reviews' | 'feedback' | 'cycles' }) => {
  const navigate = useNavigate();
  const canCycles = useCanManageCycles();
  const links = [
    { key: 'goals', label: 'Goals', to: '/performance/goals', icon: <Target className="h-4 w-4" /> },
    { key: 'reviews', label: 'Reviews', to: '/performance/reviews', icon: <ClipboardCheck className="h-4 w-4" /> },
    { key: 'feedback', label: 'Feedback', to: '/performance/feedback', icon: <MessageSquareHeart className="h-4 w-4" /> },
    { key: 'cycles', label: 'Cycles', to: '/performance/cycles', icon: <RefreshCcw className="h-4 w-4" />, hidden: !canCycles },
  ].filter((l) => l.key !== current && !l.hidden);
  return (
    <>
      {links.map((l) => (
        <Button key={l.key} variant="outline" icon={l.icon} onClick={() => navigate(l.to)}>
          {l.label}
        </Button>
      ))}
    </>
  );
};

/* ----------------------------- Abilities ---------------------------- */

const TERMINAL = new Set(['COMPLETED', 'CANCELLED']);

/**
 * Mirrors the API's goal rules to decide which actions to show. The API is
 * the authority (manager-of checks include indirect reports).
 */
export const useGoalAbilities = (goal: Goal | undefined) => {
  const { user, can, isManager } = usePermissions();
  if (!goal || !user) return { isSelf: false, canManage: false, canEdit: false, canProgress: false, canCancel: false, canDelete: false, locked: true, terminal: false };
  const isSelf = !!user.employeeId && goal.employeeId?._id === user.employeeId;
  const isHr = can('performance:create') && can('performance:read');
  const canManage = isHr || (!isSelf && isManager);
  const isCreator = !!goal.createdBy && goal.createdBy === user._id;
  const locked = goal.cycleId?.status === 'COMPLETED';
  const terminal = TERMINAL.has(goal.status);
  return {
    isSelf,
    canManage,
    locked,
    terminal,
    canEdit: !locked && (canManage || (isCreator && !terminal)),
    canProgress: !locked && (canManage || (isSelf && !terminal)),
    canCancel: !locked && canManage && !terminal,
    canDelete: canManage,
  };
};
