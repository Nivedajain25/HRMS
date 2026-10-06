import { BookOpen, GraduationCap } from 'lucide-react';
import { Card, EmptyState, IconTitle, PageHeader } from '@/components/ui/display';

/** Placeholders until the learning / training procedure is decided. */
export const LearningPage = () => (
  <>
    <PageHeader breadcrumb={[{ label: 'Performance' }, { label: 'Learning' }]} title={<IconTitle icon={<BookOpen />}>Learning</IconTitle>} description="Courses and learning resources for employees." />
    <Card>
      <EmptyState className="py-16" icon={<BookOpen className="h-6 w-6" />} title="Learning is coming soon" description="This is where courses and learning material will be published. The setup will be added shortly." />
    </Card>
  </>
);

export const MyTrainingPage = () => (
  <>
    <PageHeader breadcrumb={[{ label: 'Performance' }, { label: 'My Training' }]} title={<IconTitle icon={<GraduationCap />}>My Training</IconTitle>} description="Trainings assigned to you and your progress." />
    <Card>
      <EmptyState className="py-16" icon={<GraduationCap className="h-6 w-6" />} title="My Training is coming soon" description="Trainings assigned to you, due dates and completion will appear here. The setup will be added shortly." />
    </Card>
  </>
);
