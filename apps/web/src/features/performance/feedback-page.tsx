import { useState } from 'react';
import { MessageSquarePlus } from 'lucide-react';
import { EmployeePicker } from '@/components/common/controls';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, EmptyState, PageHeader } from '@/components/ui/display';
import { Tabs } from '@/components/ui/overlay';
import { useListParams } from '@/hooks/use-list-params';
import { usePermissions } from '@/store/auth';
import { useFeedback } from './api';
import { FeedbackList, GiveFeedbackModal } from './components/feedback';
import { PerformanceLinks } from './components/perf-ui';

type Tab = 'received' | 'given' | 'colleague';

export const FeedbackPage = () => {
  const { hasEmployee } = usePermissions();
  const { params, set } = useListParams({ limit: 20 });
  const defaultTab: Tab = hasEmployee ? 'received' : 'colleague';
  const requested = (params.tab as Tab | undefined) ?? defaultTab;
  const tab: Tab = !hasEmployee && requested !== 'colleague' ? 'colleague' : requested;
  const employee = params.employee as string | undefined;
  const [giving, setGiving] = useState(false);

  const received = useFeedback({ page: params.page, limit: params.limit }, tab === 'received');
  const given = useFeedback({ page: params.page, limit: params.limit, given: true }, tab === 'given');
  const colleague = useFeedback({ page: params.page, limit: params.limit, employeeId: employee }, tab === 'colleague' && !!employee);

  const giveButton = hasEmployee ? (
    <Button icon={<MessageSquarePlus className="h-4 w-4" />} onClick={() => setGiving(true)}>
      Give feedback
    </Button>
  ) : undefined;

  return (
    <>
      <PageHeader
        title="Feedback"
        description="Continuous feedback between colleagues. Visibility is respected for every reader."
        actions={
          <>
            <PerformanceLinks current="feedback" />
            {giveButton}
          </>
        }
      />
      <div className="space-y-5">
        <Tabs
          tabs={[
            { key: 'received', label: 'Received', hidden: !hasEmployee },
            { key: 'given', label: 'Given', hidden: !hasEmployee },
            { key: 'colleague', label: 'About a colleague' },
          ]}
          active={tab}
          onChange={(key) => set({ tab: key === defaultTab ? undefined : key, employee: undefined })}
        />
        <div role="tabpanel" aria-labelledby={`tab-${tab}`}>
          {tab === 'received' && (
            <Card>
              <CardHeader title="Feedback you received" description="Includes private feedback, which only you and HR can see." />
              <FeedbackList query={received} mode="received" emptyTitle="No feedback yet" emptyDescription="When colleagues share feedback with you, it appears here." onPageChange={(page) => set({ page })} />
            </Card>
          )}
          {tab === 'given' && (
            <Card>
              <CardHeader title="Feedback you gave" />
              <FeedbackList query={given} mode="given" emptyTitle="You haven't given feedback yet" emptyDescription="Recognize a colleague's great work or help them grow." action={giveButton} onPageChange={(page) => set({ page })} />
            </Card>
          )}
          {tab === 'colleague' && (
            <Card>
              <CardHeader
                title="Feedback about a colleague"
                description="You see what their visibility settings allow: public feedback, plus manager-visible feedback for your reports."
                actions={
                  <div className="w-full min-w-56 sm:w-72">
                    <EmployeePicker value={employee ?? null} onChange={(v) => set({ employee: typeof v === 'string' ? v : undefined })} />
                  </div>
                }
              />
              {employee ? (
                <FeedbackList query={colleague} mode="received" emptyTitle="No visible feedback" emptyDescription="There is no feedback you are allowed to see for this person." onPageChange={(page) => set({ page })} />
              ) : (
                <EmptyState title="Choose a colleague" description="Select someone to see the feedback visible to you." />
              )}
            </Card>
          )}
        </div>
      </div>
      <GiveFeedbackModal open={giving} onClose={() => setGiving(false)} />
    </>
  );
};
