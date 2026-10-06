/**
 * Pure payroll calculation engine (no I/O). All amounts are monthly.
 *
 * Evaluation order
 * ----------------
 * 1. Basic: `basic × factor` (factor applies when the BASIC component prorates).
 * 2. Earnings (non employer-contribution), evaluated on FULL-month bases and
 *    then multiplied by the proration factor when the component has `prorate`:
 *      FIXED            → value
 *      PERCENT_OF_BASIC → value% × min(basic, baseCap || ∞)
 *      SLAB             → slab amount for the full basic
 *      PERCENT_OF_GROSS → value% × min(fixedGross, baseCap || ∞), where
 *                         fixedGross = basic + all other earnings above
 *    `eligibilityMaxGross` is checked against fixedGross, `maxAmount` caps the
 *    full-month amount.
 * 3. gross = prorated basic + prorated earnings + `extraEarnings` (e.g. overtime).
 * 4. Deductions and employer contributions, evaluated on the EARNED
 *    (prorated) bases so they follow the days actually paid:
 *      FIXED            → value × factor (when `prorate`), otherwise value
 *      PERCENT_OF_BASIC → value% × min(earnedBasic, baseCap || ∞)
 *      PERCENT_OF_GROSS → value% × min(gross, baseCap || ∞)
 *      SLAB             → slab amount for gross
 *    A component with `eligibilityMaxGross > 0` is zero when gross exceeds it.
 *    `maxAmount > 0` caps the amount.
 * 5. Employer contributions are reported separately: they are NOT part of gross,
 *    deductions or net, but are part of CTC.
 *    net = gross − deductions; annualCtc = 12 × (gross + employerContributions).
 *
 * Slabs: first slab with `from <= base <= to` (to = null → unbounded) wins,
 * so a boundary value belongs to the lower slab.
 * Every line is rounded to 2 decimals; totals are sums of rounded lines.
 */

export type ComponentKind = 'EARNING' | 'DEDUCTION';
export type CalculationType = 'FIXED' | 'PERCENT_OF_BASIC' | 'PERCENT_OF_GROSS' | 'SLAB';

export interface Slab {
  from: number;
  to: number | null;
  amount: number;
}

export interface EngineComponent {
  componentId?: string;
  code: string;
  name: string;
  type: ComponentKind;
  calculationType: CalculationType;
  /** Amount (FIXED) or percentage (PERCENT_*); ignored for SLAB. */
  value: number;
  maxAmount?: number;
  baseCap?: number;
  eligibilityMaxGross?: number;
  slabs?: Slab[];
  prorate?: boolean;
  employerContribution?: boolean;
  order?: number;
}

export interface EngineLine {
  componentId?: string;
  code: string;
  name: string;
  type: ComponentKind;
  calculationType: CalculationType | 'EXTRA';
  value: number;
  amount: number;
  employerContribution: boolean;
}

export interface ExtraEarning {
  code: string;
  name: string;
  amount: number;
}

export interface EngineInput {
  basic: number;
  /** Master data for the BASIC component (name, prorate). */
  basicComponent?: { componentId?: string; name?: string; prorate?: boolean };
  components: EngineComponent[];
  /** Proration factor in [0, 1]; 1 = full month. */
  factor?: number;
  /** Recurring earnings added to gross before deductions are evaluated (e.g. overtime). */
  extraEarnings?: ExtraEarning[];
}

export interface EngineResult {
  earnings: EngineLine[];
  deductions: EngineLine[];
  employerContributions: EngineLine[];
  gross: number;
  totalDeductions: number;
  totalEmployerContributions: number;
  net: number;
  annualCtc: number;
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const sum = (lines: { amount: number }[]) => round2(lines.reduce((s, l) => s + l.amount, 0));

const capBase = (base: number, cap?: number) => (cap && cap > 0 ? Math.min(base, cap) : base);

const capAmount = (amount: number, max?: number) => (max && max > 0 ? Math.min(amount, max) : amount);

export const clampFactor = (factor: number | undefined) => {
  if (factor === undefined || !Number.isFinite(factor)) return 1;
  return Math.min(1, Math.max(0, factor));
};

/** Slab amount for a base (bounds inclusive; first match wins). */
export const slabAmount = (slabs: Slab[] | undefined, base: number) => {
  for (const s of slabs ?? []) {
    if (base >= s.from && (s.to === null || s.to === undefined || base <= s.to)) return s.amount;
  }
  return 0;
};

/** Proration factor = (payableDays − lopDays − notEmployedDays) / payableDays, clamped to [0, 1]. */
export const prorationFactor = (payableDays: number, lopDays: number, notEmployedDays = 0) => {
  if (payableDays <= 0) return 0;
  return clampFactor((payableDays - lopDays - notEmployedDays) / payableDays);
};

/**
 * Overtime amount = (fixedMonthlyGross / (workingDays × shiftHours)) × hours × multiplier.
 */
export const overtimeAmount = (fixedMonthlyGross: number, workingDays: number, shiftHours: number, hours: number, multiplier: number) => {
  if (hours <= 0 || workingDays <= 0 || shiftHours <= 0) return 0;
  return round2((fixedMonthlyGross / (workingDays * shiftHours)) * hours * multiplier);
};

const byOrder = (a: EngineComponent, b: EngineComponent) => (a.order ?? 100) - (b.order ?? 100) || a.code.localeCompare(b.code);

const line = (c: EngineComponent, amount: number, employerContribution: boolean): EngineLine => ({
  componentId: c.componentId,
  code: c.code,
  name: c.name,
  type: c.type,
  calculationType: c.calculationType,
  value: c.calculationType === 'SLAB' ? 0 : c.value,
  amount: round2(Math.max(0, amount)),
  employerContribution,
});

export const evaluateSalary = (input: EngineInput): EngineResult => {
  const factor = clampFactor(input.factor);
  const basic = Math.max(0, input.basic);
  const components = [...input.components].filter((c) => c.code !== 'BASIC').sort(byOrder);

  const basicProrates = input.basicComponent?.prorate ?? true;
  const earnedBasic = round2(basic * (basicProrates ? factor : 1));
  const earnings: EngineLine[] = [
    {
      componentId: input.basicComponent?.componentId,
      code: 'BASIC',
      name: input.basicComponent?.name ?? 'Basic Salary',
      type: 'EARNING',
      calculationType: 'FIXED',
      value: basic,
      amount: earnedBasic,
      employerContribution: false,
    },
  ];

  // Phase 2: earnings on full-month bases.
  const regularEarnings = components.filter((c) => c.type === 'EARNING' && !c.employerContribution);
  const fullAmounts = new Map<EngineComponent, number>();
  for (const c of regularEarnings.filter((x) => x.calculationType !== 'PERCENT_OF_GROSS')) {
    let full = 0;
    if (c.calculationType === 'FIXED') full = c.value;
    else if (c.calculationType === 'PERCENT_OF_BASIC') full = (c.value / 100) * capBase(basic, c.baseCap);
    else if (c.calculationType === 'SLAB') full = slabAmount(c.slabs, basic);
    fullAmounts.set(c, capAmount(full, c.maxAmount));
  }
  const fixedGross = basic + [...fullAmounts.values()].reduce((s, v) => s + v, 0);
  for (const c of regularEarnings.filter((x) => x.calculationType === 'PERCENT_OF_GROSS')) {
    fullAmounts.set(c, capAmount((c.value / 100) * capBase(fixedGross, c.baseCap), c.maxAmount));
  }
  for (const c of regularEarnings) {
    const eligible = !(c.eligibilityMaxGross && c.eligibilityMaxGross > 0 && fixedGross > c.eligibilityMaxGross);
    const full = eligible ? (fullAmounts.get(c) ?? 0) : 0;
    earnings.push(line(c, full * (c.prorate === false ? 1 : factor), false));
  }
  for (const x of input.extraEarnings ?? []) {
    if (x.amount > 0) {
      earnings.push({ code: x.code, name: x.name, type: 'EARNING', calculationType: 'EXTRA', value: 0, amount: round2(x.amount), employerContribution: false });
    }
  }
  const gross = sum(earnings);

  // Phase 4: deductions and employer contributions on earned bases.
  const deductions: EngineLine[] = [];
  const employer: EngineLine[] = [];
  for (const c of components.filter((x) => x.type === 'DEDUCTION' || x.employerContribution)) {
    const eligible = !(c.eligibilityMaxGross && c.eligibilityMaxGross > 0 && gross > c.eligibilityMaxGross);
    let amount = 0;
    if (eligible) {
      if (c.calculationType === 'FIXED') amount = c.value * (c.prorate === false ? 1 : factor);
      else if (c.calculationType === 'PERCENT_OF_BASIC') amount = (c.value / 100) * capBase(earnedBasic, c.baseCap);
      else if (c.calculationType === 'PERCENT_OF_GROSS') amount = (c.value / 100) * capBase(gross, c.baseCap);
      else if (c.calculationType === 'SLAB') amount = slabAmount(c.slabs, gross);
      amount = capAmount(amount, c.maxAmount);
    }
    (c.employerContribution ? employer : deductions).push(line(c, amount, !!c.employerContribution));
  }

  const totalDeductions = sum(deductions);
  const totalEmployerContributions = sum(employer);
  return {
    earnings,
    deductions,
    employerContributions: employer,
    gross,
    totalDeductions,
    totalEmployerContributions,
    net: round2(gross - totalDeductions),
    annualCtc: round2(12 * (gross + totalEmployerContributions)),
  };
};
