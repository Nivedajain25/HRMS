import { Check, X } from 'lucide-react';
import { OFFBOARDING_STEPS, type OffboardingStatus } from '@stencil/shared';
import { label } from '@/lib/i18n';
import { cn, formatDate } from '@/lib/utils';
import type { TimelineEntry } from '../api';

type StepState = 'done' | 'current' | 'upcoming' | 'stopped';

/** Index of the step the workflow is on (for cancelled records: the step it stopped at). */
const currentIndex = (status: OffboardingStatus, timeline: TimelineEntry[] = []) => {
  if (status !== 'CANCELLED') return OFFBOARDING_STEPS.indexOf(status);
  const reached = [...timeline].reverse().find((t) => t.status !== 'CANCELLED');
  return reached ? OFFBOARDING_STEPS.indexOf(reached.status) : 0;
};

const stepStates = (status: OffboardingStatus, timeline?: TimelineEntry[]): StepState[] => {
  const idx = currentIndex(status, timeline);
  return OFFBOARDING_STEPS.map((_, i) => {
    if (status === 'COMPLETED') return 'done';
    if (i < idx) return 'done';
    if (i === idx) return status === 'CANCELLED' ? 'stopped' : 'current';
    return 'upcoming';
  });
};

const reachedAt = (step: OffboardingStatus, timeline: TimelineEntry[] = []) => [...timeline].reverse().find((t) => t.status === step)?.at;

const STATE_TEXT: Record<StepState, string> = { done: 'completed', current: 'current step', upcoming: 'not started', stopped: 'cancelled at this step' };

/** Full workflow stepper: vertical on small screens, horizontal from `md`. */
export const OffboardingStepper = ({ status, timeline }: { status: OffboardingStatus; timeline: TimelineEntry[] }) => {
  const states = stepStates(status, timeline);
  return (
    <ol aria-label="Offboarding progress" className="flex flex-col md:grid md:grid-cols-8">
      {OFFBOARDING_STEPS.map((step, i) => {
        const state = states[i]!;
        const at = state === 'done' || state === 'current' || state === 'stopped' ? reachedAt(step, timeline) : undefined;
        const last = i === OFFBOARDING_STEPS.length - 1;
        return (
          <li
            key={step}
            aria-current={state === 'current' || (status === 'COMPLETED' && last) ? 'step' : undefined}
            className="relative flex gap-3 pb-5 last:pb-0 md:flex-col md:items-center md:gap-2 md:pb-0 md:text-center"
          >
            {!last && (
              <span
                aria-hidden
                className={cn(
                  'absolute top-9 bottom-1 left-[15px] w-0.5 rounded-full md:top-[15px] md:right-[calc(-50%+22px)] md:bottom-auto md:left-[calc(50%+22px)] md:h-0.5 md:w-auto',
                  state === 'done' ? 'bg-brand-600 dark:bg-brand-500' : 'bg-line',
                )}
              />
            )}
            <span
              aria-hidden
              className={cn(
                'relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold transition-colors',
                state === 'done' && 'border-brand-600 bg-brand-600 text-white dark:border-brand-500 dark:bg-brand-500',
                state === 'current' && 'border-brand-600 bg-surface text-brand-700 ring-4 ring-brand-500/15 dark:border-brand-400 dark:text-brand-300',
                state === 'upcoming' && 'border-line-strong bg-surface text-muted',
                state === 'stopped' && 'border-red-500 bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-400',
              )}
            >
              {state === 'done' ? <Check className="h-4 w-4" /> : state === 'stopped' ? <X className="h-4 w-4" /> : i + 1}
            </span>
            <div className="min-w-0 pt-1 md:px-1 md:pt-0">
              <p className={cn('text-sm leading-tight font-medium md:text-xs', state === 'upcoming' ? 'text-muted' : 'text-fg', state === 'current' && 'text-brand-700 dark:text-brand-300')}>
                {label(step)}
              </p>
              <p className="mt-0.5 text-xs text-muted md:text-[11px]">
                {at ? formatDate(at) : state === 'current' ? 'In progress' : ''}
                <span className="sr-only"> ({STATE_TEXT[state]})</span>
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
};

/** Compact progress indicator for list rows. */
export const CompactStepper = ({ status, timeline }: { status: OffboardingStatus; timeline?: TimelineEntry[] }) => {
  const states = stepStates(status, timeline);
  const idx = currentIndex(status, timeline);
  const text =
    status === 'CANCELLED'
      ? `Cancelled at ${label(OFFBOARDING_STEPS[idx])}`
      : status === 'COMPLETED'
        ? 'Completed'
        : `Step ${idx + 1} of ${OFFBOARDING_STEPS.length}: ${label(status)}`;
  return (
    <div className="min-w-44">
      <div className="flex items-center gap-1" role="img" aria-label={text}>
        {states.map((s, i) => (
          <span
            key={OFFBOARDING_STEPS[i]}
            className={cn(
              'h-1.5 flex-1 rounded-full',
              s === 'done' && (status === 'COMPLETED' ? 'bg-emerald-500' : 'bg-brand-600 dark:bg-brand-500'),
              s === 'current' && 'bg-brand-400 ring-2 ring-brand-500/25',
              s === 'upcoming' && 'bg-surface-3',
              s === 'stopped' && 'bg-red-400',
            )}
          />
        ))}
      </div>
      <p className="mt-1 text-xs text-muted" aria-hidden>
        {text}
      </p>
    </div>
  );
};
