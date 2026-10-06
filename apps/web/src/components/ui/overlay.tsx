import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { Textarea } from './input';

const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Traps focus inside the container, restores it on close, closes on Escape. */
const useDialogBehavior = (open: boolean, onClose: () => void) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const first = node?.querySelector<HTMLElement>('[data-autofocus]') ?? node?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? node)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'Tab' && node) {
        const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
        if (!items.length) return;
        const firstEl = items[0]!;
        const lastEl = items[items.length - 1]!;
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open, onClose]);
  return ref;
};

/* -------------------------------- Modal ------------------------------- */

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export const Modal = ({ open, onClose, title, description, children, footer, size = 'md' }: ModalProps) => {
  const ref = useDialogBehavior(open, onClose);
  const titleId = useId();
  if (!open) return null;
  const width = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size];
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="animate-fade-in absolute inset-0 bg-slate-950/50 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn('animate-scale-in relative flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-surface shadow-pop sm:rounded-2xl', width)}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 id={titleId} className="text-base font-semibold text-fg">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t('common.close')}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="scrollbar-thin flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-surface-2 px-5 py-3 sm:rounded-b-2xl">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
};

/* ------------------------------- Drawer ------------------------------- */

export const Drawer = ({ open, onClose, title, description, children, footer, width = 'max-w-xl' }: Omit<ModalProps, 'size'> & { width?: string }) => {
  const ref = useDialogBehavior(open, onClose);
  const titleId = useId();
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="animate-fade-in absolute inset-0 bg-slate-950/40" onClick={onClose} aria-hidden />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={cn('animate-slide-in-right relative flex h-full w-full flex-col bg-surface shadow-pop', width)}>
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 id={titleId} className="text-base font-semibold text-fg">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t('common.close')}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="scrollbar-thin flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-surface-2 px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
};

/* ---------------------------- ConfirmDialog --------------------------- */

interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  tone?: 'danger' | 'primary';
  /** Ask for a reason (e.g. rejection); resolves with the text. */
  requireReason?: boolean;
  reasonLabel?: string;
}

type ConfirmResult = { confirmed: boolean; reason?: string };
const ConfirmContext = createContext<((opts: ConfirmOptions) => Promise<ConfirmResult>) | null>(null);

export const ConfirmProvider = ({ children }: { children: ReactNode }) => {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (r: ConfirmResult) => void }) | null>(null);
  const [reason, setReason] = useState('');

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<ConfirmResult>((resolve) => {
        setReason('');
        setState({ ...opts, resolve });
      }),
    [],
  );
  const close = useCallback(
    (result: ConfirmResult) => {
      state?.resolve(result);
      setState(null);
    },
    [state],
  );

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={!!state}
        onClose={() => close({ confirmed: false })}
        title={state?.title ?? ''}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => close({ confirmed: false })}>
              {t('common.cancel')}
            </Button>
            <Button
              variant={state?.tone === 'primary' ? 'primary' : 'danger'}
              disabled={!!state?.requireReason && reason.trim().length < 3}
              onClick={() => close({ confirmed: true, reason: reason.trim() || undefined })}
              data-autofocus={!state?.requireReason || undefined}
            >
              {state?.confirmLabel ?? t('common.confirm')}
            </Button>
          </>
        }
      >
        {state?.message && <div className="text-sm text-fg-2">{state.message}</div>}
        {state?.requireReason && (
          <div className="mt-3">
            <label htmlFor="confirm-reason" className="mb-1.5 block text-sm font-medium text-fg">
              {state.reasonLabel ?? 'Reason'}
            </label>
            <Textarea id="confirm-reason" data-autofocus value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={1000} />
          </div>
        )}
      </Modal>
    </ConfirmContext.Provider>
  );
};

export const useConfirm = () => {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used inside ConfirmProvider');
  return ctx;
};

/* ------------------------------ Dropdown ------------------------------ */

export interface DropdownItem {
  label: string;
  onSelect: () => void;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  hidden?: boolean;
}

export const Dropdown = ({ trigger, items, align = 'right', label = 'Open menu' }: { trigger: ReactNode; items: DropdownItem[]; align?: 'left' | 'right'; label?: string }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const visible = items.filter((i) => !i.hidden);
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') setOpen(false);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? [])];
      const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === 'ArrowDown' ? (idx + 1) % buttons.length : (idx - 1 + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }
  };
  if (!visible.length) return null;
  return (
    <div ref={ref} className="relative inline-block" onKeyDown={onKeyDown}>
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-controls={menuId} aria-label={label} onClick={() => setOpen((o) => !o)} className="rounded-lg">
        {trigger}
      </button>
      {open && (
        <div id={menuId} role="menu" className={cn('animate-scale-in absolute z-40 mt-1 min-w-44 rounded-lg border border-line bg-surface p-1 shadow-pop', align === 'right' ? 'right-0' : 'left-0')}>
          {visible.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm disabled:opacity-50',
                item.danger ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10' : 'text-fg-2 hover:bg-surface-3 hover:text-fg',
              )}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/* ------------------------------- Tooltip ------------------------------ */

export const Tooltip = ({ content, children }: { content: string; children: ReactNode }) => {
  const id = useId();
  return (
    <span className="group relative inline-flex" aria-describedby={id}>
      {children}
      <span id={id} role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 rounded-md bg-slate-900 px-2 py-1 text-xs whitespace-nowrap text-white opacity-0 shadow transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        {content}
      </span>
    </span>
  );
};

/* -------------------------------- Tabs -------------------------------- */

export interface TabItem {
  key: string;
  label: string;
  count?: number;
  hidden?: boolean;
}

export const Tabs = ({ tabs, active, onChange, className }: { tabs: TabItem[]; active: string; onChange: (key: string) => void; className?: string }) => {
  const visible = tabs.filter((t) => !t.hidden);
  const onKeyDown = (e: ReactKeyboardEvent, index: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = visible[(index + (e.key === 'ArrowRight' ? 1 : -1) + visible.length) % visible.length]!;
    onChange(next.key);
    document.getElementById(`tab-${next.key}`)?.focus();
  };
  return (
    <div role="tablist" className={cn('scrollbar-thin -mb-px flex gap-1 overflow-x-auto border-b border-line', className)}>
      {visible.map((tab, i) => {
        const selected = tab.key === active;
        return (
          <button
            key={tab.key}
            id={`tab-${tab.key}`}
            role="tab"
            type="button"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.key)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              'flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors',
              selected ? 'border-brand-600 text-brand-700 dark:text-brand-300' : 'border-transparent text-muted hover:text-fg',
            )}
          >
            {tab.label}
            {tab.count !== undefined && <span className="rounded-full bg-surface-3 px-1.5 text-xs text-fg-2">{tab.count}</span>}
          </button>
        );
      })}
    </div>
  );
};
