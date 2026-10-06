import { useId, useMemo, useState } from 'react';
import { Controller, useForm, type Control } from 'react-hook-form';
import { toast } from 'sonner';
import { Calculator } from 'lucide-react';
import { hrReviewSubmitSchema, reviewSubmitSchema } from '@stencil/shared';
import { FormError, FormField } from '@/components/forms/form';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, ProgressBar } from '@/components/ui/display';
import { Checkbox, Textarea } from '@/components/ui/input';
import { useConfirm } from '@/components/ui/overlay';
import { toApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import { ratingLabel, useSubmitReview, type RatingScale, type ReviewDetail, type ReviewGoal, type ReviewSection, type ReviewStage } from '../api';
import { CategoryBadge, RatingInput, RatingValue } from './perf-ui';

interface ItemValue {
  rating: number | null;
  comment: string;
}

interface FormValues {
  goals: (ItemValue & { goalId: string })[];
  competencies: (ItemValue & { competency: string })[];
  overallRating: number | null;
  overrideOverall: boolean;
  strengths: string;
  improvements: string;
  comments: string;
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Client-side preview of the API's final score formula (the API result is authoritative). */
export const previewFinalRating = (input: {
  goals: { weight: number; progress: number; rating: number | null }[];
  overall: number | null;
  goalWeightage: number;
  scale: RatingScale;
}) => {
  if (input.overall === null) return null;
  const { scale } = input;
  let goalScore: number | null = null;
  if (input.goals.length) {
    const weighted = input.goals.some((g) => g.weight > 0);
    let sumW = 0;
    let sum = 0;
    for (const g of input.goals) {
      const w = weighted ? Math.max(0, g.weight) : 1;
      const r = g.rating !== null ? clamp(g.rating, scale.min, scale.max) : scale.min + (clamp(g.progress, 0, 100) / 100) * (scale.max - scale.min);
      sumW += w;
      sum += w * r;
    }
    goalScore = sumW > 0 ? round2(sum / sumW) : null;
  }
  const w = goalScore === null ? 0 : clamp(input.goalWeightage, 0, 100) / 100;
  const finalRating = round2(clamp(w * (goalScore ?? 0) + (1 - w) * input.overall, scale.min, scale.max));
  return { goalScore, finalRating, label: ratingLabel(finalRating, scale) };
};

const findRating = (section: ReviewSection | null | undefined, match: (r: { goalId?: string | null; competency?: string | null }) => boolean) =>
  section?.ratings?.find((r) => match(r))?.rating ?? null;

/** Earlier sections' ratings shown as reference beside each item. */
const References = ({ items, scale }: { items: { who: string; value: number | null }[]; scale: RatingScale }) => {
  const visible = items.filter((i) => i.value !== null);
  if (!visible.length) return null;
  return (
    <p className="text-xs text-muted">
      {visible.map((i, idx) => (
        <span key={i.who}>
          {idx > 0 && ' · '}
          {i.who}: <span className="font-medium text-fg-2">{i.value}</span>
          {ratingLabel(i.value, scale) ? ` (${ratingLabel(i.value, scale)})` : ''}
        </span>
      ))}
    </p>
  );
};

const RatedItem = ({
  title,
  meta,
  scale,
  name,
  control,
  references,
}: {
  title: React.ReactNode;
  meta?: React.ReactNode;
  scale: RatingScale;
  name: `goals.${number}` | `competencies.${number}`;
  control: Control<FormValues>;
  references: { who: string; value: number | null }[];
}) => {
  const titleId = useId();
  const commentId = useId();
  return (
    <li className="space-y-2.5 py-4">
      <div>
        <p id={titleId} className="text-sm font-medium text-fg">
          {title}
        </p>
        {meta && <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">{meta}</div>}
        <References items={references} scale={scale} />
      </div>
      <Controller
        control={control}
        name={`${name}.rating`}
        render={({ field }) => <RatingInput labelledBy={titleId} value={field.value as number | null} onChange={field.onChange} scale={scale} allowClear />}
      />
      <Controller
        control={control}
        name={`${name}.comment`}
        render={({ field }) => (
          <div>
            <label htmlFor={commentId} className="sr-only">
              Comment
            </label>
            <Textarea id={commentId} rows={2} maxLength={2000} placeholder="Comment (optional)" value={field.value as string} onChange={field.onChange} />
          </div>
        )}
      />
    </li>
  );
};

const STAGE_COPY: Record<ReviewStage, { title: string; description: string; submit: string; confirm: string }> = {
  self: {
    title: 'Your self review',
    description: 'Reflect on your goals and competencies. Once submitted it goes to your manager and cannot be edited.',
    submit: 'Submit self review',
    confirm: 'Your manager will be notified. You cannot edit the self review afterwards.',
  },
  manager: {
    title: 'Manager review',
    description: 'Rate goals and competencies and give an overall rating. Unrated goals are scored from their progress.',
    submit: 'Submit manager review',
    confirm: 'The review moves to HR for finalization. You cannot edit it afterwards.',
  },
  hr: {
    title: 'HR review & finalization',
    description: 'Calibrate ratings if needed and finalize. The final rating is computed from goal scores and the overall rating.',
    submit: 'Finalize review',
    confirm: 'The final rating is computed and the review is completed. The employee and manager will be notified and can see the result.',
  },
};

export const ReviewForm = ({
  review,
  stage,
  scale,
  competencies,
  goalWeightage,
}: {
  review: ReviewDetail;
  stage: ReviewStage;
  scale: RatingScale;
  competencies: string[];
  goalWeightage: number;
}) => {
  const submit = useSubmitReview(review._id, stage);
  const confirm = useConfirm();
  const [serverError, setServerError] = useState<string | null>(null);
  const overallId = useId();
  const goals = useMemo(() => review.goals.filter((g) => g.status !== 'CANCELLED'), [review.goals]);
  const copy = STAGE_COPY[stage];
  const managerOverall = review.managerReview?.overallRating ?? null;

  const { control, handleSubmit, watch, register, formState, setError, clearErrors } = useForm<FormValues>({
    defaultValues: {
      goals: goals.map((g) => ({ goalId: g._id, rating: null, comment: '' })),
      competencies: competencies.map((c) => ({ competency: c, rating: null, comment: '' })),
      overallRating: null,
      overrideOverall: false,
      strengths: '',
      improvements: '',
      comments: '',
    },
  });

  const overrideOverall = watch('overrideOverall');
  const overallRequired = stage !== 'hr' || overrideOverall;
  const values = watch();

  const refsFor = (match: (r: { goalId?: string | null; competency?: string | null }) => boolean) => [
    ...(stage !== 'self' ? [{ who: 'Self', value: findRating(review.selfReview, match) }] : []),
    ...(stage === 'hr' ? [{ who: 'Manager', value: findRating(review.managerReview, match) }] : []),
  ];

  const preview =
    stage === 'hr'
      ? previewFinalRating({
          goals: goals.map((g, i) => ({
            weight: g.weight || 0,
            progress: g.progress || 0,
            rating: values.goals[i]?.rating ?? findRating(review.managerReview, (r) => r.goalId === g._id),
          })),
          overall: overrideOverall ? values.overallRating : managerOverall,
          goalWeightage,
          scale,
        })
      : null;

  const onSubmit = handleSubmit(async (v) => {
    setServerError(null);
    if (overallRequired && v.overallRating === null) {
      setError('overallRating', { type: 'required', message: 'Choose an overall rating' });
      return;
    }
    const payload = {
      ratings: [
        ...v.goals.filter((g) => g.rating !== null).map((g) => ({ goalId: g.goalId, rating: g.rating!, comment: g.comment.trim() || undefined })),
        ...v.competencies.filter((c) => c.rating !== null).map((c) => ({ competency: c.competency, rating: c.rating!, comment: c.comment.trim() || undefined })),
      ],
      overallRating: overallRequired ? (v.overallRating ?? undefined) : undefined,
      strengths: v.strengths.trim() || undefined,
      improvements: v.improvements.trim() || undefined,
      comments: v.comments.trim() || undefined,
    };
    const parsed = (stage === 'hr' ? hrReviewSubmitSchema : reviewSubmitSchema).safeParse(payload);
    if (!parsed.success) {
      setServerError(parsed.error.issues[0]?.message ?? 'Please check the form');
      return;
    }
    const { confirmed } = await confirm({ title: `${copy.submit}?`, message: copy.confirm, confirmLabel: copy.submit, tone: 'primary' });
    if (!confirmed) return;
    try {
      const res = await submit.mutateAsync(parsed.data);
      toast.success(res.message ?? 'Review submitted');
    } catch (err) {
      const apiErr = toApiError(err);
      const overallErr = apiErr.fieldErrors.find((f) => f.path === 'overallRating');
      if (overallErr) setError('overallRating', { type: 'server', message: overallErr.message });
      setServerError(apiErr.message);
    }
  });

  return (
    <Card className="border-brand-200 dark:border-brand-500/30">
      <CardHeader title={copy.title} description={copy.description} />
      <CardBody>
        <form onSubmit={onSubmit} noValidate className="space-y-8">
          <FormError error={serverError} />

          {goals.length > 0 && (
            <section aria-labelledby={`${overallId}-goals`}>
              <h3 id={`${overallId}-goals`} className="text-sm font-semibold text-fg">
                Goals
              </h3>
              <p className="text-xs text-muted">Optional per goal. Unrated goals are scored from their progress.</p>
              <ul className="divide-y divide-line">
                {goals.map((g, i) => (
                  <RatedItem
                    key={g._id}
                    name={`goals.${i}`}
                    control={control}
                    scale={scale}
                    title={g.title}
                    meta={<GoalMeta goal={g} />}
                    references={refsFor((r) => r.goalId === g._id)}
                  />
                ))}
              </ul>
            </section>
          )}

          {competencies.length > 0 && (
            <section aria-labelledby={`${overallId}-comp`}>
              <h3 id={`${overallId}-comp`} className="text-sm font-semibold text-fg">
                Competencies
              </h3>
              <ul className="divide-y divide-line">
                {competencies.map((c, i) => (
                  <RatedItem key={c} name={`competencies.${i}`} control={control} scale={scale} title={c} references={refsFor((r) => r.competency === c)} />
                ))}
              </ul>
            </section>
          )}

          <section className="space-y-3 rounded-lg border border-line bg-surface-2 p-4">
            <p id={overallId} className="text-sm font-semibold text-fg">
              Overall rating{overallRequired && <span className="ml-0.5 text-red-500" aria-hidden>*</span>}
            </p>
            {stage === 'hr' && (
              <>
                <p className="text-sm text-muted">
                  Manager&apos;s overall rating: <RatingValue value={managerOverall} scale={scale} />
                </p>
                <Checkbox
                  label="Override the manager's overall rating"
                  checked={overrideOverall}
                  {...register('overrideOverall', { onChange: () => clearErrors('overallRating') })}
                />
              </>
            )}
            {overallRequired && (
              <Controller
                control={control}
                name="overallRating"
                render={({ field, fieldState }) => (
                  <div className="space-y-1.5">
                    <RatingInput
                      labelledBy={overallId}
                      value={field.value}
                      onChange={(v) => {
                        field.onChange(v);
                        clearErrors('overallRating');
                      }}
                      scale={scale}
                      invalid={!!fieldState.error}
                    />
                    {fieldState.error && (
                      <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                        {fieldState.error.message}
                      </p>
                    )}
                  </div>
                )}
              />
            )}
          </section>

          <div className="grid gap-4 md:grid-cols-2">
            <FormField label={stage === 'self' ? 'What went well' : 'Strengths'}>
              {({ id }) => <Textarea id={id} rows={4} maxLength={3000} {...register('strengths')} />}
            </FormField>
            <FormField label={stage === 'self' ? 'What I want to improve' : 'Areas for improvement'}>
              {({ id }) => <Textarea id={id} rows={4} maxLength={3000} {...register('improvements')} />}
            </FormField>
          </div>
          <FormField label="Additional comments">{({ id }) => <Textarea id={id} rows={3} maxLength={3000} {...register('comments')} />}</FormField>

          {preview && (
            <div className="flex items-start gap-3 rounded-lg border border-brand-200 bg-brand-50 p-4 dark:border-brand-500/30 dark:bg-brand-500/10" aria-live="polite">
              <Calculator className="mt-0.5 h-5 w-5 shrink-0 text-brand-600 dark:text-brand-300" aria-hidden />
              <div className="text-sm">
                <p className="font-medium text-fg">
                  Estimated final rating: <RatingValue value={preview.finalRating} scale={scale} />
                </p>
                <p className="mt-0.5 text-muted">
                  {preview.goalScore !== null
                    ? `${goalWeightage}% goal score (${preview.goalScore}) + ${100 - goalWeightage}% overall rating.`
                    : 'No active goals: the overall rating counts 100%.'}{' '}
                  The final value is computed on submission.
                </p>
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <Button type="submit" loading={formState.isSubmitting} className="w-full sm:w-auto">
              {copy.submit}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
};

export const GoalMeta = ({ goal }: { goal: ReviewGoal }) => (
  <>
    <CategoryBadge category={goal.category} />
    {goal.weight > 0 && <span>{goal.weight}% weight</span>}
    <span className="flex items-center gap-1.5">
      <ProgressBar value={goal.progress} className="h-1.5 w-16" tone={goal.status === 'COMPLETED' ? 'green' : 'brand'} />
      {goal.progress}%
    </span>
  </>
);

/** Read-only rendering of a submitted review section. */
export const ReviewSectionView = ({
  title,
  section,
  goals,
  scale,
  submittedByLabel,
}: {
  title: string;
  section: ReviewSection;
  goals: ReviewGoal[];
  scale: RatingScale;
  submittedByLabel?: string;
}) => {
  const goalRatings = section.ratings.filter((r) => r.goalId);
  const compRatings = section.ratings.filter((r) => !r.goalId && r.competency);
  const text = (lbl: string, v?: string | null) =>
    v ? (
      <div>
        <dt className="text-xs font-medium text-muted">{lbl}</dt>
        <dd className="mt-1 text-sm whitespace-pre-line text-fg-2">{v}</dd>
      </div>
    ) : null;
  return (
    <Card>
      <CardHeader
        title={title}
        description={[section.submittedAt ? `Submitted ${formatDateTime(section.submittedAt)}` : null, submittedByLabel].filter(Boolean).join(' · ') || undefined}
        actions={section.overallRating !== null && section.overallRating !== undefined ? <RatingValue value={section.overallRating} scale={scale} className="text-sm" /> : undefined}
      />
      <CardBody className="space-y-5">
        {(goalRatings.length > 0 || compRatings.length > 0) && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">{title} ratings</caption>
              <thead>
                <tr className="text-left text-xs text-muted uppercase">
                  <th scope="col" className="pr-4 pb-2 font-semibold">Item</th>
                  <th scope="col" className="pr-4 pb-2 font-semibold whitespace-nowrap">Rating</th>
                  <th scope="col" className="pb-2 font-semibold">Comment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {[...goalRatings, ...compRatings].map((r, i) => (
                  <tr key={i} className="align-top">
                    <td className="py-2 pr-4 text-fg">
                      {r.goalId ? (goals.find((g) => g._id === r.goalId)?.title ?? 'Goal') : r.competency}
                      <span className="block text-xs text-muted">{r.goalId ? 'Goal' : 'Competency'}</span>
                    </td>
                    <td className="py-2 pr-4 whitespace-nowrap">
                      <RatingValue value={r.rating} scale={scale} />
                    </td>
                    <td className="py-2 text-fg-2">{r.comment || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <dl className="grid gap-4 md:grid-cols-2">
          {text('Strengths', section.strengths)}
          {text('Areas for improvement', section.improvements)}
        </dl>
        {section.comments && <dl>{text('Comments', section.comments)}</dl>}
        {!section.ratings.length && !section.strengths && !section.improvements && !section.comments && <p className="text-sm text-muted">Only an overall rating was given.</p>}
      </CardBody>
    </Card>
  );
};
