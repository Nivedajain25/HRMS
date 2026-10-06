import { describe, expect, it } from 'vitest';
import { computeDays } from '../../src/payroll/core/days';
import { evaluateSalary, overtimeAmount, prorationFactor, slabAmount, type EngineComponent } from '../../src/payroll/core/engine';
import { amountInWords, integerToWords } from '../../src/payroll/core/words';
import { eachDateKey, weekdayOf } from '../../src/utils/dates';

const PF: EngineComponent = { code: 'PF', name: 'PF', type: 'DEDUCTION', calculationType: 'PERCENT_OF_BASIC', value: 12, baseCap: 15000, order: 200 };
const PF_ER: EngineComponent = { ...PF, code: 'PF_ER', name: 'PF (Employer)', employerContribution: true, order: 201 };
const ESI: EngineComponent = { code: 'ESI', name: 'ESI', type: 'DEDUCTION', calculationType: 'PERCENT_OF_GROSS', value: 0.75, eligibilityMaxGross: 21000, order: 202 };
const PT: EngineComponent = {
  code: 'PT',
  name: 'Professional Tax',
  type: 'DEDUCTION',
  calculationType: 'SLAB',
  value: 0,
  prorate: false,
  slabs: [
    { from: 0, to: 15000, amount: 0 },
    { from: 15000, to: 20000, amount: 150 },
    { from: 20000, to: null, amount: 200 },
  ],
  order: 203,
};
const HRA: EngineComponent = { code: 'HRA', name: 'HRA', type: 'EARNING', calculationType: 'PERCENT_OF_BASIC', value: 40, order: 20 };

const amount = (lines: { code: string; amount: number }[], code: string) => lines.find((l) => l.code === code)?.amount;

describe('payroll engine', () => {
  it('applies percent of basic with a base cap', () => {
    expect(amount(evaluateSalary({ basic: 20000, components: [PF] }).deductions, 'PF')).toBe(1800);
    expect(amount(evaluateSalary({ basic: 10000, components: [PF] }).deductions, 'PF')).toBe(1200);
  });

  it('applies percent of gross and the eligibility cutoff (ESI style)', () => {
    const eligible = evaluateSalary({ basic: 12000, components: [HRA, ESI] }); // gross 16800
    expect(eligible.gross).toBe(16800);
    expect(amount(eligible.deductions, 'ESI')).toBe(126);
    const ineligible = evaluateSalary({ basic: 20000, components: [HRA, ESI] }); // gross 28000 > 21000
    expect(amount(ineligible.deductions, 'ESI')).toBe(0);
  });

  it('picks the matching slab (bounds inclusive, lower slab wins)', () => {
    expect(slabAmount(PT.slabs, 12000)).toBe(0);
    expect(slabAmount(PT.slabs, 15000)).toBe(0);
    expect(slabAmount(PT.slabs, 18000)).toBe(150);
    expect(slabAmount(PT.slabs, 25000)).toBe(200);
    expect(amount(evaluateSalary({ basic: 18000, components: [PT] }).deductions, 'PT')).toBe(150);
  });

  it('keeps employer contributions out of gross/net but in CTC', () => {
    const r = evaluateSalary({ basic: 10000, components: [HRA, PF, PF_ER] });
    expect(r.gross).toBe(14000);
    expect(r.totalDeductions).toBe(1200);
    expect(r.totalEmployerContributions).toBe(1200);
    expect(r.net).toBe(12800);
    expect(r.deductions.map((d) => d.code)).toEqual(['PF']);
    expect(r.employerContributions.map((d) => d.code)).toEqual(['PF_ER']);
    expect(r.annualCtc).toBe(12 * (14000 + 1200));
  });

  it('caps amounts with maxAmount', () => {
    const r = evaluateSalary({ basic: 50000, components: [{ ...HRA, maxAmount: 10000 }] });
    expect(amount(r.earnings, 'HRA')).toBe(10000);
  });

  it('prorates earnings and evaluates deductions on earned amounts', () => {
    const bonus: EngineComponent = { code: 'BONUS', name: 'Bonus', type: 'EARNING', calculationType: 'FIXED', value: 1000, prorate: false, order: 60 };
    const r = evaluateSalary({ basic: 30000, components: [HRA, bonus, PF, PT], factor: 0.5 });
    expect(amount(r.earnings, 'BASIC')).toBe(15000);
    expect(amount(r.earnings, 'HRA')).toBe(6000);
    expect(amount(r.earnings, 'BONUS')).toBe(1000); // prorate: false
    expect(r.gross).toBe(22000);
    expect(amount(r.deductions, 'PF')).toBe(1800); // 12% of earned basic 15000 (= cap)
    expect(amount(r.deductions, 'PT')).toBe(200); // slab on prorated gross 22000
    expect(r.net).toBe(20000);
  });

  it('includes extra earnings (overtime) in gross and the deduction base', () => {
    const r = evaluateSalary({ basic: 10000, components: [ESI], extraEarnings: [{ code: 'OVERTIME', name: 'Overtime', amount: 500 }] });
    expect(r.gross).toBe(10500);
    expect(amount(r.deductions, 'ESI')).toBe(78.75);
  });

  it('rounds each line to 2 decimals', () => {
    const odd: EngineComponent = { code: 'ODD', name: 'Odd', type: 'EARNING', calculationType: 'PERCENT_OF_BASIC', value: 33.333, order: 30 };
    const r = evaluateSalary({ basic: 1000, components: [odd], factor: 1 / 3 });
    expect(amount(r.earnings, 'BASIC')).toBe(333.33);
    expect(amount(r.earnings, 'ODD')).toBe(111.11);
    expect(r.gross).toBe(444.44);
  });

  it('computes the proration factor and overtime formula', () => {
    expect(prorationFactor(30, 2, 0)).toBeCloseTo(28 / 30, 10);
    expect(prorationFactor(30, 0, 10)).toBeCloseTo(20 / 30, 10);
    expect(prorationFactor(30, 40, 0)).toBe(0);
    // (22000 / (22 × 8)) × 4h × 1.5 = 750
    expect(overtimeAmount(22000, 22, 8, 4, 1.5)).toBe(750);
    expect(overtimeAmount(22000, 22, 8, 0, 1.5)).toBe(0);
  });

  it('writes amounts in words', () => {
    expect(integerToWords(0)).toBe('Zero');
    expect(integerToWords(1250)).toBe('One Thousand Two Hundred Fifty');
    expect(integerToWords(1000001)).toBe('One Million One');
    expect(amountInWords(99.5, 'USD')).toBe('USD Ninety-Nine and 50/100 only');
  });
});

describe('pay days', () => {
  // September 2026: 30 days, Mon-Fri working → 22 working days.
  const dates = eachDateKey('2026-09-01', '2026-09-30');
  const kindOf = (d: string) => (d === '2026-09-07' ? 'HOLIDAY' : ['SAT', 'SUN'].includes(weekdayOf(d)) ? 'WEEK_OFF' : 'WORKING') as 'WORKING' | 'WEEK_OFF' | 'HOLIDAY';

  it('counts unpaid leave, absences (not double counting leave) and paid leave', () => {
    const r = computeDays({
      dates,
      kindOf,
      employedFrom: '2026-09-01',
      employedTo: '2026-09-30',
      basis: 'CALENDAR',
      leaves: [
        { dates: ['2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13'], halfDay: false, paid: false }, // Thu, Fri + weekend
        { dates: ['2026-09-15'], halfDay: true, paid: true },
      ],
      attendance: [
        { date: '2026-09-01', status: 'PRESENT', overtimeMinutes: 90 },
        { date: '2026-09-02', status: 'HALF_DAY' },
        { date: '2026-09-03', status: 'ABSENT' },
        { date: '2026-09-10', status: 'ABSENT' }, // covered by leave
        { date: '2026-09-15', status: 'ABSENT' }, // half covered by leave
        { date: '2026-09-05', status: 'ABSENT' }, // weekend, ignored
      ],
    });
    expect(r.daysInPeriod).toBe(30);
    expect(r.workingDays).toBe(21);
    expect(r.holidays).toBe(1);
    expect(r.weekOffs).toBe(8);
    expect(r.unpaidLeaveDays).toBe(2);
    expect(r.paidLeaveDays).toBe(0.5);
    expect(r.absentDays).toBe(1.5);
    expect(r.lopDays).toBe(3.5);
    expect(r.presentDays).toBe(1.5);
    expect(r.overtimeMinutes).toBe(90);
    expect(r.paidDays).toBe(26.5);
    expect(r.factor).toBeCloseTo(26.5 / 30, 10);
  });

  it('treats days outside employment as unpaid (calendar and working basis)', () => {
    const base = { dates, kindOf, employedFrom: '2026-09-16', employedTo: '2026-09-30', leaves: [], attendance: [] };
    const cal = computeDays({ ...base, basis: 'CALENDAR' });
    expect(cal.notEmployedDays).toBe(15);
    expect(cal.factor).toBeCloseTo(15 / 30, 10);
    const work = computeDays({ ...base, basis: 'WORKING' });
    expect(work.basisDays).toBe(21);
    expect(work.notEmployedDays).toBe(10); // Sep 1-15 working days minus the holiday on the 7th
    expect(work.factor).toBeCloseTo(11 / 21, 10);
  });
});
