import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Hourglass, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/overlay';
import { cn, timeAgo } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { CATEGORY_META, useMyLatestEmergency, type Emergency } from '../api';

const SEEN_KEY = 'emergencies:my-decisions-seen';
const readSeen = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
};
const writeSeen = (ids: string[]) => {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(ids.slice(-50)));
  } catch {
    /* storage unavailable */
  }
};

const DAY = 24 * 60 * 60 * 1000;
const who = (p?: { firstName: string; lastName: string } | null) => (p ? `${p.firstName} ${p.lastName}`.trim() : 'HR');
/** HR's message sent with the decision ("Approved: …" note), if any. */
const decisionMessage = (e: Emergency) => {
  const last = e.notes.at(-1)?.text ?? '';
  const m = /^(Approved|Declined):\s*(.+)$/s.exec(last);
  return m?.[2] ?? null;
};

/**
 * The employee's side of an emergency: a bar at the top while HR has it, then — the moment HR approves or
 * declines — a one-time pop-up. The decision itself lives in Notifications (with the push), not in a bar.
 */
export const MyEmergencyStatus = () => {
  const { hasEmployee } = usePermissions();
  const q = useMyLatestEmergency(hasEmployee);
  const [seen, setSeen] = useState<string[]>(readSeen);
  const e = q.data;
  if (!e) return null;

  const waiting = e.status !== 'RESOLVED';
  const decided = !!e.decision && !!e.decidedAt && Date.now() - Date.parse(e.decidedAt) < DAY;
  if (!waiting && !decided) return null;

  const approved = e.decision === 'APPROVED';
  const popupOpen = decided && !seen.includes(e._id);
  const message = decided ? decisionMessage(e) : null;
  const markSeen = () => {
    const next = [...seen, e._id];
    setSeen(next);
    writeSeen(next);
  };

  // Top bar only while waiting for HR; the decision goes to Notifications.
  const bar = waiting ? (
    <div role="status" className="flex items-center gap-3 bg-amber-500 px-4 py-2 text-sm text-white sm:px-6">
      <Hourglass className="h-4 w-4 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1 truncate">
        <strong>Your emergency alert is with HR</strong>
        <span className="opacity-90">{` · ${e.status === 'ACKNOWLEDGED' ? `seen by ${who(e.acknowledgedBy)}` : 'waiting for a response'} · raised ${timeAgo(e.createdAt)}`}</span>
      </p>
      <Link to={`/emergencies/${e._id}`} className="shrink-0 rounded-md bg-white/20 px-2.5 py-1 text-xs font-semibold hover:bg-white/30">
        View
      </Link>
    </div>
  ) : null;

  return (
    <>
      {bar}
      {popupOpen && (
        <Modal
          open
          onClose={markSeen}
          size="sm"
          title={
            <span className="flex items-center gap-2.5">
              <span
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
                  approved ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-300' : 'bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-300',
                )}
                aria-hidden
              >
                {approved ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
              </span>
              {approved ? 'Approved — you can leave' : 'Request declined'}
            </span>
          }
        >
          <div className="space-y-4">
            <div
              className={cn(
                'rounded-xl border p-3.5',
                approved ? 'border-emerald-100 bg-emerald-50/70 dark:border-emerald-500/20 dark:bg-emerald-500/10' : 'border-red-100 bg-red-50/70 dark:border-red-500/20 dark:bg-red-500/10',
              )}
            >
              <p className="text-sm text-fg">
                <strong>{who(e.decidedBy)}</strong> {approved ? 'approved' : 'declined'} your {CATEGORY_META[e.category].title.toLowerCase()} alert{' '}
                <span className="text-muted">{timeAgo(e.decidedAt!)}</span>.
              </p>
              {message ? (
                <p className={cn('mt-2 text-sm italic', approved ? 'text-emerald-900 dark:text-emerald-100' : 'text-red-900 dark:text-red-100')}>“{message}”</p>
              ) : (
                <p className="mt-2 text-sm text-muted">{approved ? 'You can go now — take care.' : 'Please speak to HR or your manager.'}</p>
              )}
            </div>
            <Button variant={approved ? 'success' : 'primary'} size="lg" className="w-full" onClick={markSeen}>
              {approved ? 'OK, thanks' : 'OK'}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
};
