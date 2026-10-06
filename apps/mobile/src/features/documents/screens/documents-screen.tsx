import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Download, FileText, FileUp, Lock } from 'lucide-react-native';
import { DOCUMENT_CATEGORIES } from '@stencil/shared';
import { Badge, BottomSheet, Button, Card, EmptyState, ErrorState, Header, Notice, Screen, Select, Skeleton, SkeletonList, Text } from '@/components';
import { DetailList } from '@/features/profile/kit/detail-list';
import { formatBytes, openProtectedFile } from '@/features/profile/kit/files';
import { FilterChips } from '@/features/profile/kit/filter-chips';
import { flattenPages, LoadMore, totalOf } from '@/features/profile/kit/infinite';
import { useAuth } from '@/lib/auth';
import { fullName, label } from '@/lib/format';
import { dateKeyIn, formatDate, formatDateTimeIn } from '@/lib/time';
import { radius, space, useTheme } from '@/theme';
import { expiryInfo, useDocument, useDocumentLibrary, type DocumentRecord, type LibraryScope } from '../api';

const CATEGORY_OPTIONS = [{ value: 'ALL', label: 'All categories' }, ...DOCUMENT_CATEGORIES.map((c) => ({ value: c, label: label(c) }))];

const ExpiryBadge = ({ expiry, today }: { expiry?: string | null; today: string }) => {
  const info = expiryInfo(expiry, today);
  if (!info) return null;
  if (info.state === 'expired') return <Badge tone="red">{`Expired ${formatDate(expiry)}`}</Badge>;
  if (info.state === 'soon') return <Badge tone="amber">{info.daysLeft === 0 ? 'Expires today' : `Expires in ${info.daysLeft} d`}</Badge>;
  return <Badge tone="gray">{`Valid until ${formatDate(expiry)}`}</Badge>;
};

const VerificationBadge = ({ status }: { status: DocumentRecord['verificationStatus'] }) =>
  status === 'VERIFIED' ? (
    <Badge tone="green" dot>
      Verified
    </Badge>
  ) : status === 'REJECTED' ? (
    <Badge tone="red" dot>
      Rejected
    </Badge>
  ) : (
    <Badge tone="amber" dot>
      Pending verification
    </Badge>
  );

const DocumentRow = ({ d, showVerification, today, onOpen }: { d: DocumentRecord; showVerification: boolean; today: string; onOpen: () => void }) => {
  const { c } = useTheme();
  return (
    <Card onPress={onOpen} accessibilityLabel={`${d.title}, ${label(d.category)}`} accessibilityHint="Shows the document details" style={styles.card}>
      <View style={styles.row}>
        <View style={[styles.fileIcon, { backgroundColor: c.accentSoft }]}>
          <FileText size={20} color={c.accent} />
        </View>
        <View style={styles.flex}>
          <Text weight="semibold" numberOfLines={2}>
            {d.title}
          </Text>
          <Text size="xs" color="muted" numberOfLines={1}>
            {[label(d.category), formatBytes(d.size), d.version > 1 ? `v${d.version}` : null].filter(Boolean).join(' · ')}
          </Text>
        </View>
        {d.confidential ? <Lock size={16} color={c.muted} accessibilityLabel="Confidential" /> : null}
      </View>
      <View style={styles.badges}>
        {showVerification ? <VerificationBadge status={d.verificationStatus} /> : null}
        <ExpiryBadge expiry={d.expiryDate} today={today} />
      </View>
    </Card>
  );
};

const DocumentSheet = ({ id, onClose, today, timeZone }: { id: string | null; onClose: () => void; today: string; timeZone: string }) => {
  const doc = useDocument(id);
  const [opening, setOpening] = useState(false);
  const d = doc.data;
  const open = async () => {
    if (!d) return;
    setOpening(true);
    await openProtectedFile(`/files/${d._id}`, { fileName: d.originalName, mimeType: d.mimeType });
    setOpening(false);
  };
  const verifiedBy = d?.verifiedBy && typeof d.verifiedBy === 'object' ? fullName(d.verifiedBy) : null;
  return (
    <BottomSheet
      open={!!id}
      onClose={onClose}
      title={d?.title ?? 'Document'}
      description={d ? d.originalName : undefined}
      footer={
        d ? (
          <Button icon={Download} loading={opening} onPress={() => void open()} fullWidth accessibilityLabel={`Open or share ${d.originalName}`}>
            Open / share
          </Button>
        ) : undefined
      }
    >
      {doc.isLoading ? (
        <View style={styles.gap}>
          <Skeleton height={18} />
          <Skeleton height={18} width="70%" />
          <Skeleton height={18} width="50%" />
        </View>
      ) : doc.error || !d ? (
        <ErrorState compact title="Could not load this document" error={doc.error} onRetry={() => void doc.refetch()} />
      ) : (
        <>
          {d.verificationStatus === 'REJECTED' && d.verificationNote ? <Notice tone="danger">{`Rejected: ${d.verificationNote}`}</Notice> : null}
          <DetailList
            items={[
              { label: 'Category', value: label(d.category) },
              { label: 'Belongs to', value: d.context === 'ORGANIZATION' ? 'Company-wide' : d.employeeId ? fullName(d.employeeId) : null },
              { label: 'Verification', value: d.context === 'EMPLOYEE' ? label(d.verificationStatus) : null },
              { label: 'Verified by', value: verifiedBy ? `${verifiedBy}${d.verifiedAt ? ` · ${formatDate(d.verifiedAt)}` : ''}` : null },
              { label: 'Expiry', value: d.expiryDate ? <ExpiryBadge expiry={d.expiryDate} today={today} /> : null, accessibilityValue: formatDate(d.expiryDate) },
              { label: 'Version', value: `v${d.version}${d.versions.length > 1 ? ` of ${d.versions.length}` : ''}` },
              { label: 'Size', value: formatBytes(d.size) },
              { label: 'Uploaded', value: `${formatDateTimeIn(d.createdAt, timeZone)}${d.uploadedBy ? ` · ${fullName(d.uploadedBy)}` : ''}` },
              { label: 'Confidential', value: d.confidential ? 'Yes — hidden from managers' : null },
            ]}
          />
          {d.description ? (
            <Text size="sm" color="fg2">
              {d.description}
            </Text>
          ) : null}
        </>
      )}
    </BottomSheet>
  );
};

export const DocumentsScreen = () => {
  const { hasEmployee, timeZone } = useAuth();
  const params = useLocalSearchParams<{ highlight?: string }>();
  const [scope, setScope] = useState<LibraryScope>(hasEmployee ? 'me' : 'organization');
  const [category, setCategory] = useState<string>('ALL');
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useDocumentLibrary(scope, category === 'ALL' ? undefined : category);
  const items = flattenPages(list.data);
  const today = dateKeyIn(timeZone);

  // Notification / search links: `/documents?highlight=<id>`.
  const highlight = params.highlight;
  useEffect(() => {
    if (highlight && /^[a-f\d]{24}$/i.test(highlight)) setOpenId(highlight);
  }, [highlight]);

  const closeSheet = () => {
    setOpenId(null);
    if (highlight) router.setParams({ highlight: undefined });
  };

  return (
    <Screen
      header={<Header title="Documents" subtitle="Personal records and company policies" back backTo="/more" />}
      onRefresh={() => list.refetch()}
      footer={
        hasEmployee ? (
          <Button icon={FileUp} fullWidth onPress={() => router.push('/more/documents/upload')}>
            Upload document
          </Button>
        ) : undefined
      }
    >
      {hasEmployee ? (
        <FilterChips<LibraryScope>
          accessibilityLabel="Library"
          value={scope}
          onChange={setScope}
          options={[
            { value: 'me', label: 'My documents' },
            { value: 'organization', label: 'Company policies' },
          ]}
        />
      ) : null}
      <Select label="Category" value={category} options={CATEGORY_OPTIONS} onChange={setCategory} />
      {list.isLoading ? (
        <Card>
          <SkeletonList rows={3} />
        </Card>
      ) : list.error ? (
        <Card>
          <ErrorState title="Could not load documents" error={list.error} onRetry={() => void list.refetch()} />
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={FileText}
            title={category !== 'ALL' ? `No ${label(category).toLowerCase()} documents` : scope === 'me' ? 'No documents yet' : 'No company policies yet'}
            message={
              category !== 'ALL'
                ? 'Try another category.'
                : scope === 'me'
                  ? 'Upload your ID proofs, certificates and other records so HR can verify them.'
                  : 'Handbooks and policies shared with everyone appear here.'
            }
          />
        </Card>
      ) : (
        <View style={styles.list}>
          {items.map((d) => (
            <DocumentRow key={d._id} d={d} showVerification={scope === 'me'} today={today} onOpen={() => setOpenId(d._id)} />
          ))}
          <LoadMore
            hasNextPage={list.hasNextPage}
            isFetchingNextPage={list.isFetchingNextPage}
            onLoadMore={() => void list.fetchNextPage()}
            shown={items.length}
            total={totalOf(list.data)}
            noun="documents"
          />
        </View>
      )}
      <DocumentSheet id={openId} onClose={closeSheet} today={today} timeZone={timeZone} />
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: space(2) },
  list: { gap: space(3) },
  card: { gap: space(2) },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
  fileIcon: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2) },
});
