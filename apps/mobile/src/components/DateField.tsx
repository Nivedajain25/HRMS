import { useState } from 'react';
import { Platform, Pressable, StyleSheet } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { format } from 'date-fns';
import { Calendar, Clock } from 'lucide-react-native';
import { keyToDate, toDateKey } from '@/lib/time';
import { radius, space, TOUCH_TARGET, useTheme } from '@/theme';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { Field } from './Field';
import { Text } from './Text';

export interface DateFieldProps {
  label?: string;
  /** `YYYY-MM-DD` (mode `date`) or `HH:mm` (mode `time`); empty when unset. */
  value: string | null | undefined;
  onChange: (value: string) => void;
  mode?: 'date' | 'time';
  /** `YYYY-MM-DD` bounds (date mode). */
  minimumDate?: string;
  maximumDate?: string;
  placeholder?: string;
  required?: boolean;
  error?: string;
  hint?: string;
  disabled?: boolean;
}

const pad = (n: number) => String(n).padStart(2, '0');

const toPickerDate = (value: string | null | undefined, mode: 'date' | 'time') => {
  if (mode === 'date') return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? keyToDate(value) : new Date();
  const d = new Date();
  const m = value ? /^(\d{2}):(\d{2})$/.exec(value) : null;
  d.setHours(m ? Number(m[1]) : 9, m ? Number(m[2]) : 0, 0, 0);
  return d;
};

const fromPickerDate = (d: Date, mode: 'date' | 'time') => (mode === 'date' ? toDateKey(d) : `${pad(d.getHours())}:${pad(d.getMinutes())}`);

const display = (value: string | null | undefined, mode: 'date' | 'time') => {
  if (!value) return null;
  return mode === 'date' ? format(keyToDate(value), 'EEE, dd MMM yyyy') : value;
};

/** Native date / time picker (Android dialog, iOS bottom sheet). */
export const DateField = ({
  label,
  value,
  onChange,
  mode = 'date',
  minimumDate,
  maximumDate,
  placeholder,
  required,
  error,
  hint,
  disabled,
}: DateFieldProps) => {
  const { c, scheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Date>(() => toPickerDate(value, mode));
  const min = minimumDate ? keyToDate(minimumDate) : undefined;
  const max = maximumDate ? keyToDate(maximumDate) : undefined;
  const Icon = mode === 'date' ? Calendar : Clock;
  const shown = display(value, mode);

  const openPicker = () => {
    const initial = toPickerDate(value, mode);
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: initial,
        mode,
        is24Hour: true,
        minimumDate: min,
        maximumDate: max,
        onValueChange: (_event, date) => onChange(fromPickerDate(date, mode)),
      });
      return;
    }
    setDraft(initial);
    setOpen(true);
  };

  return (
    <Field label={label} required={required} error={error} hint={hint}>
      <Pressable
        onPress={openPicker}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`${label ?? (mode === 'date' ? 'Date' : 'Time')}: ${shown ?? 'not set'}`}
        accessibilityHint={mode === 'date' ? 'Opens a date picker' : 'Opens a time picker'}
        accessibilityState={{ disabled: !!disabled }}
        style={({ pressed }) => [
          styles.box,
          { borderColor: error ? c.danger : c.lineStrong, backgroundColor: disabled ? c.surface3 : pressed ? c.surface2 : c.surface },
        ]}
      >
        <Icon size={18} color={c.muted} />
        <Text color={shown ? 'fg' : 'subtle'} tabular style={styles.flex} numberOfLines={1}>
          {shown ?? placeholder ?? (mode === 'date' ? 'Select date' : 'Select time')}
        </Text>
      </Pressable>
      {Platform.OS === 'ios' ? (
        <BottomSheet
          open={open}
          onClose={() => setOpen(false)}
          title={label ?? (mode === 'date' ? 'Select date' : 'Select time')}
          footer={
            <Button
              fullWidth
              onPress={() => {
                onChange(fromPickerDate(draft, mode));
                setOpen(false);
              }}
            >
              Done
            </Button>
          }
        >
          <DateTimePicker
            value={draft}
            mode={mode}
            display={mode === 'date' ? 'inline' : 'spinner'}
            minimumDate={min}
            maximumDate={max}
            locale="en-GB"
            themeVariant={scheme}
            accentColor={c.primary}
            textColor={c.fg}
            onValueChange={(_event, date) => setDraft(date)}
          />
        </BottomSheet>
      ) : null}
    </Field>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  box: {
    minHeight: TOUCH_TARGET + 4,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space(3),
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
  },
});
