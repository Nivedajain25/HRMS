import { StyleSheet, View } from 'react-native';
import { Check, X } from 'lucide-react-native';
import { Button } from '@/components';
import { space } from '@/theme';

/** Big Approve / Reject buttons for the sticky footer of an approval screen. */
export const DecisionBar = ({
  subject,
  onApprove,
  onReject,
  busy,
}: {
  /** Used in accessibility labels, e.g. "leave for Asha Rao". */
  subject: string;
  onApprove: () => void;
  /** Omit when the user may approve but not reject. */
  onReject?: () => void;
  busy: 'approve' | 'reject' | null;
}) => (
  <View style={styles.row}>
    {onReject ? (
      <Button
        variant="danger"
        size="lg"
        icon={X}
        style={styles.flex}
        disabled={!!busy}
        loading={busy === 'reject'}
        onPress={onReject}
        accessibilityLabel={`Reject ${subject}`}
      >
        Reject
      </Button>
    ) : null}
    <Button
      variant="success"
      size="lg"
      icon={Check}
      style={styles.flex}
      disabled={!!busy}
      loading={busy === 'approve'}
      onPress={onApprove}
      accessibilityLabel={`Approve ${subject}`}
    >
      Approve
    </Button>
  </View>
);

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: space(3) },
});
