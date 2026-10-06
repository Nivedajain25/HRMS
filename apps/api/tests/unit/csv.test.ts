import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from '../../src/reports/csv';

describe('CSV exporter', () => {
  it('escapes per RFC 4180', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(csvCell('cr\r')).toBe('"cr\r"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(42.5)).toBe('42.5');
  });

  it('neutralizes spreadsheet formula injection', () => {
    expect(csvCell('=HYPERLINK("http://evil")')).toBe(`"'=HYPERLINK(""http://evil"")"`);
    expect(csvCell('+1+1')).toBe("'+1+1");
    expect(csvCell('-2+3')).toBe("'-2+3");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('\t=1')).toBe("'\t=1");
    // Numbers are data, never formulas.
    expect(csvCell(-5)).toBe('-5');
    // Only a leading trigger matters.
    expect(csvCell('a=b')).toBe('a=b');
  });

  it('writes a UTF-8 BOM, a header row and CRLF line endings', () => {
    const buf = toCsv(
      [
        { key: 'name', label: 'Name' },
        { key: 'city', label: 'City, State' },
        { key: 'n', label: 'Count', type: 'number' },
      ],
      [
        { name: 'Zoë', city: 'Pune, MH', n: 3 },
        { name: '=cmd|calc', city: null, n: 0 },
      ],
    );
    expect([...buf.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = buf.toString('utf8').slice(1);
    expect(text).toBe('Name,"City, State",Count\r\nZoë,"Pune, MH",3\r\n\'=cmd|calc,,0\r\n');
  });
});
