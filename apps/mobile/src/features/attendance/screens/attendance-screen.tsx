import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { FileClock, FilePenLine, PartyPopper, PlaneTakeoff, UserX } from 'lucide-react-native';
import { Card, EmptyState, Header, IconButton, ListItem, RelatedLinks, Screen, Segmented } from '@/components';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/theme';
import { attendanceKeys, regularizationKeys } from '../api';
import { EveryoneAttendance } from '../components/everyone-attendance';
import { MonthAttendance } from '../components/month-attendance';
import { usePlacePopup } from '../place-popup';

type View_ = 'mine' | 'everyone';

export const AttendanceScreen = () => {
  const { c } = useTheme();
  const { hasEmployee, can } = useAuth();
  const qc = useQueryClient();
  // Pop-up: at the office, or outside the office area and how far.
  usePlacePopup('attendance');
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
          {/* Check in / check out lives on Home (Today's Overview); this page starts with related links and the month. */}
          {/* Related: jump to what goes with attendance. */}
          <RelatedLinks
            links={[
              { label: 'Regularization', icon: FilePenLine, href: '/attendance/regularizations/new' },
              { label: 'Apply leave', icon: PlaneTakeoff, href: '/leave/apply' },
              { label: 'Holidays', icon: PartyPopper, href: '/more/holidays' },
            ]}
          />
          <MonthAttendance
            afterSummary={
              <Card padding={0}>
                <ListItem
                  title="Regularization"
                  subtitle="Fix a missed or wrong check-in / check-out"
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
