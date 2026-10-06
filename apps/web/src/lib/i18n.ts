import { humanize } from '@stencil/shared';

/**
 * Minimal translation layer. UI strings that are reused go through `t()` so a
 * future locale only needs another dictionary; enum labels go through
 * `label()` which falls back to a humanized value.
 */
const en = {
  'app.name': 'Stencil HRMS',
  'common.save': 'Save',
  'common.saveChanges': 'Save changes',
  'common.cancel': 'Cancel',
  'common.create': 'Create',
  'common.edit': 'Edit',
  'common.delete': 'Delete',
  'common.archive': 'Archive',
  'common.approve': 'Approve',
  'common.reject': 'Reject',
  'common.submit': 'Submit',
  'common.close': 'Close',
  'common.search': 'Search',
  'common.filters': 'Filters',
  'common.clear': 'Clear',
  'common.retry': 'Try again',
  'common.loading': 'Loading…',
  'common.noResults': 'No results found',
  'common.actions': 'Actions',
  'common.status': 'Status',
  'common.export': 'Export',
  'common.download': 'Download',
  'common.view': 'View',
  'common.back': 'Back',
  'common.confirm': 'Confirm',
  'errors.generic': 'Something went wrong. Please try again.',
  'errors.forbidden': 'You do not have access to this page.',
  'errors.notFound': 'The page you are looking for does not exist.',
} as const;

export type MessageKey = keyof typeof en;
const dictionaries: Record<string, Record<string, string>> = { en };
let locale = 'en';

export const setLocale = (next: string) => {
  if (dictionaries[next]) locale = next;
};

export const t = (key: MessageKey, vars?: Record<string, string | number>) => {
  let text = dictionaries[locale]?.[key] ?? en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) text = text.replace(`{${k}}`, String(v));
  return text;
};

const enumLabels: Record<string, string> = {};
export const label = (value: string | null | undefined) => (value ? (enumLabels[value] ?? humanize(value)) : '');
