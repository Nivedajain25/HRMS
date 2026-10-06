import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { FileClock, UserX } from 'lucide-react-native';
import { Card, EmptyState, Header, IconButton, ListItem, Screen, Segmented } from '@/components';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/theme';
import { attendanceKeys, regularizationKeys } from '../api';
import { EveryoneAttendance } from '../components/everyone-attendance';
import { MonthAttendance } from '../components/month-attendance';

type View_ = 'mine' | 'everyone';

export const AttendanceScreen = () => {
  const { c } = useTheme();
  const { hasEmployee, can } = useAuth();
  const qc = useQueryClient();
  // HR / super admin can see everyone's attendance.
  const orgWide = can('attendance:read');
  const [requested, setView] = useState<View_>('mine');
  const view: View_ = !hasEmployee ? 'everyone' : orgWide ? requested : 'mine';
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: attendanceKeys.all }),
      qc.invalidateQueries({ queryKey: regularizationKeys.all }),
      qc.invalidateQueries({ queryKey: ['dashboard', 'board'] }),
    ]);

  return (
    <Screen
      inTabs
      onRefresh={hasEmployee || orgWide ? refresh : undefined}
      header={
        <Header
          title="Attendance"
          tone="green"
          large
          right={
            hasEmployee ? (
              <IconButton
                icon={FileClock}
                color={c.fg}
                onPress={() => router.push('/attendance/regularizations')}
                accessibilityLabel="My regularization requests"
              />
            ) : undefined
          }
        />
      }
    >
      {hasEmployee && orgWide ? (
        <Segmented<View_>
          value={view}
          onChange={setView}
          accessibilityLabel="Whose attendance"
          options={[
            { value: 'mine', label: 'Mine' },
            { value: 'everyone', label: 'Everyone' },
          ]}
        />
      ) : null}
      {view === 'everyone' && orgWide ? (
        <EveryoneAttendance />
      ) : hasEmployee ? (
        <>
          {/* Clocking in / out happens on Home; this tab is the month first, then regularization, then the days. */}
          <MonthAttendance
            afterSummary={
              <Card padding={0}>
                <ListItem
                  title="Regularization"
                  subtitle="Fix a missed or wrong clock-in / clock-out"
                  left={<FileClock size={22} color={c.accent} />}
                  onPress={() => router.push('/attendance/regularizations')}
                />
              </Card>
            }
          />
        </>
      ) : (
        <Card>
          <EmptyState
            icon={UserX}
            title="No employee profile"
            message="Your account is not linked to an employee profile, so attendance is not tracked. Contact HR if this is unexpected."
          />
        </Card>
      )}
    </Screen>
  );
};
