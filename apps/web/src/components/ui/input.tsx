import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const controlClass =
  'block w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-fg shadow-sm placeholder:text-subtle ' +
  'transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 ' +
  'disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-muted aria-[invalid=true]:border-red-500 aria-[invalid=true]:focus:ring-red-500/20';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  leftIcon?: ReactNode;
  rightSlot?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(({ className, leftIcon, rightSlot, ...props }, ref) => (
  <div className="relative">
    {leftIcon && <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-subtle">{leftIcon}</span>}
    <input ref={ref} className={cn(controlClass, 'h-9', leftIcon && 'pl-9', rightSlot && 'pr-10', className)} {...props} />
    {rightSlot && <span className="absolute inset-y-0 right-2 flex items-center">{rightSlot}</span>}
  </div>
));
Input.displayName = 'Input';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, rows = 3, ...props }, ref) => (
  <textarea ref={ref} rows={rows} className={cn(controlClass, 'py-2 leading-relaxed', className)} {...props} />
));
Textarea.displayName = 'Textarea';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: SelectOption[];
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(({ className, options, placeholder, ...props }, ref) => (
  <select ref={ref} className={cn(controlClass, 'h-9 appearance-none bg-[length:16px] bg-[right_0.6rem_center] bg-no-repeat pr-8', className)} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }} {...props}>
    {placeholder !== undefined && <option value="">{placeholder}</option>}
    {options.map((o) => (
      <option key={o.value} value={o.value} disabled={o.disabled}>
        {o.label}
      </option>
    ))}
  </select>
));
Select.displayName = 'Select';

export const Checkbox = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode; description?: ReactNode }>(
  ({ className, label, description, id, ...props }, ref) => {
    const autoId = useId();
    const inputId = id ?? autoId;
    return (
      <div className={cn('flex items-start gap-2.5', className)}>
        <input
          ref={ref}
          id={inputId}
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-line-strong text-brand-600 accent-brand-600 focus:ring-brand-500"
          {...props}
        />
        {(label || description) && (
          <label htmlFor={inputId} className="text-sm leading-tight select-none">
            {label && <span className="font-medium text-fg">{label}</span>}
            {description && <span className="mt-0.5 block text-muted">{description}</span>}
          </label>
        )}
      </div>
    );
  },
);
Checkbox.displayName = 'Checkbox';

/** Accessible switch built on a checkbox. */
export const Switch = ({
  checked,
  onChange,
  label,
  disabled,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
  id?: string;
}) => (
  <button
    id={id}
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={cn(
      'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
      checked ? 'bg-brand-600' : 'bg-line-strong',
    )}
  >
    <span className={cn('inline-block h-4 w-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-4.5' : 'translate-x-0.5')} />
  </button>
);

export const DatePicker = forwardRef<HTMLInputElement, Omit<InputProps, 'type'>>((props, ref) => <Input ref={ref} type="date" {...props} />);
DatePicker.displayName = 'DatePicker';

export const DateRangePicker = ({
  from,
  to,
  onChange,
  className,
}: {
  from?: string;
  to?: string;
  onChange: (range: { from?: string; to?: string }) => void;
  className?: string;
}) => (
  <div className={cn('flex items-center gap-2', className)}>
    <Input type="date" aria-label="From date" value={from ?? ''} max={to} onChange={(e) => onChange({ from: e.target.value || undefined, to })} className="w-[9.5rem]" />
    <span className="text-muted">–</span>
    <Input type="date" aria-label="To date" value={to ?? ''} min={from} onChange={(e) => onChange({ from, to: e.target.value || undefined })} className="w-[9.5rem]" />
  </div>
);
