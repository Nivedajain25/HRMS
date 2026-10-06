import { HandCoins } from 'lucide-react';
import { Card, EmptyState, IconTitle, PageHeader } from '@/components/ui/display';

/** Placeholder until the loans & advances procedure is decided. */
export const LoansPage = () => (
  <>
    <PageHeader
      breadcrumb={[{ label: 'Payroll' }, { label: 'Loans & Advances' }]}
      title={<IconTitle icon={<HandCoins />}>Loans & Advances</IconTitle>}
      description="Employee loans and salary advances."
    />
    <Card>
      <EmptyState className="py-16" icon={<HandCoins className="h-6 w-6" />} title="Loans & advances are coming soon" description="This is where loan and salary advance requests will be made and tracked. The setup will be added shortly." />
    </Card>
  </>
);
