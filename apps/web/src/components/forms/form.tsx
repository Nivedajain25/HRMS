import { useId, type ReactNode } from 'react';
import type { FieldError, FieldErrors, FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { AlertCircle } from 'lucide-react';
import type { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

/** Label + control + hint + error with correct ARIA wiring. */
export const FormField = ({
  label,
  error,
  hint,
  required,
  children,
  className,
  htmlFor,
}: {
  label?: ReactNode;
  error?: FieldError | { message?: string } | string;
  hint?: ReactNode;
  required?: boolean;
  children: ReactNode | ((ids: { id: string; describedBy?: string; invalid: boolean }) => ReactNode);
  className?: string;
  htmlFor?: string;
}) => {
  const autoId = useId();
  const id = htmlFor ?? autoId;
  const message = typeof error === 'string' ? error : error?.message;
  const describedBy = message ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-fg">
          {label}
          {required && (
            <span className="ml-0.5 text-red-500" aria-hidden>
              *
            </span>
          )}
        </label>
      )}
      {typeof children === 'function' ? children({ id, describedBy, invalid: !!message }) : children}
      {message ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-red-600 dark:text-red-400">
          {message}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
};

/** Server-side banner for errors not tied to a field. */
export const FormError = ({ error }: { error?: string | null }) =>
  error ? (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{error}</span>
    </div>
  ) : null;

/**
 * Maps API validation errors onto react-hook-form fields. Returns the message
 * to show in a banner when no field matched.
 */
export const applyServerErrors = <T extends FieldValues>(error: ApiError, setError: UseFormSetError<T>, fields?: string[]): string | null => {
  let unmatched = error.fieldErrors.length === 0;
  for (const fe of error.fieldErrors) {
    if (!fe.path || (fields && !fields.includes(fe.path.split('.')[0]!))) {
      unmatched = true;
      continue;
    }
    setError(fe.path as Path<T>, { type: 'server', message: fe.message });
  }
  return unmatched ? error.message : null;
};

/** Reads a nested error by dotted path. */
export const errorAt = <T extends FieldValues>(errors: FieldErrors<T>, path: string): FieldError | undefined => {
  let cur: unknown = errors;
  for (const part of path.split('.')) cur = (cur as Record<string, unknown> | undefined)?.[part];
  return cur as FieldError | undefined;
};

export const FormSection = ({ title, description, children }: { title: string; description?: string; children: ReactNode }) => (
  <section className="space-y-4">
    <div>
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      {description && <p className="text-sm text-muted">{description}</p>}
    </div>
    {children}
  </section>
);

export const FormGrid = ({ children, cols = 2 }: { children: ReactNode; cols?: 1 | 2 | 3 }) => (
  <div className={cn('grid gap-4', cols === 1 ? 'grid-cols-1' : cols === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3')}>{children}</div>
);
