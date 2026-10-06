import { useId, useState, type DragEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRightLeft, BadgeCheck, Briefcase, ChevronLeft, ChevronRight, Clock, GripVertical, UserX } from 'lucide-react';
import { CANDIDATE_PIPELINE } from '@stencil/shared';
import { Avatar } from '@/components/ui/display';
import { label } from '@/lib/i18n';
import { cn, timeAgo } from '@/lib/utils';
import type { CandidateStage, Pipeline, PipelineCandidate } from '../api';
import { BOARD_STAGES, canHireFrom, manualTargets, RatingStars, SkillChips, stageColor, useStageMover } from './shared';

interface CardAction {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  hidden?: boolean;
}

const CandidateCard = ({
  candidate,
  canMove,
  canHire,
  onMove,
  busy,
  onDragStart,
  onDragEnd,
}: {
  candidate: PipelineCandidate;
  canMove: boolean;
  canHire: boolean;
  onMove: (c: PipelineCandidate, to: CandidateStage) => void;
  busy: boolean;
  onDragStart: (c: PipelineCandidate) => void;
  onDragEnd: () => void;
}) => {
  const navigate = useNavigate();
  const name = `${candidate.firstName} ${candidate.lastName}`;
  const targets = canMove ? manualTargets(candidate.stage) : [];
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const items: CardAction[] = [
    ...targets
      .filter((t) => t !== 'REJECTED')
      .map((t) => ({ label: `Move to ${label(t)}`, icon: <ChevronRight className="h-3.5 w-3.5" />, onSelect: () => onMove(candidate, t) })),
    {
      label: 'Hire…',
      icon: <BadgeCheck className="h-3.5 w-3.5" />,
      hidden: !canHire || !canHireFrom(candidate.stage),
      onSelect: () => navigate(`/recruitment/candidates/${candidate._id}?hire=1`),
    },
    { label: 'Reject…', icon: <UserX className="h-3.5 w-3.5" />, danger: true, hidden: !targets.includes('REJECTED'), onSelect: () => onMove(candidate, 'REJECTED') },
  ];
  const actions = items.filter((i) => !i.hidden);
  const draggable = canMove && targets.length > 0;

  return (
    <article
      aria-label={name}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', candidate._id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart(candidate);
      }}
      onDragEnd={onDragEnd}
      className={cn(
        'group rounded-lg border border-line bg-surface p-3 shadow-sm transition-shadow hover:shadow-pop',
        draggable && 'cursor-grab active:cursor-grabbing',
        busy && 'opacity-60',
      )}
    >
      <div className="flex items-start gap-2.5">
        <Avatar name={name} size="sm" />
        <div className="min-w-0 flex-1">
          <Link to={`/recruitment/candidates/${candidate._id}`} className="block truncate text-sm font-medium text-fg hover:text-brand-600 hover:underline dark:hover:text-brand-400">
            {name}
          </Link>
          <p className="truncate text-xs text-muted">{candidate.email}</p>
        </div>
        {draggable && <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-subtle opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span className="flex items-center gap-1">
          <Briefcase className="h-3.5 w-3.5" aria-hidden />
          {candidate.experienceYears} yrs
        </span>
        <span>{label(candidate.source)}</span>
        {typeof candidate.rating === 'number' && <RatingStars value={candidate.rating} />}
      </div>
      <SkillChips skills={candidate.skills} limit={3} className="mt-2" />
      <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-line pt-2">
        <span className="flex items-center gap-1 text-[11px] text-muted" title="Last updated">
          <Clock className="h-3 w-3" aria-hidden />
          {timeAgo(candidate.updatedAt)}
        </span>
        {actions.length > 0 && (
          <button
            type="button"
            aria-expanded={menuOpen}
            aria-controls={menuId}
            aria-label={`Move ${name}`}
            disabled={busy}
            onClick={() => setMenuOpen((o) => !o)}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-line-strong bg-surface px-2 text-xs font-medium text-fg-2 hover:bg-surface-2 disabled:opacity-50"
          >
            <ArrowRightLeft className="h-3.5 w-3.5" aria-hidden /> Move
          </button>
        )}
      </div>
      {menuOpen && (
        <ul id={menuId} className="mt-2 space-y-1" aria-label={`Move ${name} to`}>
          {actions.map((a) => (
            <li key={a.label}>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  a.onSelect();
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs font-medium',
                  a.danger ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10' : 'text-fg-2 hover:bg-surface-3 hover:text-fg',
                )}
              >
                {a.icon}
                {a.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
};

/**
 * Kanban board of a job's candidates. Moves are made with each card's "Move"
 * menu (keyboard accessible) or by dragging a card onto an allowed column.
 */
export const PipelineBoard = ({ pipeline, canMove, canHire }: { pipeline: Pipeline; canMove: boolean; canHire: boolean }) => {
  const { move, movingId } = useStageMover();
  const [dragging, setDragging] = useState<PipelineCandidate | null>(null);
  const [over, setOver] = useState<CandidateStage | null>(null);
  const [showRejected, setShowRejected] = useState(false);
  const byStage = new Map(pipeline.stages.map((s) => [s.stage, s]));
  const rejected = byStage.get('REJECTED');

  const allowedDrop = (stage: CandidateStage) => !!dragging && stage !== 'HIRED' && CANDIDATE_PIPELINE.can(dragging.stage, stage);

  const dropProps = (stage: CandidateStage) => ({
    onDragOver: (e: DragEvent) => {
      if (!allowedDrop(stage)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (over !== stage) setOver(stage);
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null);
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      const c = dragging;
      setOver(null);
      setDragging(null);
      if (c && allowedDrop(stage)) void move(c, stage);
    },
  });

  const column = (stage: CandidateStage) => {
    const data = byStage.get(stage);
    const candidates = data?.candidates ?? [];
    const droppable = allowedDrop(stage);
    return (
      <section
        key={stage}
        aria-label={`${label(stage)}, ${candidates.length} candidate${candidates.length === 1 ? '' : 's'}`}
        className={cn(
          'flex w-72 shrink-0 flex-col rounded-xl border bg-surface-2 transition-colors',
          droppable ? 'border-dashed border-brand-400' : 'border-line',
          over === stage && 'bg-brand-50 dark:bg-brand-500/10',
          dragging && !droppable && dragging.stage !== stage && 'opacity-50',
        )}
        {...dropProps(stage)}
      >
        <header className="flex items-center justify-between gap-2 px-3 py-2.5">
          <h3 className="flex items-center gap-2 text-xs font-semibold tracking-wide text-fg-2 uppercase">
            <span className={cn('h-2 w-2 rounded-full', stageColor(stage))} aria-hidden />
            {label(stage)}
          </h3>
          <span className="rounded-full bg-surface-3 px-2 py-0.5 text-xs font-medium text-fg-2 tabular-nums">{candidates.length}</span>
        </header>
        <div className="scrollbar-thin flex max-h-[calc(100vh-22rem)] min-h-32 flex-col gap-2 overflow-y-auto px-2 pb-2">
          {candidates.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-xs text-muted">{droppable ? 'Drop here' : 'No candidates'}</p>
          ) : (
            candidates.map((c) => (
              <CandidateCard
                key={c._id}
                candidate={c}
                canMove={canMove}
                canHire={canHire}
                busy={movingId === c._id}
                onMove={(cand, to) => void move(cand, to)}
                onDragStart={setDragging}
                onDragEnd={() => {
                  setDragging(null);
                  setOver(null);
                }}
              />
            ))
          )}
        </div>
      </section>
    );
  };

  return (
    <div className="scrollbar-thin -mx-4 overflow-x-auto px-4 pb-3 sm:mx-0 sm:px-0" role="region" aria-label="Candidate pipeline" tabIndex={0}>
      <div className="flex min-w-max gap-3">
        {BOARD_STAGES.map(column)}
        {showRejected ? (
          <div className="flex flex-col gap-2">
            {column('REJECTED')}
            <button type="button" onClick={() => setShowRejected(false)} className="flex items-center justify-center gap-1 text-xs text-muted hover:text-fg">
              <ChevronLeft className="h-3.5 w-3.5" /> Collapse rejected
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowRejected(true)}
            aria-expanded={false}
            aria-label={`Show rejected candidates (${rejected?.count ?? 0})`}
            className={cn(
              'flex w-12 shrink-0 flex-col items-center gap-3 rounded-xl border border-line bg-surface-2 py-3 text-xs font-semibold tracking-wide text-muted uppercase transition-colors hover:text-fg',
              allowedDrop('REJECTED') && 'border-dashed border-red-400',
              over === 'REJECTED' && 'bg-red-50 dark:bg-red-500/10',
            )}
            {...dropProps('REJECTED')}
          >
            <span className="rounded-full bg-surface-3 px-1.5 py-0.5 text-fg-2 tabular-nums">{rejected?.count ?? 0}</span>
            <span className="[writing-mode:vertical-rl]">Rejected</span>
          </button>
        )}
      </div>
    </div>
  );
};
