import type { ReactNode } from 'react';
import { Card, EmptyState, Header, Screen, type IconComponent } from '@/components';

/** Temporary tab root for features that are being built next (Leave, Approvals, More). */
export const ComingNext = ({
  title,
  icon,
  message,
  children,
}: {
  title: string;
  icon: IconComponent;
  message: string;
  children?: ReactNode;
}) => (
  <Screen inTabs header={<Header title={title} large />}>
    <Card>
      <EmptyState icon={icon} title="Coming next" message={message} />
    </Card>
    {children}
  </Screen>
);
