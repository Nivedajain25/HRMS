import { Plane } from 'lucide-react';
import { Card, EmptyState, IconTitle, PageHeader } from '@/components/ui/display';

/** Placeholder until the travel claims procedure is decided. */
export const TravelClaimsPage = () => (
  <>
    <PageHeader breadcrumb={[{ label: 'Expenses' }, { label: 'Travel Claims' }]} title={<IconTitle icon={<Plane />}>Travel Claims</IconTitle>} description="Claims for business travel — tickets, stay, local conveyance and daily allowance." />
    <Card>
      <EmptyState className="py-16" icon={<Plane className="h-6 w-6" />} title="Travel claims are coming soon" description="This is where travel claims will be submitted and approved. The setup will be added shortly." />
    </Card>
  </>
);
