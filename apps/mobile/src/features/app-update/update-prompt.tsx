import { useEffect, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { Download, Sparkles } from 'lucide-react-native';
import { BottomSheet, Button, Text } from '@/components';
import { useAnnouncementHighlights } from '@/features/announcements/api';
import { pendingPopupAnnouncements } from '@/features/announcements/components/announcement-popup';
import { cleanUpOldDownloads, downloadAndInstall, isNewer, useAppUpdateStore, useLatestRelease } from '@/lib/app-update';
import { useAuth } from '@/lib/auth';
import { useOverlayStore } from '@/lib/overlays';
import { radius, space, useTheme } from '@/theme';

const megabytes = (bytes: number | null) => (bytes ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : null);

/**
 * "Update available" sheet (Android): shown when a newer APK has been published, every time the app is opened or
 * brought back until the user updates ("Later" hides it for a few hours). "Update now" downloads the APK and opens
 * Android's installer. A tap on the "update available" notification opens it straight away.
 * Waits for the permissions sheet, announcement and new-task pop-ups so only one sheet shows at a time.
 */
export const UpdatePrompt = () => {
  const { c } = useTheme();
  const { user } = useAuth();
  const latest = useLatestRelease();
  const announcements = useAnnouncementHighlights(!!user);
  const { phase, progress, error, snoozedUntil, requested, snooze } = useAppUpdateStore();
  const permissionsOpen = useOverlayStore((s) => s.permissionsOpen);
  const permissionsSettled = useOverlayStore((s) => s.permissionsSettled);
  const taskOpen = useOverlayStore((s) => s.taskOpen);
  const setUpdateOpen = useOverlayStore((s) => s.setUpdateOpen);

  // Re-evaluate the snooze whenever the app comes back to the foreground.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    cleanUpOldDownloads();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') setNow(Date.now());
    });
    return () => sub.remove();
  }, []);

  const release = latest.data;
  const announcementPending = !announcements.isFetched || pendingPopupAnnouncements(announcements.data?.popup).length > 0;
  const busy = phase === 'downloading' || phase === 'installing';
  // Once on screen it stays until dismissed, even if an announcement or task arrives meanwhile.
  const [open, setOpen] = useState(false);
  const showing =
    isNewer(release) && !permissionsOpen && permissionsSettled && (open || requested || (!taskOpen && !announcementPending && snoozedUntil <= now));
  useEffect(() => setOpen(showing), [showing]);
  useEffect(() => setUpdateOpen(showing), [showing, setUpdateOpen]);
  if (!showing || !isNewer(release)) return null;

  // A download in progress carries on in the background (the installer still opens when it finishes).
  const later = () => {
    snooze();
    setOpen(false);
    setNow(Date.now());
  };
  const size = megabytes(release.size);
  const pct = progress === null ? null : Math.round(progress * 100);

  return (
    <BottomSheet
      open
      onClose={later}
      title="Update available"
      description={[release.version ? `Version ${release.version}` : null, `Build ${release.build}`, size].filter(Boolean).join(' · ')}
    >
      <View style={styles.tag}>
        <View style={[styles.icon, { backgroundColor: c.surface2 }]}>
          <Sparkles size={16} color={c.primary} />
        </View>
        <Text size="sm" weight="semibold" color="fg2">
          A new version of Stencil HRMS is ready
        </Text>
      </View>
      <Text size="md" color="fg2">
        Update now to get the latest features and fixes. Your data stays as it is.
      </Text>
      {release.notes ? (
        <View style={[styles.notes, { backgroundColor: c.surface2 }]}>
          <Text size="xs" weight="semibold" color="muted">
            WHAT'S NEW
          </Text>
          <Text size="sm" color="fg2" numberOfLines={10}>
            {release.notes}
          </Text>
        </View>
      ) : null}
      {phase === 'downloading' ? (
        <View style={styles.progress}>
          <View style={[styles.track, { backgroundColor: c.surface2 }]}>
            <View style={[styles.fill, { backgroundColor: c.primary, width: `${pct ?? 15}%` }]} />
          </View>
          <Text size="xs" color="muted">
            {pct === null ? 'Downloading the update…' : `Downloading the update… ${pct}%`}
          </Text>
        </View>
      ) : null}
      {error ? (
        <Text size="sm" color="danger">
          {error}
        </Text>
      ) : null}
      <Text size="xs" color="muted">
        Android will ask you to confirm the update. The first time, it may ask you to allow "Install unknown apps" for
        Stencil HRMS — turn it on, come back and tap Install.
      </Text>
      <Button icon={Download} loading={busy} onPress={() => void downloadAndInstall(release)}>
        {phase === 'downloading' ? 'Downloading…' : phase === 'installing' ? 'Opening installer…' : 'Update now'}
      </Button>
      <Button variant="ghost" onPress={later}>
        {busy ? 'Hide' : 'Later'}
      </Button>
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  tag: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  icon: { width: 28, height: 28, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  notes: { borderRadius: radius.md, padding: space(3), gap: space(1) },
  progress: { gap: space(1) },
  track: { height: 8, borderRadius: radius.full, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.full },
});
