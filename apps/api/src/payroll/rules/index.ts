import type { EngineResult } from '../core/engine';

/**
 * Extension points for jurisdiction-specific payroll logic (income tax
 * projections, statutory rounding, state-wise slabs...).
 *
 * No rules are registered by default: Stencil only ships editable component
 * templates (see `payroll/countries`) and makes no statutory-compliance claims.
 * A rule receives the computed payslip and may return an adjusted copy.
 */
export interface PayrollRuleContext {
  countryRules: string;
  organizationId: string;
  employeeId: string;
  month: number;
  year: number;
  currency: string;
}

export interface PayrollRule {
  /** Unique rule key, e.g. `IN.PT_ROUNDING`. */
  key: string;
  /** Country pack code(s) this rule applies to (`*` = all). */
  countries: string[];
  description: string;
  /** Post-processing hook on the computed result. Must be pure. */
  afterCompute?: (ctx: PayrollRuleContext, result: EngineResult) => EngineResult;
}

const registry = new Map<string, PayrollRule>();

export const registerPayrollRule = (rule: PayrollRule) => {
  registry.set(rule.key, rule);
};

export const rulesFor = (countryRules: string) =>
  [...registry.values()].filter((r) => r.countries.includes('*') || r.countries.includes(countryRules));

/** Applies every registered rule for the organization's country pack, in registration order. */
export const applyPayrollRules = (ctx: PayrollRuleContext, result: EngineResult): EngineResult =>
  rulesFor(ctx.countryRules).reduce((acc, rule) => (rule.afterCompute ? rule.afterCompute(ctx, acc) : acc), result);
