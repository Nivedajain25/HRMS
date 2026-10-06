import { StyleSheet, View } from 'react-native';
import { Ban, CheckCircle2, Circle, Clock3, Pencil, Send, SkipForward, XCircle } from 'lucide-react-native';
import { Text, type IconComponent } from '@/components';
import { label } from '@/lib/format';
import { formatDateTimeIn } from '@/lib/time';
import { space, toneColors, useTheme, type Tone } from '@/theme';
import type { ApprovalStep, LeaveRequest } from '../api';
import { isPendingStatus } from '../lib';

export interface TimelineItem {
  key: string;
  title: string;
  meta?: string;
  comment?: string | null;
  tone: Tone;
  icon: IconComponent;
  current?: boolean;
}

/** Vertical approval timeline (submitted → each approval step → final state). */
export const Timeline = ({ items }: { items: TimelineItem[] }) => {
  const { c } = useTheme();
  return (
    <View accessibilityRole="list">
      {items.map((it, i) => {
        const t = toneColors(it.tone, c);
        const last = i === items.length - 1;
        return (
          <View
            key={it.key}
            style={styles.item}
            accessible
            accessibilityLabel={[it.title, it.meta, it.comment ? `Comment: ${it.comment}` : null].filter(Boolean).join('. ')}
          >
            <View style={styles.rail}>
              <View style={[styles.dot, { backgroundColor: t.bg, borderColor: it.current ? t.solid : t.border, borderWidth: it.current ? 2 : 1 }]}>
                <it.icon size={16} color={t.fg} />
              </View>
              {!last ? <View style={[styles.line, { backgroundColor: c.line }]} /> : null}
            </View>
            <View style={[styles.body, !last && styles.bodyGap]}>
              <Text size="sm" weight="medium">
                {it.title}
              </Text>
              {it.meta ? (
                <Text size="xs" color="muted">
                  {it.meta}
                </Text>
              ) : null}
              {it.comment ? (
                <View style={[styles.comment, { backgroundColor: c.surface2 }]}>
                  <Text size="sm" color="fg2">{`“${it.comment}”`}</Text>
                </View>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
};

/** Timeline item for one approval step (shared by leave, corrections and expenses). */
export const stepItem = (
  s: ApprovalStep | { approverType: string; status: ApprovalStep['status']; actedByName?: string | null; actedAt?: string | null; comment?: string | null },
  i: number,
  opts: { current: boolean; cancelled: boolean; timeZone: string; approverLabel?: (type: string) => string },
): TimelineItem => {
  const who = `${opts.approverLabel ? opts.approverLabel(s.approverType) : label(s.approverType)} approval`;
  const acted = [s.actedByName, s.actedAt ? formatDateTimeIn(s.actedAt, opts.timeZone) : null].filter(Boolean).join(' · ');
  switch (s.status) {
    case 'APPROVED':
      return { key: `s${i}`, title: `${who} — approved`, meta: acted, comment: s.comment, tone: 'green', icon: CheckCircle2 };
    case 'REJECTED':
      return { key: `s${i}`, title: `${who} — rejected`, meta: acted, comment: s.comment, tone: 'red', icon: XCircle };
    case 'SKIPPED':
      return {
        key: `s${i}`,
        title: `${who} — skipped`,
        meta: opts.cancelled ? 'Request was cancelled' : 'Not required',
        tone: 'gray',
        icon: SkipForward,
      };
    default:
      return {
        key: `s${i}`,
        title: opts.current ? `Awaiting ${who.toLowerCase()}` : who,
        meta: opts.current ? 'In progress' : 'Upcoming',
        tone: opts.current ? 'amber' : 'gray',
        icon: opts.current ? Clock3 : Circle,
        current: opts.current,
      };
  }
};

export const leaveTimeline = (l: LeaveRequest, timeZone: string): TimelineItem[] => {
  const items: TimelineItem[] = [];
  if (l.status === 'DRAFT') {
    items.push({ key: 'draft', title: 'Saved as draft', meta: formatDateTimeIn(l.createdAt, timeZone), tone: 'gray', icon: Pencil });
    return items;
  }
  items.push({ key: 'submitted', title: 'Submitted', meta: formatDateTimeIn(l.submittedAt ?? l.createdAt, timeZone), tone: 'brand', icon: Send });
  l.approvalSteps.forEach((s, i) =>
    items.push(
      stepItem(s, i, {
        current: s.status === 'PENDING' && i === l.currentStep && isPendingStatus(l.status),
        cancelled: l.status === 'CANCELLED',
        timeZone,
      }),
    ),
  );
  if (l.status === 'CANCELLED') {
    items.push({
      key: 'cancelled',
      title: 'Cancelled',
      meta: l.cancelledAt ? formatDateTimeIn(l.cancelledAt, timeZone) : undefined,
      comment: l.cancellationReason,
      tone: 'gray',
      icon: Ban,
    });
  }
  return items;
};

const styles = StyleSheet.create({
  item: { flexDirection: 'row', gap: space(3) },
  rail: { alignItems: 'center', width: 32 },
  dot: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  line: { width: 2, flex: 1, minHeight: 12, marginVertical: 2 },
  body: { flex: 1, gap: 2, paddingTop: space(1) },
  bodyGap: { paddingBottom: space(4) },
  comment: { marginTop: space(1), borderRadius: 8, paddingHorizontal: space(3), paddingVertical: space(2) },
});
