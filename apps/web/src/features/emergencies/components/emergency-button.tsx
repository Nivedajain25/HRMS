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
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Emergency: inform HR"
        title="Personal emergency? Inform HR immediately"
        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-red-600 px-2.5 text-xs sm:px-3.5 font-bold tracking-wide text-white shadow-sm hover:bg-red-700 focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 focus-visible:outline-none"
      >
        <Siren className="h-4 w-4" aria-hidden />
        <span className="hidden sm:inline">Emergency</span>
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
