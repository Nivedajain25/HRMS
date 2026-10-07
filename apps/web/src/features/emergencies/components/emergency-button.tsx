import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, DoorOpen, Siren } from 'lucide-react';
import type { EmergencyCategory } from '@stencil/shared';
import { Button } from '@/components/ui/button';
import { Input, Switch, Textarea } from '@/components/ui/input';
import { Modal } from '@/components/ui/overlay';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { CATEGORY_META, useRaiseEmergency, type Emergency } from '../api';

/** Flat emergency siren: red dome with a shine and filament on a dark base, with orange light rays. */
const SirenIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 100 100" className={className} aria-hidden>
    <g stroke="#f6a723" strokeWidth="5.5" strokeLinecap="round">
      <path d="M50 18.5v7.5M26.5 25.8l4.5 5M73.5 25.8l-4.5 5M15.8 42.4l7.2 2M84.2 42.4l-7.2 2M16 65.4l6.8-2M84 65.4l-6.8-2" />
    </g>
    <path d="M28.6 74V53c0-12 9.6-21.4 21.4-21.4S71.4 41 71.4 53v21Z" fill="#ef3339" />
    <path d="M42.6 55.2c0-1.6 1.2-2.7 2.7-2.7h9.4c1.5 0 2.7 1.1 2.7 2.7s-1.2 2.7-2.7 2.7h-2.4V74h-4.8V57.9h-2.2c-1.5 0-2.7-1.2-2.7-2.7Z" fill="#d42f36" />
    <path d="M33.5 52c0-7.5 5.5-13.4 12.8-14.5" fill="none" stroke="#fbdde0" strokeWidth="5" strokeLinecap="round" />
    <path d="M33.5 60v2.6" stroke="#fbdde0" strokeWidth="5" strokeLinecap="round" />
    <rect x="23.6" y="73" width="52.8" height="8.8" rx="2.2" className="fill-[#37474f] dark:fill-[#64748b]" />
  </svg>
);

/**
 * Header "Emergency" button for employees with a sudden personal emergency (e.g. they must rush home): pick what
 * happened, add a line, and HR plus their manager are notified immediately (in-app, email and phone push).
 */
export const EmergencyButton = () => {
  const { hasEmployee } = usePermissions();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<EmergencyCategory>('FAMILY');
  const [message, setMessage] = useState('');
  const [phone, setPhone] = useState('');
  const [needToLeave, setNeedToLeave] = useState(true);
  const [sent, setSent] = useState<Emergency | null>(null);
  const raise = useRaiseEmergency();

  if (!hasEmployee) return null;

  const close = () => {
    setOpen(false);
    setSent(null);
    setMessage('');
    raise.reset();
  };

  const submit = async () => {
    const result = await raise.mutateAsync({
      category,
      needToLeave,
      message: message.trim() || undefined,
      contactPhone: phone.trim() || undefined,
    });
    setSent(result.data);
  };

  return (
    <>
      {/* Flashing-siren icon with EMERGENCY under it (the siren alone on small screens). */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Emergency: inform HR"
        title="Personal emergency? Inform HR immediately"
        className="group flex h-10 w-10 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl transition-colors hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:outline-none sm:h-14 sm:w-14 dark:hover:bg-red-500/10"
      >
        <SirenIcon className="h-8 w-8 shrink-0 transition-transform group-hover:scale-110 sm:h-9 sm:w-9" />
        <span className="hidden text-[8px] leading-none font-extrabold tracking-wide text-red-600 uppercase sm:block dark:text-red-400">Emergency</span>
      </button>

      <Modal
        open={open}
        onClose={close}
        title={sent ? 'HR has been informed' : 'Personal emergency'}
        description={sent ? undefined : 'Need to rush home or deal with something urgent? HR and your manager are notified right away.'}
        size="sm"
        footer={
          sent ? (
            <Button onClick={close}>Close</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button variant="danger" icon={<Siren className="h-4 w-4" />} loading={raise.isPending} onClick={submit}>
                Inform HR
              </Button>
            </>
          )
        }
      >
        {sent ? (
          <div className="space-y-3 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" aria-hidden />
            <p className="text-sm text-fg-2">
              HR and your manager have been notified{sent.needToLeave ? ' that you need to leave' : ''}. They’ll get in touch
              {sent.contactPhone ? (
                <>
                  {' '}
                  on <strong>{sent.contactPhone}</strong>
                </>
              ) : null}{' '}
              if needed.
            </p>
            <p className="text-xs text-muted">Take care. You’ll get a notification when HR responds.</p>
            <Link to={`/emergencies/${sent._id}`} onClick={close} className="inline-block text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">
              View status
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-fg">What happened?</legend>
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(CATEGORY_META) as EmergencyCategory[]).map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={category === c}
                    onClick={() => setCategory(c)}
                    className={cn(
                      'flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 text-xs font-medium transition-colors',
                      category === c
                        ? 'border-red-500 bg-red-50 text-red-700 ring-1 ring-red-500 dark:bg-red-500/15 dark:text-red-300'
                        : 'border-line text-fg-2 hover:bg-surface-2',
                    )}
                  >
                    <span className="text-xl" aria-hidden>
                      {CATEGORY_META[c].emoji}
                    </span>
                    {CATEGORY_META[c].label}
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-3 py-2">
              <span className="flex items-center gap-2 text-sm text-fg-2">
                <DoorOpen className="h-4 w-4 text-muted" aria-hidden /> I need to leave work now
              </span>
              <Switch checked={needToLeave} onChange={setNeedToLeave} label="I need to leave work now" />
            </div>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-fg">Details (optional)</span>
              <Textarea rows={2} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. My father has been admitted to hospital, I have to go home" />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-fg">Reach me on (optional)</span>
              <Input type="tel" maxLength={30} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Leave blank to use the number on your profile" />
            </label>
          </div>
        )}
      </Modal>
    </>
  );
};
