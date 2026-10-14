import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Copy, KeyRound, MessageCircle, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/display';
import { Modal, useConfirm } from '@/components/ui/overlay';
import { get, post, toApiError } from '@/lib/api';

interface StaffWithoutLogin {
  _id: string;
  employeeId: string | null;
  firstName: string;
  lastName: string;
  workEmail?: string;
  phone?: string | null;
  departmentId?: { name: string } | null;
  designationId?: { name: string } | null;
}
interface CreatedLogin {
  employeeId: string;
  name: string;
  email: string;
  phone: string | null;
  url: string;
  /** An existing login (same email) was connected to the record; it still needs activating. */
  linked?: boolean;
}
interface CreateLoginsResult {
  created: CreatedLogin[];
  /** Existing, already active logins now connected to their employee record. */
  linked: { employeeId: string; name: string; email: string }[];
  skipped: { employeeId: string; name: string; reason: string }[];
  expiresInDays: number;
}

/** WhatsApp chat with the person (Indian numbers without a country code get +91), with the activation message. */
const whatsAppLink = (login: CreatedLogin) => {
  const text = `Hi ${login.name.split(' ')[0]}, your Stencil HRMS login is ready. Open this link, set your password, then sign in to the app with ${login.email} to check in and out:\n${login.url}`;
  const digits = (login.phone ?? '').replace(/\D/g, '');
  const phone = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
};

/**
 * Settings → Users: staff who exist only as employee records (e.g. helping staff) can't sign in, so they can't check
 * in or out. One button gives them all a login; each gets a personal activation link (WhatsApp / copy) and sets
 * their own password.
 */
export const StaffWithoutLoginCard = () => {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const missing = useQuery({ queryKey: ['users', 'without-login'], queryFn: () => get<StaffWithoutLogin[]>('/users/without-login') });
  const [result, setResult] = useState<CreateLoginsResult | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => post<CreateLoginsResult>('/users/employee-logins', {}),
    onSuccess: async (res) => {
      setResult(res.data);
      await qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e) => toast.error(toApiError(e).message),
  });

  const people = missing.data ?? [];
  if (!people.length && !result) return null;

  const start = async () => {
    const { confirmed } = await confirm({
      title: `Create logins for ${people.length} ${people.length === 1 ? 'person' : 'people'}?`,
      message:
        'Each gets a login with the Employee role (Manager too if people report to them), using their work email. You get a personal link for each to send on WhatsApp: they open it, set their own password and can then check in and out in the app with selfie and location.',
      confirmLabel: 'Create logins',
      tone: 'primary',
    });
    if (confirmed) create.mutate();
  };

  const copy = async (login: CreatedLogin) => {
    try {
      await navigator.clipboard.writeText(login.url);
      setCopied(login.employeeId);
      toast.success(`Link for ${login.name} copied`);
    } catch {
      toast.error('Could not copy; select the link and copy it instead');
    }
  };

  return (
    <>
      {people.length > 0 && (
        <Card className="mb-4 border-amber-300 bg-amber-50/60 dark:border-amber-500/40 dark:bg-amber-500/10">
          <CardBody className="flex flex-wrap items-center gap-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
              <Smartphone className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-fg">
                {people.length} {people.length === 1 ? 'employee can’t' : 'employees can’t'} sign in to the app yet
              </p>
              <p className="text-sm text-muted">
                Without a login they can’t check in or out:{' '}
                {people
                  .slice(0, 6)
                  .map((p) => `${p.firstName} ${p.lastName}`.trim())
                  .join(', ')}
                {people.length > 6 ? ` and ${people.length - 6} more` : ''}.
              </p>
            </div>
            <Button icon={<KeyRound className="h-4 w-4" />} loading={create.isPending} onClick={() => void start()}>
              Create logins
            </Button>
          </CardBody>
        </Card>
      )}

      <Modal
        open={!!result}
        onClose={() => setResult(null)}
        size="lg"
        title={result && result.created.length + result.linked.length ? `${result.created.length + result.linked.length} ${result.created.length + result.linked.length === 1 ? 'person' : 'people'} set up` : 'Nothing to set up'}
        description={
          result?.created.length
            ? `Send each person their link (valid ${result.expiresInDays} days). They set their own password, then sign in to the Stencil HRMS app with their email.`
            : undefined
        }
        footer={<Button onClick={() => setResult(null)}>Done</Button>}
      >
        <div className="space-y-2">
          {result?.created.map((login) => (
            <div key={login.employeeId} className="flex flex-wrap items-center gap-3 rounded-lg border border-line px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-fg">
                  {login.name}
                  {login.linked && <span className="ml-2 text-xs font-normal text-muted">(was invited before; connected now)</span>}
                </p>
                <p className="truncate text-xs text-muted">{login.email}</p>
              </div>
              <Button size="sm" variant="outline" icon={copied === login.employeeId ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} onClick={() => void copy(login)}>
                {copied === login.employeeId ? 'Copied' : 'Copy link'}
              </Button>
              <a href={whatsAppLink(login)} target="_blank" rel="noreferrer">
                <Button size="sm" variant="success" icon={<MessageCircle className="h-4 w-4" />}>
                  WhatsApp
                </Button>
              </a>
            </div>
          ))}
          {result && result.linked.length > 0 && (
            <div className="rounded-lg bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200">
              <p className="font-medium">Already signed up — now connected to their employee record:</p>
              <p>{result.linked.map((l) => l.name).join(', ')}</p>
              <p className="mt-1 text-xs opacity-80">They can check in and out straight away (if the app was open, they may need to sign out and in once).</p>
            </div>
          )}
          {result?.skipped.map((s) => (
            <p key={s.employeeId} className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
              <strong>{s.name}</strong>: {s.reason}
            </p>
          ))}
          {result && !result.created.length && !result.linked.length && !result.skipped.length && <p className="text-sm text-muted">Everyone already has a login.</p>}
        </div>
      </Modal>
    </>
  );
};
