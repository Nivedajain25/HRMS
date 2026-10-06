const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const SCALES = ['', 'Thousand', 'Million', 'Billion', 'Trillion'];

const belowThousand = (n: number): string => {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} Hundred`);
    n %= 100;
  }
  if (n >= 20) {
    parts.push(TENS[Math.floor(n / 10)]! + (n % 10 ? `-${ONES[n % 10]}` : ''));
  } else if (n > 0) {
    parts.push(ONES[n]!);
  }
  return parts.join(' ');
};

/** Integer to English words (short scale), e.g. 1250 → "One Thousand Two Hundred Fifty". */
export const integerToWords = (value: number): string => {
  let n = Math.floor(Math.abs(value));
  if (n === 0) return 'Zero';
  const chunks: string[] = [];
  let scale = 0;
  while (n > 0 && scale < SCALES.length) {
    const chunk = n % 1000;
    if (chunk) chunks.unshift(`${belowThousand(chunk)}${SCALES[scale] ? ` ${SCALES[scale]}` : ''}`);
    n = Math.floor(n / 1000);
    scale++;
  }
  return chunks.join(' ');
};

/** Amount in words with a currency code, e.g. "USD One Hundred and 50/100 only". */
export const amountInWords = (amount: number, currency: string) => {
  const whole = Math.floor(Math.abs(amount));
  const cents = Math.round((Math.abs(amount) - whole) * 100);
  const sign = amount < 0 ? 'Minus ' : '';
  return `${currency} ${sign}${integerToWords(whole)}${cents ? ` and ${String(cents).padStart(2, '0')}/100` : ''} only`;
};
