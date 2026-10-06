import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import { router } from 'expo-router';
import * as Application from 'expo-application';
import { KeyRound, LogOut, Monitor, Moon, Save, Smartphone, Sun } from 'lucide-react-native';
import { Button, Card, ErrorState, Header, ListItem, Screen, SectionHeader, Segmented, Skeleton, Text, toast, useConfirm } from '@/components';
import { useNotificationPreferences, useSaveNotificationPreferences, type NotificationPreference } from '@/features/notifications/api';
import { DetailList } from '@/features/profile/kit/detail-list';
import { toApiError } from '@/lib/api';
import { API_ORIGIN, APP_VERSION } from '@/lib/config';
import { label } from '@/lib/format';
import { space, TOUCH_TARGET, useTheme, type ThemePreference } from '@/theme';
import { saveThemePreference, signOutEverywhere } from '../api';

const Toggle = ({ value, onChange, accessibilityLabel }: { value: boolean; onChange: (v: boolean) => void; accessibilityLabel: string }) => {
  const { c } = useTheme();
  return (
    <Switch
      value={value}
      onValueChange={onChange}
      accessibilityLabel={accessibilityLabel}
      trackColor={{ false: c.lineStrong, true: c.primary }}
      thumbColor="#ffffff"
      ios_backgroundColor={c.lineStrong}
    />
  );
};

const NotificationPreferences = () => {
  const { c } = useTheme();
  const prefs = useNotificationPreferences();
  const save = useSaveNotificationPreferences();
  const [rows, setRows] = useState<NotificationPreference[] | null>(null);

  useEffect(() => {
    if (prefs.data) setRows(prefs.data);
  }, [prefs.data]);

  const dirty = useMemo(() => !!rows && !!prefs.data && JSON.stringify(rows) !== JSON.stringify(prefs.data), [rows, prefs.data]);
  const setRow = (i: number, patchRow: Partial<NotificationPreference>) => setRows((r) => r?.map((x, j) => (j === i ? { ...x, ...patchRow } : x)) ?? r);

  const onSave = async () => {
    if (!rows) return;
    try {
      await save.mutateAsync(rows);
      toast.success('Notification preferences saved');
    } catch (err) {
      toast.error('Could not save your preferences', toApiError(err).message);
    }
  };

  if (prefs.isLoading || (!rows && !prefs.error)) {
    return (
      <Card style={styles.gap}>
        <Skeleton height={20} />
        <Skeleton height={20} />
        <Skeleton height={20} />
      </Card>
    );
  }
  if (prefs.error || !rows) {
    return (
      <Card>
        <ErrorState compact title="Could not load notification preferences" error={prefs.error} onRetry={() => void prefs.refetch()} />
      </Card>
    );
  }
  return (
    <Card padding={0}>
      <View style={[styles.prefHead, { borderBottomColor: c.line }]}>
        <Text size="xs" color="muted" weight="semibold" style={styles.flex}>
          NOTIFICATION
        </Text>
        <Text size="xs" color="muted" weight="semibold" style={styles.col}>
          IN-APP
        </Text>
        <Text size="xs" color="muted" weight="semibold" style={styles.col}>
          EMAIL
        </Text>
      </View>
      {rows.map((p, i) => (
        <View key={p.type} style={[styles.prefRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line }]}>
          <Text size="sm" style={styles.flex}>
            {label(p.type)}
          </Text>
          <View style={styles.col}>
            <Toggle value={p.inApp} onChange={(inApp) => setRow(i, { inApp })} accessibilityLabel={`${label(p.type)}: in-app notifications`} />
          </View>
          <View style={styles.col}>
            <Toggle value={p.email} onChange={(email) => setRow(i, { email })} accessibilityLabel={`${label(p.type)}: email notifications`} />
          </View>
        </View>
      ))}
      <View style={[styles.prefFoot, { borderTopColor: c.line }]}>
        <Text size="xs" color="muted">
          In-app notifications also arrive as push notifications on this phone.
        </Text>
        <Button icon={Save} onPress={() => void onSave()} loading={save.isPending} disabled={!dirty}>
          Save preferences
        </Button>
      </View>
    </Card>
  );
};

export const SettingsScreen = () => {
  const { c, preference, setPreference } = useTheme();
  const confirm = useConfirm();
  const [signingOut, setSigningOut] = useState(false);

  const chooseTheme = (t: ThemePreference) => {
    setPreference(t);
    saveThemePreference(t).catch((err: unknown) => console.warn('[settings] could not save the theme on the account', err));
  };

  const onSignOutEverywhere = async () => {
    const { confirmed } = await confirm({
      title: 'Sign out of all devices?',
      message: 'Every session — the web app, other phones and this one — will be ended. You will stop receiving push notifications until you sign in again.',
      confirmLabel: 'Sign out everywhere',
      tone: 'danger',
    });
    if (!confirmed) return;
    setSigningOut(true);
    try {
      await signOutEverywhere();
      toast.success('Signed out of all devices');
    } catch (err) {
      setSigningOut(false);
      toast.error('Could not sign out everywhere', toApiError(err).message);
    }
  };

  const build = Application.nativeBuildVersion;

  return (
    <Screen header={<Header title="Settings" back backTo="/more" />}>
      <SectionHeader title="Appearance" />
      <Card style={styles.gap}>
        <Segmented<ThemePreference>
          accessibilityLabel="Theme"
          value={preference}
          onChange={chooseTheme}
          options={[
            { value: 'light', label: 'Light', icon: Sun },
            { value: 'dark', label: 'Dark', icon: Moon },
            { value: 'system', label: 'System', icon: Monitor },
          ]}
        />
        <Text size="xs" color="muted">
          System follows your phone's dark mode setting.
        </Text>
      </Card>

      <SectionHeader title="Notifications" />
      <NotificationPreferences />

      <SectionHeader title="Security" />
      <Card padding={0}>
        <ListItem
          title="Active sessions"
          subtitle="Devices signed in to your account"
          left={<Smartphone size={20} color={c.accent} />}
          onPress={() => router.push('/more/sessions')}
        />
        <ListItem
          divider
          title="Change password"
          subtitle="Other devices will be signed out"
          left={<KeyRound size={20} color={c.accent} />}
          onPress={() => router.push('/more/change-password')}
        />
      </Card>
      <Button variant="outline" icon={LogOut} loading={signingOut} onPress={() => void onSignOutEverywhere()}>
        Sign out everywhere
      </Button>

      <SectionHeader title="About" />
      <Card>
        <DetailList
          items={[
            { label: 'App version', value: build ? `${APP_VERSION} (${build})` : APP_VERSION },
            { label: 'Server', value: API_ORIGIN || 'Not configured' },
          ]}
        />
      </Card>
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: space(3) },
  col: { width: 64, alignItems: 'center' },
  prefHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space(4), paddingVertical: space(2), borderBottomWidth: StyleSheet.hairlineWidth },
  prefRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space(4), minHeight: TOUCH_TARGET + 8, gap: space(1) },
  prefFoot: { gap: space(3), padding: space(4), borderTopWidth: StyleSheet.hairlineWidth },
});
