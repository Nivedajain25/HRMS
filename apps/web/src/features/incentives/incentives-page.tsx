import { Gift } from 'lucide-react';
import { Card, EmptyState, IconTitle, PageHeader } from '@/components/ui/display';

/** Placeholder until the incentive procedure is decided (tracked separately from payroll). */
export const IncentivesPage = () => (
  <>
    <PageHeader title={<IconTitle icon={<Gift />}>Incentives</IconTitle>} description="Employee incentives and rewards." />
    <Card>
      <EmptyState className="py-16" icon={<Gift className="h-6 w-6" />} title="Incentives are coming soon" description="This is where incentives will be recorded and tracked. The setup will be added shortly." />
    </Card>
  </>
);
