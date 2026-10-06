import type { ReactNode } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { Briefcase, Building2, CalendarDays, IdCard } from 'lucide-react-native';
import { Avatar, Card, StatusBadge, Text, toast, type IconComponent } from '@/components';
import { fullName, label, shiftRange } from '@/lib/format';
import { formatDate } from '@/lib/time';
import { space, useTheme } from '@/theme';
import { DetailCard, type DetailItem } from '../kit/detail-list';
import type { EmployeeDetail } from '../api';

const open = (url: string) => {
  Linking.openURL(url).catch(() => toast.error('No app can open this link'));
};

/** Tappable email / phone value. */
export const ContactLink = ({ value, kind }: { value: string; kind: 'mailto' | 'tel' }) => (
  <Text
    size="sm"
    weight="medium"
    color="accent"
    align="right"
    onPress={() => open(`${kind}:${value.replace(/\s+/g, kind === 'tel' ? '' : ' ')}`)}
    accessibilityRole="link"
    accessibilityHint={kind === 'mailto' ? 'Writes an email' : 'Calls this number'}
    suppressHighlighting={false}
  >
    {value}
  </Text>
);

const Meta = ({ icon: Icon, children }: { icon: IconComponent; children: ReactNode }) => {
  const { c } = useTheme();
  return (
    <View style={styles.meta}>
      <Icon size={14} color={c.muted} />
      <Text size="sm" color="muted" numberOfLines={1} style={styles.shrink}>
        {children}
      </Text>
    </View>
  );
};

/** Photo, name, status and key facts (the web `ProfileHeader`). */
export const ProfileHeaderCard = ({ e, photoAction }: { e: EmployeeDetail; photoAction?: ReactNode }) => {
  const name = fullName(e);
  return (
    <Card style={styles.header}>
      <View style={styles.avatarWrap}>
        <Avatar name={name} uri={e.profilePhoto} size={88} />
        {photoAction}
      </View>
      <View style={styles.headerText}>
        <Text size="lg" weight="semibold" align="center" accessibilityRole="header">
          {name}
        </Text>
        <StatusBadge status={e.employmentStatus} />
      </View>
      <View style={styles.metas}>
        <Meta icon={IdCard}>{e.employeeId}</Meta>
        {e.designationId ? <Meta icon={Briefcase}>{e.designationId.name}</Meta> : null}
        {e.departmentId ? <Meta icon={Building2}>{e.departmentId.name}</Meta> : null}
        <Meta icon={CalendarDays}>{`Joined ${formatDate(e.joiningDate)}`}</Meta>
      </View>
    </Card>
  );
};

const address = (e: EmployeeDetail) => [e.address, e.city, e.state, e.postalCode, e.country].filter(Boolean).join(', ');

/** Every section the API returned for this employee (empty fields and sections are hidden). */
export const EmployeeSections = ({ e, self }: { e: EmployeeDetail; self?: boolean }) => {
  const contact: DetailItem[] = [
    { label: 'Work email', value: e.workEmail ? <ContactLink value={e.workEmail} kind="mailto" /> : null, accessibilityValue: e.workEmail },
    { label: 'Phone', value: e.phone ? <ContactLink value={e.phone} kind="tel" /> : null, accessibilityValue: e.phone },
    { label: 'Personal email', value: e.personalEmail ? <ContactLink value={e.personalEmail} kind="mailto" /> : null, accessibilityValue: e.personalEmail },
    { label: 'Alternate phone', value: e.alternatePhone ? <ContactLink value={e.alternatePhone} kind="tel" /> : null, accessibilityValue: e.alternatePhone },
    { label: 'Address', value: address(e) },
  ];
  const work: DetailItem[] = [
    { label: 'Department', value: e.departmentId?.name },
    { label: 'Designation', value: e.designationId?.name },
    { label: 'Reporting manager', value: e.managerId ? fullName(e.managerId) : null },
    { label: 'Direct reports', value: e.directReportCount ? String(e.directReportCount) : null },
    { label: 'Location', value: e.locationId ? [e.locationId.name, e.locationId.city].filter(Boolean).join(', ') : null },
    { label: 'Shift', value: e.shiftId ? `${e.shiftId.name} (${shiftRange(e.shiftId.startTime, e.shiftId.endTime)})` : null },
    { label: 'Employment type', value: label(e.employmentType) },
    { label: 'Joining date', value: formatDate(e.joiningDate) },
    { label: 'Confirmation date', value: e.confirmationDate ? formatDate(e.confirmationDate) : null },
    { label: 'Probation', value: e.probationPeriodDays !== undefined ? `${e.probationPeriodDays} days` : null },
    { label: 'Notice period', value: e.noticePeriodDays !== undefined ? `${e.noticePeriodDays} days` : null },
    { label: 'Exit date', value: e.exitDate ? formatDate(e.exitDate) : null },
  ];
  const personal: DetailItem[] = [
    { label: 'Full name', value: [e.firstName, e.middleName, e.lastName].filter(Boolean).join(' ') },
    { label: 'Gender', value: label(e.gender) },
    { label: 'Date of birth', value: e.dateOfBirth ? formatDate(e.dateOfBirth) : null },
    { label: 'Blood group', value: e.bloodGroup },
    { label: 'Marital status', value: label(e.maritalStatus) },
  ];
  const emergency: DetailItem[] = [
    { label: 'Name', value: e.emergencyContact?.contactName },
    { label: 'Relationship', value: e.emergencyContact?.relationship },
    {
      label: 'Phone',
      value: e.emergencyContact?.phone ? <ContactLink value={e.emergencyContact.phone} kind="tel" /> : null,
      accessibilityValue: e.emergencyContact?.phone,
    },
    { label: 'Address', value: e.emergencyContact?.address },
  ];
  const bank: DetailItem[] = e.bank
    ? [
        { label: 'Bank', value: e.bank.bankName },
        { label: 'Account holder', value: e.bank.accountHolderName },
        { label: 'Account number', value: e.bank.accountNumber ?? e.bank.accountNumberMasked, tabular: true },
        { label: 'IFSC / Routing', value: e.bank.ifsc, tabular: true },
        { label: 'Branch', value: e.bank.branch },
      ]
    : [];
  const identity: DetailItem[] = Object.entries(e.identity ?? {}).map(([k, v]) => ({ label: label(k), value: v, tabular: true }));

  return (
    <>
      <DetailCard title="Contact" items={contact} />
      <DetailCard title="Employment" items={work} />
      <DetailCard title="Personal" items={personal} />
      <DetailCard title="Emergency contact" items={emergency} empty={self ? 'Add someone we can contact in an emergency.' : undefined} />
      {bank.length ? (
        <DetailCard
          title="Bank details"
          items={bank}
          footer={
            e.sensitiveVisible === false ? (
              <Text size="xs" color="muted">
                Masked for your security. Contact HR to change bank details.
              </Text>
            ) : null
          }
        />
      ) : null}
      {identity.length ? <DetailCard title="Identity documents" items={identity} /> : null}
    </>
  );
};

const styles = StyleSheet.create({
  shrink: { flexShrink: 1 },
  header: { alignItems: 'center', gap: space(3) },
  avatarWrap: { alignItems: 'center' },
  headerText: { alignItems: 'center', gap: space(1.5) },
  metas: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: space(4), rowGap: space(1) },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space(1.5), maxWidth: '100%' },
});
