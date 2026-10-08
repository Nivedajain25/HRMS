import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Check, DoorOpen, MapPin, Phone, Siren, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/display';
import { Textarea } from '@/components/ui/input';
import { Modal } from '@/components/ui/overlay';
import { timeAgo } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { CATEGORY_META, useActiveEmergencies, useDecideEmergency, useUpdateEmergency, type Emergency } from '../api';

const SEEN_KEY = 'emergencies:seen';
const readSeen = (): string[] => {
  try {
    return JSON.parse(sessionStorage.getItem(SEEN_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
};
const writeSeen = (ids: string[]) => {
  try {
    sessionStorage.setItem(SEEN_KEY, JSON.stringify(ids.slice(-100)));
  } catch {
    /* storage unavailable */
  }
};

export const personName = (e: Emergency) => `${e.employeeId?.firstName ?? ''} ${e.employeeId?.lastName ?? ''}`.trim() || 'An employee';
export const mapsLink = (e: Emergency) => (e.location ? `https://www.google.com/maps?q=${e.location.latitude},${e.location.longitude}` : null);

/**
 * For HR (`emergency:manage`): a red bar on every page while any emergency is unresolved, and a pop-up the moment
 * a new one arrives (polled every 10 s).
 */
export const EmergencyAlerts = () => {
  const { can } = usePermissions();
  const enabled = can('emergency:manage');
  const active = useActiveEmergencies(enabled);
  const update = useUpdateEmergency();
  const decide = useDecideEmergency();
  const [note, setNote] = useState('');
  const navigate = useNavigate();
  const [seen, setSeen] = useState<string[]>(readSeen);
  const title = useRef<string | null>(null);

  const list = active.data ?? [];
  const fresh = list.filter((e) => e.status === 'OPEN' && !seen.includes(e._id));
  const current = fresh[0];

  // Flashing tab title while a new alert is showing (no sound).
  useEffect(() => {
    if (!current) return;
    title.current ??= document.title;
    let on = false;
    const id = window.setInterval(() => {
      on = !on;
      document.title = on ? `EMERGENCY: ${personName(current)}` : (title.current ?? '');
    }, 1000);
    return () => {
      window.clearInterval(id);
      if (title.current) document.title = title.current;
    };
  }, [current?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!enabled || !list.length) return null;

  const dismiss = (id: string) => {
    const next = [...seen, id];
    setSeen(next);
    writeSeen(next);
  };
  const acknowledge = async (e: Emergency) => {
    await update.mutateAsync({ id: e._id, status: 'ACKNOWLEDGED' });
    dismiss(e._id);
    toast.success(`${personName(e)} has been told HR has seen it`);
  };
  const decideAs = async (e: Emergency, decision: 'APPROVED' | 'DECLINED') => {
    await decide.mutateAsync({ id: e._id, decision, note: note.trim() || undefined });
    setNote('');
    dismiss(e._id);
    toast.success(decision === 'APPROVED' ? `Approved — ${personName(e)} has been told they can leave` : `Declined — ${personName(e)} has been told`);
  };

  const open = list.filter((e) => e.status === 'OPEN').length;
  const first = list[0]!;
  const CategoryIcon = current ? CATEGORY_META[current.category].icon : null;

  return (
    <>
      <div role="alert" className="flex items-center gap-3 bg-red-600 px-4 py-2 text-sm text-white sm:px-6">
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="absolute inline-flex h-full w-full rounded-full bg-white motion-safe:animate-soft-ping" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
        </span>
        <Siren className="h-4 w-4 shrink-0" aria-hidden />
        <p className="min-w-0 flex-1 truncate">
          <strong>
            {list.length === 1 ? `${CATEGORY_META[first.category].title}: ${personName(first)}` : `${list.length} active emergencies`}
          </strong>
          <span className="opacity-90">
            {' '}
            {list.length === 1 && first.needToLeave ? '· needs to leave ' : ''}· {open ? `${open} waiting for HR` : 'seen by HR'} · {timeAgo(first.createdAt)}
          </span>
        </p>
        <Link
          to={list.length === 1 ? `/emergencies/${first._id}` : '/emergencies'}
          className="shrink-0 rounded-md bg-white/20 px-2.5 py-1 text-xs font-semibold hover:bg-white/30"
        >
          {list.length === 1 ? 'Respond' : 'View all'}
        </Link>
      </div>

      {current && (
        <Modal
          open
          onClose={() => dismiss(current._id)}
          size="sm"
          title={
            <span className="flex items-center gap-2.5">
              <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-300" aria-hidden>
                <span className="absolute inset-0 rounded-full bg-red-400/40 motion-safe:animate-soft-ping" />
                <Siren className="relative h-4 w-4" />
              </span>
              <span>
                Emergency alert
                <span className="block text-xs font-normal text-muted">{`Raised ${timeAgo(current.createdAt)}`}</span>
              </span>
            </span>
          }
        >
          <div className="space-y-4">
            {/* Who and what */}
            <div className="rounded-xl border border-red-100 bg-red-50/60 p-3.5 dark:border-red-500/20 dark:bg-red-500/10">
              <div className="flex items-center gap-3">
                <Avatar name={personName(current)} src={current.employeeId?.profilePhoto} size="lg" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-semibold text-fg">{personName(current)}</p>
                  <p className="truncate text-sm text-muted">
                    {[current.employeeId?.designationId?.name, current.employeeId?.departmentId?.name].filter(Boolean).join(' · ') || current.employeeId?.employeeId}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-red-700 ring-1 ring-red-200 dark:bg-surface dark:text-red-300 dark:ring-red-500/30">
                  {CategoryIcon ? <CategoryIcon className="h-3.5 w-3.5" aria-hidden /> : null} {CATEGORY_META[current.category].title}
                </span>
                {current.needToLeave && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">
                    <DoorOpen className="h-3.5 w-3.5" aria-hidden /> Needs to leave now
                  </span>
                )}
              </div>
              {current.message && <p className="mt-3 text-sm text-red-900 italic dark:text-red-100">“{current.message}”</p>}
            </div>

            {/* Reach them */}
            {(current.contactPhone || mapsLink(current)) && (
              <div className="grid grid-cols-2 gap-2">
                {current.contactPhone && (
                  <a
                    href={`tel:${current.contactPhone.replace(/\s+/g, '')}`}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm font-medium text-fg hover:bg-surface-2"
                  >
                    <Phone className="h-4 w-4 text-emerald-600" aria-hidden /> Call
                  </a>
                )}
                {mapsLink(current) && (
                  <a
                    href={mapsLink(current)!}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm font-medium text-fg hover:bg-surface-2"
                  >
                    <MapPin className="h-4 w-4 text-sky-600" aria-hidden /> Location
                  </a>
                )}
              </div>
            )}

            {/* Optional message */}
            <div>
              <label htmlFor="emergency-note" className="mb-1.5 block text-xs font-medium text-muted">
                Message to {current.employeeId?.firstName ?? 'the employee'} <span className="font-normal">(optional)</span>
              </label>
              <Textarea id="emergency-note" rows={2} maxLength={1000} value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="e.g. Take care, update us tomorrow" />
            </div>

            {/* The decision */}
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="danger"
                size="lg"
                className="w-full"
                icon={<X className="h-4 w-4" />}
                loading={decide.isPending}
                disabled={update.isPending}
                onClick={() => decideAs(current, 'DECLINED')}
              >
                Decline
              </Button>
              <Button
                variant="success"
                size="lg"
                className="w-full"
                icon={<Check className="h-4 w-4" />}
                loading={decide.isPending}
                disabled={update.isPending}
                onClick={() => decideAs(current, 'APPROVED')}
              >
                Approve
              </Button>
            </div>
            <div className="flex items-center justify-between border-t border-line pt-3 text-sm">
              <button
                type="button"
                disabled={update.isPending || decide.isPending}
                onClick={() => acknowledge(current)}
                className="font-medium text-fg-2 hover:text-fg disabled:opacity-50"
              >
                Just acknowledge
              </button>
              <button
                type="button"
                onClick={() => {
                  dismiss(current._id);
                  navigate(`/emergencies/${current._id}`);
                }}
                className="font-medium text-brand-600 hover:underline dark:text-brand-300"
              >
                Open details →
              </button>
            </div>
            {fresh.length > 1 && <p className="text-center text-xs text-muted">+{fresh.length - 1} more new alert{fresh.length > 2 ? 's' : ''} after this one</p>}
          </div>
        </Modal>
      )}
    </>
  );
};
