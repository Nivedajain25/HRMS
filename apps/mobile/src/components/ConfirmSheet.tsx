import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { Text } from './Text';
import { TextField } from './TextField';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  /** Ask for a reason (e.g. rejection). */
  reason?: { label: string; placeholder?: string; required?: boolean; maxLength?: number };
}

export interface ConfirmResult {
  confirmed: boolean;
  reason?: string;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<ConfirmResult>;
const ConfirmContext = createContext<ConfirmFn | null>(null);

/** Hosts the confirmation sheet; use `useConfirm()` anywhere below it. */
export const ConfirmProvider = ({ children }: { children: ReactNode }) => {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const resolver = useRef<((r: ConfirmResult) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    resolver.current?.({ confirmed: false });
    setReason('');
    setTouched(false);
    setOptions(opts);
    return new Promise<ConfirmResult>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const finish = (result: ConfirmResult) => {
    resolver.current?.(result);
    resolver.current = null;
    setOptions(null);
  };

  const trimmed = reason.trim();
  const reasonMissing = !!options?.reason?.required && !trimmed;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <BottomSheet
        open={!!options}
        onClose={() => finish({ confirmed: false })}
        title={options?.title}
        footer={
          <View style={styles.actions}>
            <Button variant="outline" style={styles.flex} onPress={() => finish({ confirmed: false })}>
              {options?.cancelLabel ?? 'Cancel'}
            </Button>
            <Button
              variant={options?.tone === 'danger' ? 'danger' : 'primary'}
              style={styles.flex}
              onPress={() => {
                if (reasonMissing) {
                  setTouched(true);
                  return;
                }
                finish({ confirmed: true, reason: trimmed || undefined });
              }}
            >
              {options?.confirmLabel ?? 'Confirm'}
            </Button>
          </View>
        }
      >
        {options?.message ? <Text color="fg2">{options.message}</Text> : null}
        {options?.reason ? (
          <TextField
            label={options.reason.label}
            required={options.reason.required}
            placeholder={options.reason.placeholder}
            value={reason}
            onChangeText={setReason}
            multiline
            maxLength={options.reason.maxLength ?? 1000}
            error={touched && reasonMissing ? `${options.reason.label} is required` : undefined}
          />
        ) : null}
      </BottomSheet>
    </ConfirmContext.Provider>
  );
};

export const useConfirm = () => {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used inside <ConfirmProvider>');
  return ctx;
};

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: 12 },
  flex: { flex: 1 },
});
