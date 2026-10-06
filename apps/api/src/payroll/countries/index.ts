import type { SalaryComponentInput } from '@stencil/shared';

/**
 * Country packs provide *default, editable* salary component templates.
 * They are starting points only — Stencil does not claim statutory compliance;
 * every rate, cap and slab is configurable per organization and must be
 * reviewed by a qualified payroll professional.
 */
export interface CountryPack {
  code: string;
  name: string;
  disclaimer: string;
  components: SalaryComponentInput[];
}

const COMMON_EARNINGS: SalaryComponentInput[] = [
  { name: 'House Rent Allowance', code: 'HRA', type: 'EARNING', calculationType: 'PERCENT_OF_BASIC', defaultValue: 40, order: 20 },
  { name: 'Transport Allowance', code: 'TRANSPORT', type: 'EARNING', calculationType: 'FIXED', defaultValue: 1600, order: 30 },
  { name: 'Medical Allowance', code: 'MEDICAL', type: 'EARNING', calculationType: 'FIXED', defaultValue: 1250, order: 40 },
  { name: 'Special Allowance', code: 'SPECIAL', type: 'EARNING', calculationType: 'FIXED', defaultValue: 0, order: 50 },
  { name: 'Bonus', code: 'BONUS', type: 'EARNING', calculationType: 'FIXED', defaultValue: 0, prorate: false, order: 60 },
  { name: 'Other Earnings', code: 'OTHER_EARN', type: 'EARNING', calculationType: 'FIXED', defaultValue: 0, order: 70 },
];

export const GENERIC_PACK: CountryPack = {
  code: 'GENERIC',
  name: 'Generic (no statutory rules)',
  disclaimer: 'No statutory deductions are pre-configured. Add components that match your jurisdiction.',
  components: [
    ...COMMON_EARNINGS,
    { name: 'Income Tax (TDS)', code: 'TDS', type: 'DEDUCTION', calculationType: 'FIXED', defaultValue: 0, prorate: false, order: 210 },
    { name: 'Other Deductions', code: 'OTHER_DED', type: 'DEDUCTION', calculationType: 'FIXED', defaultValue: 0, prorate: false, order: 290 },
  ],
};

export const INDIA_PACK: CountryPack = {
  code: 'IN',
  name: 'India (template)',
  disclaimer:
    'Template values for PF, ESI and Professional Tax reflect commonly used defaults and vary by state and over time. Verify with your payroll advisor before use.',
  components: [
    ...COMMON_EARNINGS,
    {
      name: 'Provident Fund (Employee)',
      code: 'PF',
      type: 'DEDUCTION',
      calculationType: 'PERCENT_OF_BASIC',
      defaultValue: 12,
      baseCap: 15000,
      isStatutory: true,
      order: 200,
    },
    {
      name: 'Provident Fund (Employer)',
      code: 'PF_ER',
      type: 'DEDUCTION',
      calculationType: 'PERCENT_OF_BASIC',
      defaultValue: 12,
      baseCap: 15000,
      isStatutory: true,
      employerContribution: true,
      order: 201,
    },
    {
      name: 'ESI (Employee)',
      code: 'ESI',
      type: 'DEDUCTION',
      calculationType: 'PERCENT_OF_GROSS',
      defaultValue: 0.75,
      eligibilityMaxGross: 21000,
      isStatutory: true,
      order: 202,
    },
    {
      name: 'Professional Tax',
      code: 'PT',
      type: 'DEDUCTION',
      calculationType: 'SLAB',
      defaultValue: 0,
      prorate: false,
      isStatutory: true,
      slabs: [
        { from: 0, to: 15000, amount: 0 },
        { from: 15000, to: 20000, amount: 150 },
        { from: 20000, to: null, amount: 200 },
      ],
      order: 203,
    },
    { name: 'Income Tax (TDS)', code: 'TDS', type: 'DEDUCTION', calculationType: 'FIXED', defaultValue: 0, prorate: false, order: 210 },
    { name: 'Other Deductions', code: 'OTHER_DED', type: 'DEDUCTION', calculationType: 'FIXED', defaultValue: 0, prorate: false, order: 290 },
  ],
};

export const COUNTRY_PACKS: Record<string, CountryPack> = {
  GENERIC: GENERIC_PACK,
  IN: INDIA_PACK,
};

export const packForCountry = (country?: string | null): CountryPack => {
  const c = (country ?? '').trim().toLowerCase();
  if (c === 'in' || c === 'india') return INDIA_PACK;
  return GENERIC_PACK;
};
