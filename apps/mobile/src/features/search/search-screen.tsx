import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, ChevronLeft, FileText, Megaphone, Search, UserRound, X } from 'lucide-react-native';
import type { SearchResult } from '@stencil/types';
import { IconButton, Screen, Text, type IconComponent } from '@/components';
import { useAllFeatures, type QuickAction } from '@/features/quick-actions/quick-actions';
import { get } from '@/lib/api';
import { fonts, fontSize, radius, space, toneColors, useTheme } from '@/theme';

/** Other words people type for a feature (so "salary slip" finds Payslips, "check in" finds Attendance). */
const KEYWORDS: Record<string, string> = {
  attendance: 'check in check out clock punch present late today',
  regularize: 'fix correction missed punch regularize regularise',
  regularizations: 'regularization requests correction',
  holidays: 'holiday festival day off',
  apply: 'apply leave request vacation time off sick casual',
  leave: 'leave requests balance',
  calendar: 'leave calendar who is off',
  payslips: 'salary slip pay slip payslip',
  expenses: 'expense claim reimbursement bill',
  expense: 'claim expense reimbursement bill',
  approvals: 'approve requests pending',
  tasks: 'task todo work',
  task: 'assign task',
  goals: 'goals target okr',
  announcements: 'notice news announcement',
  notifications: 'notifications alerts',
  team: 'staff people employees directory team',
  emergencies: 'emergency sos siren urgent',
  profile: 'my profile personal details bank address',
  documents: 'document file policy upload',
  assets: 'laptop asset equipment device',
  resignation: 'resign resignation exit notice period quit',
  settings: 'settings theme password security',
};

/** Records from the server search that the app can open, and where. */
const RECORDS: Partial<Record<SearchResult['type'], { label: string; icon: IconComponent; href: (r: SearchResult) => Href }>> = {
  employee: { label: 'People', icon: UserRound, href: (r) => ({ pathname: '/more/team/[id]', params: { id: r.id } }) },
  leave: { label: 'Leave requests', icon: CalendarDays, href: (r) => ({ pathname: '/leave/[id]', params: { id: r.id } }) },
  announcement: { label: 'Announcements', icon: Megaphone, href: (r) => ({ pathname: '/more/announcements/[id]', params: { id: r.id } }) },
  document: { label: 'Documents', icon: FileText, href: () => '/more/documents' },
};

const useDebounced = (value: string, ms: number) => {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
};

/**
 * Global search (same idea as the web's Ctrl K): type a page ("payslips", "check in", "holidays") to jump straight
 * there, or find people, leave requests, announcements and documents.
 */
export const SearchScreen = () => {
  const { c } = useTheme();
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const debounced = useDebounced(q.trim(), 250);
  const groups = useAllFeatures();

  const pages = useMemo(() => {
    const words = query.split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const all: (QuickAction & { section: string })[] = groups.flatMap((g) => g.items.map((i) => ({ ...i, section: g.title })));
    return all
      .filter((p) => words.every((w) => `${p.label} ${p.section} ${KEYWORDS[p.key] ?? ''}`.toLowerCase().includes(w)))
      .sort((a, b) => Number(!a.label.toLowerCase().startsWith(words[0]!)) - Number(!b.label.toLowerCase().startsWith(words[0]!)))
      .slice(0, 8);
  }, [groups, query]);

  const results = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => get<SearchResult[]>('/search', { q: debounced, limit: 6 }),
    enabled: debounced.length >= 2,
    staleTime: 15_000,
  });
  const records = debounced.length >= 2 ? (results.data ?? []).filter((r) => RECORDS[r.type]) : [];

  const open = (href: Href) => router.push(href);
  let lastGroup: string | null = null;

  return (
    <Screen
      keyboard
      header={
        <View style={[styles.bar, { backgroundColor: c.surface, borderBottomColor: c.line }]}>
          <View style={[styles.back, { backgroundColor: c.accentSoft }]}>
            <IconButton icon={ChevronLeft} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} accessibilityLabel="Go back" color={c.accent} size={40} />
          </View>
          <View style={[styles.field, { backgroundColor: c.surface2, borderColor: c.line }]}>
            <Search size={18} color={c.muted} />
            <TextInput
              autoFocus
              value={q}
              onChangeText={setQ}
              placeholder="Search pages, people, leave…"
              placeholderTextColor={c.subtle}
              returnKeyType="search"
              autoCorrect={false}
              accessibilityLabel="Search"
              style={[styles.input, { color: c.fg }]}
            />
            {q ? <IconButton icon={X} onPress={() => setQ('')} accessibilityLabel="Clear search" color={c.muted} size={32} /> : null}
          </View>
        </View>
      }
    >
      {!query ? (
        <Text size="sm" color="muted" align="center" style={styles.hint}>
          Type a page — “payslips”, “check in”, “holidays”, “apply leave” — or search people, leave requests, announcements and documents.
        </Text>
      ) : null}

      {[...pages.map((p) => ({ group: 'Pages', key: `page-${p.key}`, title: p.label, subtitle: p.section, icon: p.icon, tone: p.tone, href: p.href })),
        ...records.map((r) => ({ group: RECORDS[r.type]!.label, key: `${r.type}-${r.id}`, title: r.title, subtitle: r.subtitle ?? '', icon: RECORDS[r.type]!.icon, tone: 'gray' as const, href: RECORDS[r.type]!.href(r) }))].map(
        (item) => {
          const header = item.group !== lastGroup ? item.group : null;
          lastGroup = item.group;
          const t = toneColors(item.tone, c);
          const Icon = item.icon;
          return (
            <View key={item.key} style={styles.itemWrap}>
              {header ? (
                <Text size="xs" weight="semibold" color="muted" accessibilityRole="header" style={styles.group}>
                  {header.toUpperCase()}
                </Text>
              ) : null}
              <Pressable
                onPress={() => open(item.href)}
                accessibilityRole="button"
                accessibilityLabel={`${item.title}${item.subtitle ? `, ${item.subtitle}` : ''}`}
                style={({ pressed }) => [styles.row, { backgroundColor: pressed ? c.surface2 : c.surface, borderColor: c.line }]}
              >
                <View style={[styles.icon, { backgroundColor: t.bg }]}>
                  <Icon size={18} color={t.solid} />
                </View>
                <View style={styles.flex}>
                  <Text weight="semibold" numberOfLines={1}>
                    {item.title}
                  </Text>
                  {item.subtitle ? (
                    <Text size="xs" color="muted" numberOfLines={1}>
                      {item.subtitle}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            </View>
          );
        },
      )}

      {query && !pages.length && !records.length && (debounced.length < 2 || !results.isFetching) ? (
        <Text size="sm" color="muted" align="center" style={styles.hint}>{`No results for “${q.trim()}”.`}</Text>
      ) : null}
      {debounced.length >= 2 && results.isFetching ? (
        <Text size="xs" color="muted" align="center">
          Searching…
        </Text>
      ) : null}
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: space(2), paddingHorizontal: space(3), paddingVertical: space(2), borderBottomWidth: StyleSheet.hairlineWidth },
  back: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  field: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: space(2), borderRadius: radius.full, borderWidth: 1, paddingLeft: space(3.5) },
  input: { flex: 1, fontFamily: fonts.regular, fontSize: fontSize.md, paddingVertical: space(2), outlineWidth: 0, outlineColor: 'transparent' },
  hint: { paddingHorizontal: space(4), paddingTop: space(6) },
  itemWrap: { gap: space(1.5) },
  group: { letterSpacing: 0.5, paddingTop: space(2), paddingHorizontal: space(1) },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(3), padding: space(3), borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  icon: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
