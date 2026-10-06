import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { z } from 'zod';
import { CheckCircle2, Eye, EyeOff, Lock, Mail, XCircle } from 'lucide-react';
import type { AuthSession } from '@stencil/types';
import { acceptInviteSchema, changePasswordSchema, forgotPasswordSchema, loginSchema, password as passwordRule, registerSchema, resetPasswordSchema } from '@stencil/shared';
import { applyServerErrors, FormError, FormField } from '@/components/forms/form';
import { Button } from '@/components/ui/button';
import { Card, CardBody, PageHeader } from '@/components/ui/display';
import { Checkbox, Input, Select } from '@/components/ui/input';
import { AuthLayout } from '@/layouts/auth-layout';
import { post, toApiError } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { useLogin, useRegister } from './use-auth';

const PasswordInput = (props: React.ComponentProps<typeof Input>) => {
  const [show, setShow] = useState(false);
  return (
    <Input
      {...props}
      type={show ? 'text' : 'password'}
      leftIcon={<Lock className="h-4 w-4" />}
      rightSlot={
        <button type="button" onClick={() => setShow((s) => !s)} className="rounded p-1 text-subtle hover:text-fg" aria-label={show ? 'Hide password' : 'Show password'}>
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      }
    />
  );
};

const PasswordHint = () => <span>At least 8 characters with upper & lower case letters and a number.</span>;

/* -------------------------------- Login ------------------------------- */

export const LoginPage = () => {
  const login = useLogin();
  const navigate = useNavigate();
  const location = useLocation();
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<z.input<typeof loginSchema>, unknown, z.output<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '', rememberMe: false },
  });
  const { register, handleSubmit, formState } = form;

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await login.mutateAsync(values);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== '/login' ? from : '/', { replace: true });
    } catch (err) {
      setServerError(toApiError(err).message);
    }
  });

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to your Stencil workspace."
      footer={
        <>
          New to Stencil?{' '}
          <Link to="/register" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
            Create an organization
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        <FormError error={serverError} />
        <FormField label="Email" error={formState.errors.email} required>
          {({ id, describedBy, invalid }) => (
            <Input id={id} type="email" autoComplete="email" leftIcon={<Mail className="h-4 w-4" />} aria-invalid={invalid} aria-describedby={describedBy} {...register('email')} />
          )}
        </FormField>
        <FormField label="Password" error={formState.errors.password} required>
          {({ id, describedBy, invalid }) => <PasswordInput id={id} autoComplete="current-password" aria-invalid={invalid} aria-describedby={describedBy} {...register('password')} />}
        </FormField>
        <div className="flex items-center justify-between">
          <Checkbox label="Remember me" {...register('rememberMe')} />
          <Link to="/forgot-password" className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" className="w-full" size="lg" loading={formState.isSubmitting}>
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
};

/* ------------------------------ Register ------------------------------ */

const TIMEZONES = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? ['UTC'];
  } catch {
    return ['UTC'];
  }
})();
const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'AUD', 'CAD', 'SGD', 'AED', 'JPY', 'ZAR'];

export const RegisterPage = () => {
  const registerOrg = useRegister();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<z.input<typeof registerSchema>, unknown, z.output<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      organizationName: '',
      firstName: '',
      lastName: '',
      email: '',
      password: '',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      currency: 'USD',
      country: '',
    },
  });
  const { register, handleSubmit, formState, setError } = form;

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await registerOrg.mutateAsync(values);
      toast.success('Organization created. Check your inbox to verify your email.');
      navigate('/', { replace: true });
    } catch (err) {
      setServerError(applyServerErrors(toApiError(err), setError, Object.keys(values)));
    }
  });

  return (
    <AuthLayout
      title="Create your organization"
      subtitle="Set up Stencil HRMS for your company in under a minute."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError error={serverError} />
        <FormField label="Organization name" error={formState.errors.organizationName} required>
          {({ id, invalid }) => <Input id={id} autoComplete="organization" aria-invalid={invalid} {...register('organizationName')} />}
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="First name" error={formState.errors.firstName} required>
            {({ id, invalid }) => <Input id={id} autoComplete="given-name" aria-invalid={invalid} {...register('firstName')} />}
          </FormField>
          <FormField label="Last name" error={formState.errors.lastName} required>
            {({ id, invalid }) => <Input id={id} autoComplete="family-name" aria-invalid={invalid} {...register('lastName')} />}
          </FormField>
        </div>
        <FormField label="Work email" error={formState.errors.email} required>
          {({ id, invalid }) => <Input id={id} type="email" autoComplete="email" aria-invalid={invalid} {...register('email')} />}
        </FormField>
        <FormField label="Password" error={formState.errors.password} hint={<PasswordHint />} required>
          {({ id, invalid, describedBy }) => <PasswordInput id={id} autoComplete="new-password" aria-invalid={invalid} aria-describedby={describedBy} {...register('password')} />}
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Timezone" error={formState.errors.timezone}>
            {({ id }) => <Select id={id} options={TIMEZONES.map((tz) => ({ value: tz, label: tz }))} {...register('timezone')} />}
          </FormField>
          <FormField label="Currency" error={formState.errors.currency}>
            {({ id }) => <Select id={id} options={CURRENCIES.map((c) => ({ value: c, label: c }))} {...register('currency')} />}
          </FormField>
        </div>
        <FormField label="Country" hint="Used to suggest a payroll template (always editable).">
          {({ id }) => <Input id={id} autoComplete="country-name" {...register('country')} />}
        </FormField>
        <Button type="submit" className="w-full" size="lg" loading={formState.isSubmitting}>
          Create organization
        </Button>
      </form>
    </AuthLayout>
  );
};

/* --------------------------- Forgot password -------------------------- */

export const ForgotPasswordPage = () => {
  const [sent, setSent] = useState(false);
  const form = useForm<z.input<typeof forgotPasswordSchema>>({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: '' } });
  const [serverError, setServerError] = useState<string | null>(null);
  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      await post('/auth/forgot-password', values);
      setSent(true);
    } catch (err) {
      setServerError(toApiError(err).message);
    }
  });
  return (
    <AuthLayout title="Reset your password" subtitle="We'll email you a secure link to set a new password." footer={<Link to="/login" className="font-medium text-brand-600 hover:underline dark:text-brand-400">Back to sign in</Link>}>
      {sent ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300" role="status">
          If an account exists for that email, a reset link is on its way. The link expires in 1 hour.
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-5">
          <FormError error={serverError} />
          <FormField label="Email" error={form.formState.errors.email} required>
            {({ id, invalid }) => <Input id={id} type="email" autoComplete="email" leftIcon={<Mail className="h-4 w-4" />} aria-invalid={invalid} {...form.register('email')} />}
          </FormField>
          <Button type="submit" className="w-full" size="lg" loading={form.formState.isSubmitting}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  );
};

/* ------------------------ Reset password / Invite --------------------- */

const setPasswordSchema = z
  .object({ password: passwordRule, confirm: z.string() })
  .refine((d) => d.password === d.confirm, { message: 'Passwords do not match', path: ['confirm'] });

const SetPasswordForm = ({ endpoint, submitLabel, onDone }: { endpoint: string; submitLabel: string; onDone: (session?: AuthSession) => void }) => {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<z.input<typeof setPasswordSchema>>({ resolver: zodResolver(setPasswordSchema), defaultValues: { password: '', confirm: '' } });
  const schema = endpoint.includes('invite') ? acceptInviteSchema : resetPasswordSchema;
  const onSubmit = form.handleSubmit(async ({ password }) => {
    setServerError(null);
    const parsed = schema.safeParse({ token, password });
    if (!parsed.success) {
      setServerError('This link is invalid. Request a new one.');
      return;
    }
    try {
      const res = await post<AuthSession | null>(endpoint, parsed.data);
      onDone(res.data ?? undefined);
    } catch (err) {
      setServerError(toApiError(err).message);
    }
  });
  if (!token) return <FormError error="This link is missing its token. Please use the link from your email." />;
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <FormError error={serverError} />
      <FormField label="New password" error={form.formState.errors.password} hint={<PasswordHint />} required>
        {({ id, invalid }) => <PasswordInput id={id} autoComplete="new-password" aria-invalid={invalid} {...form.register('password')} />}
      </FormField>
      <FormField label="Confirm password" error={form.formState.errors.confirm} required>
        {({ id, invalid }) => <PasswordInput id={id} autoComplete="new-password" aria-invalid={invalid} {...form.register('confirm')} />}
      </FormField>
      <Button type="submit" className="w-full" size="lg" loading={form.formState.isSubmitting}>
        {submitLabel}
      </Button>
    </form>
  );
};

export const ResetPasswordPage = () => {
  const navigate = useNavigate();
  return (
    <AuthLayout title="Choose a new password" subtitle="You'll be signed out of other devices.">
      <SetPasswordForm
        endpoint="/auth/reset-password"
        submitLabel="Update password"
        onDone={() => {
          toast.success('Password updated. Please sign in.');
          navigate('/login', { replace: true });
        }}
      />
    </AuthLayout>
  );
};

export const AcceptInvitePage = () => {
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);
  return (
    <AuthLayout title="Activate your account" subtitle="Set a password to join your team on Stencil.">
      <SetPasswordForm
        endpoint="/auth/accept-invite"
        submitLabel="Activate account"
        onDone={(session) => {
          if (session) setSession(session.user, session.accessToken);
          toast.success('Welcome to Stencil!');
          navigate('/', { replace: true });
        }}
      />
    </AuthLayout>
  );
};

/* ---------------------------- Verify email ---------------------------- */

export const VerifyEmailPage = () => {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const ran = useRef(false);
  const verify = useMutation({ mutationFn: () => post('/auth/verify-email', { token }) });
  useEffect(() => {
    if (ran.current || !token) return;
    ran.current = true;
    verify.mutate();
  }, [token, verify]);
  const status = useAuthStore((s) => s.status);
  return (
    <AuthLayout title="Email verification">
      {!token || verify.isError ? (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300" role="alert">
          <XCircle className="h-5 w-5 shrink-0" />
          <span>{verify.error ? toApiError(verify.error).message : 'This verification link is invalid.'}</span>
        </div>
      ) : verify.isSuccess ? (
        <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300" role="status">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <span>Your email address is verified.</span>
        </div>
      ) : (
        <p className="text-sm text-muted" role="status">
          Verifying…
        </p>
      )}
      <Link to={status === 'authenticated' ? '/' : '/login'} className="mt-6 inline-block text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">
        Continue
      </Link>
    </AuthLayout>
  );
};

/* --------------------------- Change password -------------------------- */

export const ChangePasswordPage = () => {
  const setSession = useAuthStore((s) => s.setSession);
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<z.input<typeof changePasswordSchema>>({ resolver: zodResolver(changePasswordSchema), defaultValues: { currentPassword: '', newPassword: '' } });
  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      const res = await post<AuthSession>('/auth/change-password', values);
      setSession(res.data.user, res.data.accessToken);
      form.reset();
      toast.success('Password changed. Other devices were signed out.');
    } catch (err) {
      setServerError(applyServerErrors(toApiError(err), form.setError, ['currentPassword', 'newPassword']));
    }
  });
  return (
    <div className="max-w-xl">
      <PageHeader title="Change password" description="Changing your password signs you out of all other devices." />
      <Card>
        <CardBody>
          <form onSubmit={onSubmit} noValidate className="space-y-5">
            <FormError error={serverError} />
            <FormField label="Current password" error={form.formState.errors.currentPassword} required>
              {({ id, invalid }) => <PasswordInput id={id} autoComplete="current-password" aria-invalid={invalid} {...form.register('currentPassword')} />}
            </FormField>
            <FormField label="New password" error={form.formState.errors.newPassword} hint={<PasswordHint />} required>
              {({ id, invalid }) => <PasswordInput id={id} autoComplete="new-password" aria-invalid={invalid} {...form.register('newPassword')} />}
            </FormField>
            <div className="flex justify-end">
              <Button type="submit" loading={form.formState.isSubmitting}>
                Update password
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
};
