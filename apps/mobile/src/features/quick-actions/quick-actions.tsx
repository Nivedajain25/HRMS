import { Pressable, StyleSheet, View } from 'react-native';
import { router, type Href } from 'expo-router';
import {
  CalendarPlus,
  ClipboardCheck,
  FilePenLine,
  FileUp,
  ListPlus,
  Megaphone,
  PartyPopper,
  Receipt,
  Siren,
  Users,
  Wallet,
} from 'lucide-react-native';
import { BottomSheet, Text, type IconComponent } from '@/components';
import { usePendingApprovals } from '@/features/approvals/api';
import { useAssignable } from '@/features/tasks/api';
import { dashboardKind, useAuth } from '@/lib/auth';
import { radius, space, toneColors, useTheme, type Tone } from '@/theme';

export interface QuickAction {
  key: string;
  label: string;
  icon: IconComponent;
  href: Href;
  tone: Tone;
  /** A count to show on the tile (e.g. requests waiting for approval). */
  badge?: number;
}

/**
 * The shortcuts each person needs most, in order of importance for their role — the first four are the Home row,
 * all of them are in the bottom bar's + sheet.
 */
export const useQuickActions = (): QuickAction[] => {
  const { hasEmployee, isApprover, can, user } = useAuth();
  const pending = usePendingApprovals(isApprover);
  const canAssign = (useAssignable().data?.length ?? 0) > 0;
  const staffLead = dashboardKind(user?.roles) !== 'employee';

  const a = {
    approvals: { key: 'approvals', label: 'Approvals', icon: ClipboardCheck, href: '/approvals', tone: 'amber', badge: pending.data?.total },
    leave: { key: 'leave', label: 'Apply leave', icon: CalendarPlus, href: '/leave/apply', tone: 'teal' },
    regularize: { key: 'regularize', label: 'Fix attendance', icon: FilePenLine, href: '/attendance/regularizations/new', tone: 'green' },
    payslips: { key: 'payslips', label: 'Payslips', icon: Wallet, href: '/more/payslips', tone: 'blue' },
    holidays: { key: 'holidays', label: 'Holidays', icon: PartyPopper, href: '/more/holidays', tone: 'purple' },
    expense: { key: 'expense', label: 'Claim expense', icon: Receipt, href: '/more/expenses/new', tone: 'amber' },
    task: { key: 'task', label: 'Assign task', icon: ListPlus, href: '/more/tasks/new', tone: 'brand' },
    document: { key: 'document', label: 'Upload document', icon: FileUp, href: '/more/documents/upload', tone: 'blue' },
    employees: { key: 'employees', label: can('employee:read') ? 'Employees' : 'My team', icon: Users, href: '/more/team', tone: 'blue' },
    announcements: { key: 'announcements', label: 'Notices', icon: Megaphone, href: '/more/announcements', tone: 'amber' },
    emergencies: { key: 'emergencies', label: 'Emergencies', icon: Siren, href: '/more/emergencies', tone: 'red' },
  } satisfies Record<string, QuickAction>;

  const list: (QuickAction | false)[] = staffLead
    ? // HR, Admin, Super Admin: what needs them first, then their own requests.
      [
        isApprover && a.approvals,
        can('employee:read') && a.employees,
        hasEmployee && a.leave,
        a.announcements,
        can('emergency:manage') && a.emergencies,
        canAssign && a.task,
        hasEmployee && a.regularize,
        hasEmployee && a.payslips,
        hasEmployee && a.expense,
        a.holidays,
      ]
    : // Employees (and managers): their own requests first.
      [
        hasEmployee && a.leave,
        hasEmployee && a.regularize,
        hasEmployee && a.payslips,
        a.holidays,
        isApprover && a.approvals,
        canAssign && a.task,
        hasEmployee && a.expense,
        hasEmployee && a.document,
        hasEmployee && a.employees,
      ];
  return list.filter((x): x is QuickAction => !!x);
};

/** One shortcut: a soft coloured round icon with its label underneath (and a count badge when there is one). */
const Tile = ({ action, onPress }: { action: QuickAction; onPress: () => void }) => {
  const { c } = useTheme();
  const t = toneColors(action.tone, c);
  const Icon = action.icon;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={action.badge ? `${action.label}, ${action.badge} waiting` : action.label}
      style={({ pressed }) => [styles.tile, pressed && { opacity: 0.7 }]}
    >
      <View style={[styles.bubble, { backgroundColor: t.bg }]}>
        <Icon size={22} color={t.solid} />
        {action.badge ? (
          <View style={[styles.badge, { backgroundColor: c.danger, borderColor: c.surface }]}>
            <Text size="xs" weight="bold" style={styles.badgeText}>
              {action.badge > 99 ? '99+' : String(action.badge)}
            </Text>
          </View>
        ) : null}
      </View>
      <Text size="xs" weight="medium" align="center" numberOfLines={2} style={styles.label}>
        {action.label}
      </Text>
    </Pressable>
  );
};

/** Home: the four most important shortcuts in a row. */
export const QuickActionsRow = () => {
  const actions = useQuickActions().slice(0, 4);
  if (!actions.length) return null;
  return (
    <View style={styles.row}>
      {actions.map((action) => (
        <Tile key={action.key} action={action} onPress={() => router.push(action.href)} />
      ))}
    </View>
  );
};

/** The bottom bar's + button: every shortcut for the role in a sheet. */
export const QuickActionsSheet = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const actions = useQuickActions();
  return (
    <BottomSheet open={open} onClose={onClose} title="Quick actions">
      <View style={styles.grid}>
        {actions.map((action) => (
          <View key={action.key} style={styles.cell}>
            <Tile
              action={action}
              onPress={() => {
                onClose();
                router.push(action.href);
              }}
            />
          </View>
        ))}
      </View>
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: space(2) },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: space(4) },
  cell: { width: '25%', alignItems: 'center' },
  tile: { flex: 1, alignItems: 'center', gap: space(1.5), minWidth: 64 },
  bubble: { width: 56, height: 56, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: { color: '#ffffff', fontSize: 10, lineHeight: 12 },
  label: { lineHeight: 15 },
});
