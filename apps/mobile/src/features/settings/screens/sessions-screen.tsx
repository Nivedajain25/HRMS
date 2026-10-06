import { StyleSheet, View } from 'react-native';
import { Globe, LogOut, ShieldCheck, Smartphone } from 'lucide-react-native';
import type { ActiveSession } from '@stencil/types';
import { Badge, Button, Card, EmptyState, ErrorState, Header, Screen, SkeletonList, Text, toast, useConfirm } from '@/components';
import { toApiError } from '@/lib/api';
import { signOut, useAuth } from '@/lib/auth';
import { formatDateTimeIn, timeAgo } from '@/lib/time';
import { radius, space, useTheme } from '@/theme';
import { signOutEverywhere, useRevokeSession, useSessions } from '../api';

/** "Chrome on Windows" from a browser user agent (same rules as the web settings page). */
const browserName = (ua?: string) => {
  if (!ua) return 'Web browser';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  return `${browser}${os ? ` on ${os}` : ''}`;
};

const phoneName = (ua?: string) => (ua && /iPhone|iPad|Darwin|CFNetwork/i.test(ua) ? 'iPhone / iPad' : ua && /okhttp|Android/i.test(ua) ? 'Android phone' : 'Phone');

const SessionRow = ({
  s,
  current,
  divider,
  timeZone,
  onRevoke,
  revoking,
}: {
  s: ActiveSession;
  current: boolean;
  divider: boolean;
  timeZone: string;
  onRevoke: (s: ActiveSession, current: boolean) => void;
  revoking: boolean;
}) => {
  const { c } = useTheme();
  const mobile = s.client === 'mobile';
  const Icon = mobile ? Smartphone : Globe;
  const name = mobile ? phoneName(s.userAgent) : browserName(s.userAgent);
  return (
    <View style={[styles.row, divider && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line }]}>
      <View style={[styles.icon, { backgroundColor: current ? c.accentSoft : c.surface3 }]}>
        <Icon size={20} color={current ? c.accent : c.muted} />
      </View>
      <View style={styles.body}>
        <View
          style={styles.body}
          accessible
          accessibilityLabel={`${current ? 'This device. ' : ''}${mobile ? 'Mobile app' : 'Web'}, ${name}. Signed in ${formatDateTimeIn(s.createdAt, timeZone)}, active ${timeAgo(s.lastUsedAt ?? s.createdAt)}`}
        >
          <View style={styles.badges}>
            {current ? <Badge tone="green">This device</Badge> : null}
            <Badge tone={mobile ? 'brand' : 'gray'}>{mobile ? 'Mobile app' : 'Web'}</Badge>
          </View>
          <Text weight="medium">{name}</Text>
          <Text size="xs" color="muted">
            {[s.ipAddress, `signed in ${formatDateTimeIn(s.createdAt, timeZone)}`].filter(Boolean).join(' · ')}
          </Text>
          <Text size="xs" color="muted">{`Active ${timeAgo(s.lastUsedAt ?? s.createdAt)}`}</Text>
        </View>
        <View style={styles.actions}>
          <Button
            variant="outline"
            icon={LogOut}
            onPress={() => onRevoke(s, current)}
            loading={revoking}
            accessibilityLabel={current ? 'Sign out of this device' : `Revoke session: ${name}`}
          >
            {current ? 'Sign out' : 'Revoke'}
          </Button>
        </View>
      </View>
    </View>
  );
};

export const SessionsScreen = () => {
  const { timeZone } = useAuth();
  const query = useSessions();
  const revoke = useRevokeSession();
  const confirm = useConfirm();
  const sessions = query.data?.sessions ?? [];
  const currentId = query.data?.currentId ?? null;
  // This device first, then most recently used.
  const ordered = [...sessions].sort((a, b) =>
    a._id === currentId ? -1 : b._id === currentId ? 1 : new Date(b.lastUsedAt ?? b.createdAt).getTime() - new Date(a.lastUsedAt ?? a.createdAt).getTime(),
  );

  const onRevoke = async (s: ActiveSession, current: boolean) => {
    if (current) {
      const { confirmed } = await confirm({
        title: 'Sign out of this device?',
        message: 'You will stop receiving notifications on this phone until you sign in again.',
        confirmLabel: 'Sign out',
        tone: 'danger',
      });
      if (confirmed) await signOut();
      return;
    }
    const { confirmed } = await confirm({
      title: 'Revoke this session?',
      message: `${s.client === 'mobile' ? 'The mobile app' : 'The browser'} will be signed out the next time it contacts the server.`,
      confirmLabel: 'Revoke',
      tone: 'danger',
    });
    if (!confirmed) return;
    try {
      await revoke.mutateAsync(s._id);
      toast.success('Session revoked');
    } catch (err) {
      toast.error('Could not revoke the session', toApiError(err).message);
    }
  };

  const onEverywhere = async () => {
    const { confirmed } = await confirm({
      title: 'Sign out of all devices?',
      message: 'Every session, including this one, will be ended.',
      confirmLabel: 'Sign out everywhere',
      tone: 'danger',
    });
    if (!confirmed) return;
    try {
      await signOutEverywhere();
      toast.success('Signed out of all devices');
    } catch (err) {
      toast.error('Could not sign out everywhere', toApiError(err).message);
    }
  };

  return (
    <Screen header={<Header title="Active sessions" subtitle="Devices signed in to your account" back backTo="/more/settings" />} onRefresh={() => query.refetch()}>
      {query.isLoading ? (
        <Card>
          <SkeletonList rows={3} />
        </Card>
      ) : query.error ? (
        <Card>
          <ErrorState title="Could not load your sessions" error={query.error} onRetry={() => void query.refetch()} />
        </Card>
      ) : ordered.length === 0 ? (
        <Card>
          <EmptyState icon={ShieldCheck} title="No active sessions" />
        </Card>
      ) : (
        <Card padding={0}>
          {ordered.map((s, i) => (
            <SessionRow
              key={s._id}
              s={s}
              current={s._id === currentId}
              divider={i > 0}
              timeZone={timeZone}
              onRevoke={(x, cur) => void onRevoke(x, cur)}
              revoking={revoke.isPending && revoke.variables === s._id}
            />
          ))}
        </Card>
      )}
      <Text size="xs" color="muted">
        Revoking a session signs that device out. If you don't recognise a device, change your password.
      </Text>
      <Button variant="outline" icon={LogOut} onPress={() => void onEverywhere()}>
        Sign out everywhere
      </Button>
    </Screen>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space(3), padding: space(4) },
  icon: { width: 40, height: 40, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 2 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space(1.5), marginBottom: 2 },
  actions: { flexDirection: 'row', marginTop: space(2) },
});
