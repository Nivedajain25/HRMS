import { Fragment, useMemo, type ReactNode } from 'react';
import { Linking, Platform, Text as RNText, StyleSheet, View, type TextStyle } from 'react-native';
import { Text, toast } from '@/components';
import { fonts, fontSize, radius, space, useTheme, type Palette } from '@/theme';

/*
 * Renders the server-sanitized announcement HTML as native text — no WebView.
 * The API allowlist is: p, br, strong/b, em/i, u, s, h2–h4, ul/ol/li, blockquote,
 * a (http/https/mailto href only), code, pre, hr. Anything else is dropped and
 * only its text is kept, so unexpected markup can never execute or render.
 */

type Tag = 'p' | 'br' | 'strong' | 'b' | 'em' | 'i' | 'u' | 's' | 'h2' | 'h3' | 'h4' | 'ul' | 'ol' | 'li' | 'blockquote' | 'a' | 'code' | 'pre' | 'hr';

type HtmlNode = { kind: 'text'; text: string } | { kind: 'el'; tag: Tag; href?: string; children: HtmlNode[] };

const ALLOWED = new Set<string>(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'a', 'code', 'pre', 'hr']);
const VOID = new Set<string>(['br', 'hr']);
const BLOCK = new Set<Tag>(['p', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'pre', 'hr']);
const isTag = (t: string): t is Tag => ALLOWED.has(t);

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', bull: '•' };

export const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return NAMED[e.toLowerCase()] ?? m;
  });

const safeHref = (raw: string | undefined) => {
  if (!raw) return undefined;
  const href = decodeEntities(raw).trim();
  return /^(https?:|mailto:)/i.test(href) ? href : undefined;
};

const HREF_RE = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;
const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g;

export const parseHtml = (html: string): HtmlNode[] => {
  const root: { children: HtmlNode[] } = { children: [] };
  const stack: { tag: Tag | 'root'; children: HtmlNode[] }[] = [{ tag: 'root', children: root.children }];
  const top = () => stack[stack.length - 1]!;
  let last = 0;
  const pushText = (raw: string) => {
    if (raw) top().children.push({ kind: 'text', text: decodeEntities(raw) });
  };
  for (const m of html.matchAll(TAG_RE)) {
    pushText(html.slice(last, m.index));
    last = m.index + m[0].length;
    const name = m[2]!.toLowerCase();
    if (!isTag(name)) continue;
    if (m[1]) {
      const at = stack.map((s) => s.tag).lastIndexOf(name);
      if (at > 0) stack.length = at;
      continue;
    }
    const el: HtmlNode = { kind: 'el', tag: name, children: [] };
    if (name === 'a') el.href = safeHref(HREF_RE.exec(m[3] ?? '')?.slice(1).find((v) => v !== undefined));
    top().children.push(el);
    if (!VOID.has(name)) stack.push({ tag: name, children: el.children });
  }
  pushText(html.slice(last));
  return root.children;
};

/** Plain-text excerpt of sanitized HTML (lists, cards). */
export const htmlExcerpt = (html: string, max = 180) => {
  const text = decodeEntities(html.replace(/<(br|\/p|\/li|\/h[2-4]|\/blockquote|\/pre|hr)\b[^>]*>/gi, ' ').replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

const openLink = (href: string) => {
  Linking.openURL(href).catch(() => toast.error('Could not open the link', href));
};

const textOf = (nodes: HtmlNode[]): string => nodes.map((n) => (n.kind === 'text' ? n.text : n.tag === 'br' ? '\n' : textOf(n.children))).join('');

const isBlank = (nodes: HtmlNode[]): boolean => nodes.every((n) => (n.kind === 'text' ? !n.text.trim() : n.tag !== 'br' && n.tag !== 'hr' && isBlank(n.children)));

interface RenderCtx {
  c: Palette;
}

const renderInline = (nodes: HtmlNode[], key: string, ctx: RenderCtx): ReactNode[] =>
  nodes.map((n, i) => {
    const k = `${key}.${i}`;
    if (n.kind === 'text') return n.text.replace(/\s+/g, ' ');
    const inner = () => renderInline(n.children, k, ctx);
    switch (n.tag) {
      case 'br':
        return '\n';
      case 'strong':
      case 'b':
        return (
          <RNText key={k} style={styles.bold}>
            {inner()}
          </RNText>
        );
      case 'em':
      case 'i':
        return (
          <RNText key={k} style={styles.italic}>
            {inner()}
          </RNText>
        );
      case 'u':
        return (
          <RNText key={k} style={styles.underline}>
            {inner()}
          </RNText>
        );
      case 's':
        return (
          <RNText key={k} style={styles.strike}>
            {inner()}
          </RNText>
        );
      case 'code':
        return (
          <RNText key={k} style={[styles.code, { backgroundColor: ctx.c.surface3 }]}>
            {textOf(n.children)}
          </RNText>
        );
      case 'a':
        return n.href ? (
          <RNText
            key={k}
            style={[styles.link, { color: ctx.c.accent }]}
            onPress={() => openLink(n.href!)}
            accessibilityRole="link"
            accessibilityHint={`Opens ${n.href}`}
          >
            {inner()}
          </RNText>
        ) : (
          <Fragment key={k}>{inner()}</Fragment>
        );
      default:
        // A block element inside inline content: keep its text on its own line.
        return <Fragment key={k}>{['\n', ...inner(), '\n']}</Fragment>;
    }
  });

/** Trims the leading/trailing whitespace of an inline run. */
const trimRun = (nodes: HtmlNode[]): HtmlNode[] => {
  const out = [...nodes];
  const first = out[0];
  if (first?.kind === 'text') out[0] = { kind: 'text', text: first.text.replace(/^\s+/, '') };
  const lastNode = out[out.length - 1];
  if (lastNode?.kind === 'text') out[out.length - 1] = { kind: 'text', text: lastNode.text.replace(/\s+$/, '') };
  return out;
};

const Paragraph = ({ nodes, k, ctx, style }: { nodes: HtmlNode[]; k: string; ctx: RenderCtx; style?: TextStyle }) => (
  <Text style={style} selectable>
    {renderInline(trimRun(nodes), k, ctx)}
  </Text>
);

const renderBlocks = (nodes: HtmlNode[], key: string, ctx: RenderCtx, textStyle?: TextStyle): ReactNode[] => {
  const out: ReactNode[] = [];
  let run: HtmlNode[] = [];
  const flush = () => {
    if (run.length && !isBlank(run)) out.push(<Paragraph key={`${key}.r${out.length}`} nodes={run} k={`${key}.r${out.length}`} ctx={ctx} style={textStyle} />);
    run = [];
  };
  nodes.forEach((n, i) => {
    if (n.kind === 'el' && BLOCK.has(n.tag)) {
      flush();
      out.push(renderBlock(n, `${key}.${i}`, ctx, textStyle));
    } else {
      run.push(n);
    }
  });
  flush();
  return out;
};

const renderList = (n: Extract<HtmlNode, { kind: 'el' }>, key: string, ctx: RenderCtx, textStyle?: TextStyle) => {
  let index = 0;
  return (
    <View key={key} style={styles.list} accessibilityRole="list">
      {n.children.map((child, i) => {
        const k = `${key}.${i}`;
        if (child.kind === 'text') return child.text.trim() ? <Paragraph key={k} nodes={[child]} k={k} ctx={ctx} style={textStyle} /> : null;
        if (child.tag !== 'li') return <View key={k}>{renderBlocks([child], k, ctx, textStyle)}</View>;
        index += 1;
        const marker = n.tag === 'ol' ? `${index}.` : '•';
        return (
          <View key={k} style={styles.item}>
            <Text style={[styles.marker, textStyle]} accessibilityElementsHidden importantForAccessibility="no">
              {marker}
            </Text>
            <View style={styles.itemBody}>{renderBlocks(child.children, k, ctx, textStyle)}</View>
          </View>
        );
      })}
    </View>
  );
};

const renderBlock = (n: Extract<HtmlNode, { kind: 'el' }>, key: string, ctx: RenderCtx, textStyle?: TextStyle): ReactNode => {
  const { c } = ctx;
  switch (n.tag) {
    case 'h2':
    case 'h3':
    case 'h4': {
      const size = n.tag === 'h2' ? fontSize.xl : n.tag === 'h3' ? fontSize.lg : fontSize.md;
      return (
        <Text key={key} accessibilityRole="header" style={[styles.heading, { fontSize: size, lineHeight: Math.round(size * 1.35) }]}>
          {renderInline(trimRun(n.children), key, ctx)}
        </Text>
      );
    }
    case 'ul':
    case 'ol':
      return renderList(n, key, ctx, textStyle);
    case 'blockquote':
      return (
        <View key={key} style={[styles.quote, { borderLeftColor: c.lineStrong }]}>
          {renderBlocks(n.children, key, ctx, { ...textStyle, color: c.fg2, fontStyle: 'italic' })}
        </View>
      );
    case 'pre':
      return (
        <View key={key} style={[styles.pre, { backgroundColor: c.surface3 }]}>
          <Text style={styles.preText} selectable>
            {textOf(n.children).replace(/^\n/, '')}
          </Text>
        </View>
      );
    case 'hr':
      return <View key={key} style={[styles.hr, { backgroundColor: c.line }]} />;
    default:
      // p, li (outside a list) and any other container.
      return (
        <View key={key} style={styles.block}>
          {renderBlocks(n.children, key, ctx, textStyle)}
        </View>
      );
  }
};

/** Announcement body. */
export const RichText = ({ html }: { html: string }) => {
  const { c } = useTheme();
  const nodes = useMemo(() => parseHtml(html), [html]);
  return <View style={styles.root}>{renderBlocks(nodes, 'h', { c })}</View>;
};

const styles = StyleSheet.create({
  root: { gap: space(3) },
  block: { gap: space(2) },
  bold: { fontFamily: fonts.bold },
  italic: { fontStyle: 'italic' },
  underline: { textDecorationLine: 'underline' },
  strike: { textDecorationLine: 'line-through' },
  code: { fontFamily: MONO, fontSize: fontSize.sm },
  link: { textDecorationLine: 'underline' },
  heading: { fontFamily: fonts.semibold, marginTop: space(1) },
  list: { gap: space(1.5) },
  item: { flexDirection: 'row', gap: space(2) },
  marker: { minWidth: 18, textAlign: 'right' },
  itemBody: { flex: 1, gap: space(1) },
  quote: { borderLeftWidth: 3, paddingLeft: space(3), gap: space(2) },
  pre: { borderRadius: radius.sm, padding: space(3) },
  preText: { fontFamily: MONO, fontSize: fontSize.sm },
  hr: { height: StyleSheet.hairlineWidth * 2, marginVertical: space(1) },
});
