/**
 * Minimal allowlist HTML sanitizer for rich-text content (announcements).
 *
 * Strategy:
 *  1. Remove comments, CDATA and "raw text" elements (script, style, iframe...)
 *     together with their content.
 *  2. Tokenize the remainder into tags and text. Allowed tags are re-emitted
 *     with only allowed attributes; every other tag is dropped (its text kept).
 *  3. Text is re-escaped so stray `<` / `>` can never form markup.
 *  4. Open tags are balanced so the output never leaks unclosed elements.
 */

const ALLOWED_TAGS = new Set([
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'h2', 'h3', 'h4',
  'ul', 'ol', 'li', 'blockquote', 'a', 'code', 'pre', 'hr',
]);
const VOID_TAGS = new Set(['br', 'hr']);

/** Elements whose *content* must be removed too (not just the tag). */
const DROP_WITH_CONTENT = [
  'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'noscript', 'noembed', 'noframes',
  'template', 'textarea', 'title', 'svg', 'math', 'xmp', 'select', 'option', 'plaintext', 'head',
];

const SAFE_URL = /^(https?:|mailto:)/i;

const escapeText = (s: string) => s.replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Escapes `&` unless it already starts a well-formed entity. */
const normalizeAmpersands = (s: string) => s.replace(/&(?!(?:#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,31});)/gi, '&amp;');

const escapeAttr = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', colon: ':', tab: '\t', newline: '\n' };

/** Decodes entities so URL scheme checks cannot be bypassed with `javascript&#58;`. */
export const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return NAMED_ENTITIES[e.toLowerCase()] ?? m;
  });

/** Returns a safe href or null (http/https/mailto only, no obfuscation). */
export const safeHref = (raw: string): string | null => {
  // eslint-disable-next-line no-control-regex
  const decoded = decodeEntities(raw).replace(/[\u0000- \u007f-\u009f]/g, '');
  if (!SAFE_URL.test(decoded)) return null;
  return decoded;
};

const ATTR_RE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

const parseAttrs = (raw: string) => {
  const attrs = new Map<string, string>();
  for (const m of raw.matchAll(ATTR_RE)) {
    const name = m[1]!.toLowerCase();
    if (!attrs.has(name)) attrs.set(name, m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
};

const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?\s*>/g;

const stripDangerous = (html: string) => {
  let out = html
    .replace(/<!--[\s\S]*?(-->|$)/g, '')
    .replace(/<!\[CDATA\[[\s\S]*?(\]\]>|$)/gi, '')
    .replace(/<![^>]*>/g, '')
    .replace(/<\?[\s\S]*?(\?>|$)/g, '');
  for (const tag of DROP_WITH_CONTENT) {
    const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?(<\\/${tag}\\s*>|$)`, 'gi');
    // Repeat until stable to defeat nesting tricks like <scr<script>ipt>.
    let prev: string;
    do {
      prev = out;
      out = out.replace(re, '');
    } while (out !== prev);
    out = out.replace(new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi'), '');
  }
  return out;
};

export const sanitizeHtml = (input: string): string => {
  const html = stripDangerous(String(input ?? ''));
  const stack: string[] = [];
  let out = '';
  let last = 0;

  const emitText = (text: string) => {
    out += normalizeAmpersands(escapeText(text));
  };

  for (const m of html.matchAll(TAG_RE)) {
    emitText(html.slice(last, m.index));
    last = m.index! + m[0].length;
    const closing = m[1] === '/';
    const tag = m[2]!.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) continue;

    if (closing) {
      if (VOID_TAGS.has(tag)) continue;
      const idx = stack.lastIndexOf(tag);
      if (idx === -1) continue;
      // Close any elements opened inside it as well.
      while (stack.length > idx) out += `</${stack.pop()}>`;
      continue;
    }

    if (VOID_TAGS.has(tag)) {
      out += `<${tag}>`;
      continue;
    }
    if (tag === 'a') {
      const href = safeHref(parseAttrs(m[3] ?? '').get('href') ?? '');
      out += href ? `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">` : '<a>';
    } else {
      out += `<${tag}>`;
    }
    stack.push(tag);
  }
  emitText(html.slice(last));
  while (stack.length) out += `</${stack.pop()}>`;
  return out;
};

/** Plain text of (sanitized) HTML, whitespace-collapsed. */
export const htmlToText = (html: string) =>
  decodeEntities(
    String(html ?? '')
      .replace(/<(br|\/p|\/li|\/h[2-4]|\/blockquote|\/pre|hr)\b[^>]*>/gi, ' ')
      .replace(/<[^>]*>/g, ''),
  )
    .replace(/\s+/g, ' ')
    .trim();

export const excerpt = (html: string, max = 200) => {
  const text = htmlToText(html);
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};
