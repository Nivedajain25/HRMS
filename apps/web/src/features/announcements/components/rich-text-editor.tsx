import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Bold, Heading3, Italic, Link2, List, ListOrdered, Quote, RemoveFormatting, Unlink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Lightweight, dependency-free rich text editor (contentEditable + native
 * editing commands). It produces simple HTML (p, h3, strong, em, ul/ol, a,
 * blockquote); the API sanitizes it with an allowlist before storing, so the
 * editor never needs to be trusted.
 */

type Command = 'bold' | 'italic' | 'insertUnorderedList' | 'insertOrderedList';

const exec = (command: string, value?: string) => {
  // execCommand is deprecated but remains the only dependency-free way to edit
  // rich text consistently across browsers.
  document.execCommand(command, false, value);
};

const normalizeUrl = (raw: string) => {
  const v = raw.trim();
  if (!v) return '';
  if (/^(https?:|mailto:)/i.test(v)) return v;
  if (/^[\w.+-]+@[\w-]+\.[\w.]+$/.test(v)) return `mailto:${v}`;
  return `https://${v}`;
};

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** True when the editor HTML has no visible text. */
export const isHtmlEmpty = (html: string) => !(new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '').trim();

const ToolButton = ({ label, active, onClick, children, disabled }: { label: string; active?: boolean; onClick: () => void; children: ReactNode; disabled?: boolean }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    aria-pressed={active}
    disabled={disabled}
    // Keep the editor selection when clicking toolbar buttons.
    onMouseDown={(e) => e.preventDefault()}
    onClick={onClick}
    className={cn(
      'inline-flex h-8 w-8 items-center justify-center rounded-md text-fg-2 transition-colors hover:bg-surface-3 hover:text-fg disabled:opacity-50',
      active && 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300',
    )}
  >
    {children}
  </button>
);

export const RichTextEditor = ({
  value,
  onChange,
  onBlur,
  id,
  invalid,
  describedBy,
  placeholder = 'Write your announcement…',
  disabled,
  ariaLabel = 'Content',
}: {
  ariaLabel?: string;
  value: string;
  onChange: (html: string) => void;
  onBlur?: () => void;
  id?: string;
  invalid?: boolean;
  describedBy?: string;
  placeholder?: string;
  disabled?: boolean;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  const [state, setState] = useState<Record<string, boolean>>({});
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [empty, setEmpty] = useState(() => isHtmlEmpty(value));

  // Sync external value (initial load / form reset) without clobbering the caret while typing.
  useEffect(() => {
    const el = ref.current;
    if (el && el.innerHTML !== value && document.activeElement !== el) {
      el.innerHTML = value;
      setEmpty(isHtmlEmpty(value));
    }
  }, [value]);

  const refreshState = useCallback(() => {
    const el = ref.current;
    const sel = document.getSelection();
    if (!el || !sel?.anchorNode || !el.contains(sel.anchorNode)) return;
    const block = String(document.queryCommandValue('formatBlock')).toLowerCase();
    let node: Node | null = sel.anchorNode;
    let inLink = false;
    while (node && node !== el) {
      if (node.nodeName === 'A') inLink = true;
      node = node.parentNode;
    }
    setState({
      bold: document.queryCommandState('bold'),
      italic: document.queryCommandState('italic'),
      insertUnorderedList: document.queryCommandState('insertUnorderedList'),
      insertOrderedList: document.queryCommandState('insertOrderedList'),
      h3: block === 'h3',
      blockquote: block === 'blockquote',
      link: inLink,
    });
  }, []);

  useEffect(() => {
    document.addEventListener('selectionchange', refreshState);
    return () => document.removeEventListener('selectionchange', refreshState);
  }, [refreshState]);

  const emit = () => {
    const el = ref.current;
    if (!el) return;
    const html = isHtmlEmpty(el.innerHTML) ? '' : el.innerHTML;
    setEmpty(!html);
    onChange(html);
  };

  const run = (command: Command) => {
    ref.current?.focus();
    exec(command);
    emit();
    refreshState();
  };

  const toggleBlock = (tag: 'h3' | 'blockquote') => {
    ref.current?.focus();
    exec('formatBlock', state[tag] ? 'p' : tag);
    emit();
    refreshState();
  };

  const openLink = () => {
    const sel = document.getSelection();
    if (sel && sel.rangeCount && ref.current?.contains(sel.anchorNode)) savedRange.current = sel.getRangeAt(0).cloneRange();
    setLinkUrl('');
    setLinkOpen(true);
  };

  const applyLink = () => {
    const url = normalizeUrl(linkUrl);
    setLinkOpen(false);
    const el = ref.current;
    if (!url || !el) return;
    el.focus();
    const sel = document.getSelection();
    if (savedRange.current && sel) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    }
    if (!sel || sel.isCollapsed) exec('insertHTML', `<a href="${escapeHtml(url)}">${escapeHtml(url.replace(/^mailto:/, ''))}</a>`);
    else exec('createLink', url);
    savedRange.current = null;
    emit();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openLink();
    }
  };

  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border bg-surface shadow-sm transition-colors focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20',
        invalid ? 'border-red-500' : 'border-line-strong',
        disabled && 'opacity-60',
      )}
    >
      <div role="toolbar" aria-label="Formatting" aria-controls={id} className="flex flex-wrap items-center gap-0.5 border-b border-line bg-surface-2 px-1.5 py-1">
        <ToolButton label="Bold (Ctrl+B)" active={state.bold} onClick={() => run('bold')} disabled={disabled}>
          <Bold className="h-4 w-4" />
        </ToolButton>
        <ToolButton label="Italic (Ctrl+I)" active={state.italic} onClick={() => run('italic')} disabled={disabled}>
          <Italic className="h-4 w-4" />
        </ToolButton>
        <span className="mx-1 h-5 w-px bg-line" aria-hidden />
        <ToolButton label="Heading" active={state.h3} onClick={() => toggleBlock('h3')} disabled={disabled}>
          <Heading3 className="h-4 w-4" />
        </ToolButton>
        <ToolButton label="Quote" active={state.blockquote} onClick={() => toggleBlock('blockquote')} disabled={disabled}>
          <Quote className="h-4 w-4" />
        </ToolButton>
        <ToolButton label="Bulleted list" active={state.insertUnorderedList} onClick={() => run('insertUnorderedList')} disabled={disabled}>
          <List className="h-4 w-4" />
        </ToolButton>
        <ToolButton label="Numbered list" active={state.insertOrderedList} onClick={() => run('insertOrderedList')} disabled={disabled}>
          <ListOrdered className="h-4 w-4" />
        </ToolButton>
        <span className="mx-1 h-5 w-px bg-line" aria-hidden />
        <ToolButton label="Insert link (Ctrl+K)" active={state.link} onClick={openLink} disabled={disabled}>
          <Link2 className="h-4 w-4" />
        </ToolButton>
        {state.link && (
          <ToolButton
            label="Remove link"
            onClick={() => {
              exec('unlink');
              emit();
              refreshState();
            }}
            disabled={disabled}
          >
            <Unlink className="h-4 w-4" />
          </ToolButton>
        )}
        <ToolButton
          label="Clear formatting"
          onClick={() => {
            exec('removeFormat');
            exec('formatBlock', 'p');
            emit();
            refreshState();
          }}
          disabled={disabled}
        >
          <RemoveFormatting className="h-4 w-4" />
        </ToolButton>
      </div>

      {linkOpen && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface-2 px-2 py-2">
          <label htmlFor={`${id ?? 'rte'}-link`} className="text-xs font-medium text-fg-2">
            Link URL
          </label>
          <div className="min-w-40 flex-1">
            <Input
              id={`${id ?? 'rte'}-link`}
              autoFocus
              value={linkUrl}
              placeholder="https://…"
              className="h-8"
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  applyLink();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  setLinkOpen(false);
                  ref.current?.focus();
                }
              }}
            />
          </div>
          <Button size="xs" onClick={applyLink} disabled={!linkUrl.trim()}>
            Apply
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setLinkOpen(false)}>
            Cancel
          </Button>
        </div>
      )}

      <div className="relative">
        {empty && (
          <p className="pointer-events-none absolute top-3 left-3 text-sm text-subtle" aria-hidden>
            {placeholder}
          </p>
        )}
        <div
          ref={ref}
          id={id}
          role="textbox"
          aria-multiline="true"
          aria-label={ariaLabel}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          aria-placeholder={placeholder}
          contentEditable={!disabled}
          suppressContentEditableWarning
          tabIndex={0}
          onFocus={() => exec('defaultParagraphSeparator', 'p')}
          onInput={emit}
          onBlur={() => {
            emit();
            onBlur?.();
          }}
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            // Paste as plain text so foreign markup never reaches the editor.
            e.preventDefault();
            exec('insertText', e.clipboardData.getData('text/plain'));
          }}
          className="prose-content scrollbar-thin max-h-[420px] min-h-[200px] overflow-y-auto px-3 py-3 text-sm leading-relaxed text-fg focus:outline-none"
        />
      </div>
    </div>
  );
};
