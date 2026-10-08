import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Activity } from 'lucide-react-native';
import { ListItem } from '@/components';
import { get } from '@/lib/api';
import { hrefForLink } from '@/lib/links';
import { timeAgo } from '@/lib/time';
import { radius, toneColors, useTheme } from '@/theme';
import { activityIcon } from '../lib';
import { Widget } from './widgets';

interface ActivityItem {
  id: string;
  type: string;
  at: string;
  title: string;
  detail?: string;
  link?: string;
}

/** "You clocked in", "Your Casual Leave was approved"… from the web activity feed (own activity only). */
const sentence = (a: ActivityItem) => (/ was (approved|rejected)$/.test(a.title) ? `Your ${a.title}` : `You ${a.title}`);

/** Home widget: my recent actions and tasks done (last 7 days). */
export const MyActivity = () => {
  const { c } = useTheme();
  const q = useQuery({ queryKey: ['dashboard', 'activity', 'me', 5], queryFn: () => get<ActivityItem[]>('/dashboard/activity', { scope: 'me', limit: 5 }), refetchInterval: 60_000 });
  return (
    <Widget
      title="My Recent Activity"
      icon={Activity}
      query={q}
      isEmpty={(d) => d.length === 0}
      empty={{ icon: Activity, title: 'No activity yet', message: 'Your check-ins, leave and completed tasks will show here.' }}
    >
      {(d) => (
        <View>
          {d.map((a, i) => {
            const href = hrefForLink(a.link ?? null);
            const kind = activityIcon(a.type);
            const tone = toneColors(kind.tone, c);
            return (
              <ListItem
                key={a.id}
                divider={i > 0}
                title={sentence(a)}
                subtitle={a.detail}
                meta={timeAgo(a.at)}
                left={
                  <View style={[styles.icon, { backgroundColor: tone.bg }]}>
                    <kind.icon size={18} color={c.scheme === 'dark' ? tone.fg : tone.solid} />
                  </View>
                }
                onPress={href ? () => router.push(href) : undefined}
              />
            );
          })}
        </View>
      )}
    </Widget>
  );
};

const styles = StyleSheet.create({
  icon: { width: 36, height: 36, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
});
