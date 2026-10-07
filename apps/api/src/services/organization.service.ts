import type { OrganizationSettingsInput, OrganizationUpdateInput } from '@stencil/shared';
import { OrganizationModel } from '../models';
import { COUNTRY_PACKS } from '../payroll/countries';
import type { RequestContext } from '../types/context';
import { isValidTimeZone } from '../utils/dates';
import { badRequest, forbidden, notFound } from '../utils/errors';
import { invalidateAuthCache } from '../middleware/auth';
import { audit, diff } from './audit.service';

export const getOrganization = async (ctx: RequestContext) => {
  const org = await OrganizationModel.findById(ctx.organizationId);
  if (!org) throw notFound('Organization');
  return org.toJSON();
};

/** Organization settings merged with defaults (used by services). */
export const getOrgSettings = async (organizationId: RequestContext['organizationId']) => {
  const org = await OrganizationModel.findById(organizationId).lean({ virtuals: false });
  if (!org) throw notFound('Organization');
  return org;
};

export const updateOrganization = async (ctx: RequestContext, input: OrganizationUpdateInput) => {
  if (input.timezone && !isValidTimeZone(input.timezone)) throw badRequest('Unknown timezone', 'INVALID_TIMEZONE');
  const org = await OrganizationModel.findById(ctx.organizationId);
  if (!org) throw notFound('Organization');
  const before = org.toObject() as unknown as Record<string, unknown>;
  org.set(input);
  await org.save();
  invalidateAuthCache();
  const changes = diff(before, input as Record<string, unknown>);
  await audit(ctx, { action: 'ORGANIZATION_UPDATED', module: 'organization', recordId: org._id, recordLabel: org.name, ...changes });
  return org.toJSON();
};

export const updateSettings = async (ctx: RequestContext, input: OrganizationSettingsInput) => {
  const org = await OrganizationModel.findById(ctx.organizationId);
  if (!org) throw notFound('Organization');
  if (input.payroll?.countryRules && !COUNTRY_PACKS[input.payroll.countryRules]) {
    throw badRequest('Unknown payroll rule pack', 'INVALID_COUNTRY_RULES');
  }
  // Breaks on / off is the Super Admin's call; others may still save the section with it unchanged.
  const allowBreaks = input.attendance?.allowBreaks;
  if (allowBreaks !== undefined && allowBreaks !== (org.settings?.attendance?.allowBreaks ?? false) && !ctx.roleKeys.includes('super_admin')) {
    throw forbidden('Only the Super Admin can turn breaks on or off', 'SUPER_ADMIN_ONLY');
  }
  const before = JSON.parse(JSON.stringify(org.settings ?? {})) as Record<string, unknown>;
  // Section-level merge so partial updates don't wipe sibling settings.
  for (const [section, values] of Object.entries(input)) {
    if (values === undefined) continue;
    if (Array.isArray(values)) org.set(`settings.${section}`, values);
    else for (const [k, v] of Object.entries(values)) if (v !== undefined) org.set(`settings.${section}.${k}`, v);
  }
  await org.save();
  const after = JSON.parse(JSON.stringify(org.settings)) as Record<string, unknown>;
  await audit(ctx, { action: 'ORGANIZATION_UPDATED', module: 'settings', recordId: org._id, ...diff(before, after) });
  return org.settings;
};

export const listCountryPacks = () =>
  Object.values(COUNTRY_PACKS).map((p) => ({ code: p.code, name: p.name, disclaimer: p.disclaimer }));
