const OVERRIDES: Record<string, string> = {
  WORK_FROM_HOME: 'Work from home',
  HR: 'HR',
  IT: 'IT',
  PERCENT_OF_BASIC: '% of Basic',
  PERCENT_OF_GROSS: '% of Gross',
  CAREERS_PAGE: 'Careers page',
  LINKEDIN: 'LinkedIn',
  OKR: 'OKR',
  KPI: 'KPI',
  FULL_TIME: 'Full-time',
  PART_TIME: 'Part-time',
};

/** Turns an enum value like `PENDING_APPROVAL` into `Pending approval`. */
export const humanize = (value: string | null | undefined): string => {
  if (!value) return '';
  if (OVERRIDES[value]) return OVERRIDES[value];
  const text = value.replace(/[_:]+/g, ' ').toLowerCase().trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
};
