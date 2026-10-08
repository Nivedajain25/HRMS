import { Link } from 'react-router-dom';
import { NAVIGATION, isAllowed } from '@/app/navigation';
import { AppIcon } from '@/components/common/app-icon';
import { Modal } from '@/components/ui/overlay';
import { usePermissions } from '@/store/auth';

/**
 * Every feature this person can open, as app icons grouped by section — the same sections as the left menu, so
 * related features (People, Attendance, Leave, Payroll…) sit together. Opened from Quick Actions' "More".
 */
export const AllFeaturesModal = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const { user, isManager, hasEmployee } = usePermissions();
  const perms = user?.permissions ?? [];
  const groups = NAVIGATION.filter((g) => isAllowed(g, perms, isManager, hasEmployee))
    .map((g) => ({
      ...g,
      items: g.to
        ? [{ label: g.label, to: g.to, icon: g.icon, tone: g.tone }]
        : (g.children ?? []).filter((c) => isAllowed(c, perms, isManager, hasEmployee)).map((c) => ({ ...c, tone: c.tone ?? g.tone })),
    }))
    .filter((g) => g.items.length);

  return (
    <Modal open={open} onClose={onClose} title="All features" description="Everything you can open, grouped like the menu." size="lg">
      <div className="space-y-5">
        {groups.map((g) => (
          <section key={g.label} aria-label={g.label}>
            <h3 className="mb-2.5 text-xs font-semibold tracking-wide text-muted uppercase">{g.label}</h3>
            <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
              {g.items.map((item) => (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    onClick={onClose}
                    className="group flex flex-col items-center gap-2 rounded-xl p-2 text-center text-xs font-medium text-fg hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
                  >
                    <AppIcon icon={item.icon} tone={item.tone} size="lg" variant="solid" />
                    <span className="line-clamp-2">{item.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  );
};
