import type { OrganizationSettingsInput, OrganizationUpdateInput, PaginationQuery, RoleInput, UserCreateInput, UserUpdateInput } from '@stencil/shared';
import { listIntegrations } from '../integrations';
import { body, query } from '../middleware/validate';
import { sendEmail, verifyEmailTransport } from '../services/email.service';
import * as org from '../services/organization.service';
import * as rbac from '../services/rbac.service';
import { handle, handleCreated, handlePaged, idOf } from '../utils/controller';

export const organizationController = {
  get: handle((ctx) => org.getOrganization(ctx)),
  update: handle((ctx, req) => org.updateOrganization(ctx, body<OrganizationUpdateInput>(req)), 'Organization updated'),
  getSettings: handle(async (ctx) => (await org.getOrganization(ctx)).settings),
  updateSettings: handle((ctx, req) => org.updateSettings(ctx, body<OrganizationSettingsInput>(req)), 'Settings saved'),
  countryPacks: handle(async () => org.listCountryPacks()),
  emailStatus: handle(async () => verifyEmailTransport()),
  testEmail: handle(async (ctx) => {
    await sendEmail(ctx.email, 'notification', { name: ctx.userName, title: 'Stencil test email', message: 'Your email settings are working.' }, ctx.organizationId);
    return { sentTo: ctx.email };
  }, 'Test email queued'),
  integrations: handle(async () => listIntegrations()),
};

export const roleController = {
  permissions: handle(() => rbac.listPermissionCatalog()),
  list: handle((ctx) => rbac.listRoles(ctx)),
  create: handleCreated((ctx, req) => rbac.createRole(ctx, body<RoleInput>(req)), 'Role created'),
  update: handle((ctx, req) => rbac.updateRole(ctx, idOf(req), body<RoleInput>(req)), 'Role updated'),
  remove: handle((ctx, req) => rbac.deleteRole(ctx, idOf(req)), 'Role deleted'),
};

export const userController = {
  list: handlePaged((ctx, req) => rbac.listUsers(ctx, query<PaginationQuery & { status?: string; roleId?: string }>(req))),
  create: handleCreated((ctx, req) => rbac.createUser(ctx, body<UserCreateInput>(req)), 'User created and invited'),
  update: handle((ctx, req) => rbac.updateUser(ctx, idOf(req), body<UserUpdateInput>(req)), 'User updated'),
  invite: handle((ctx, req) => rbac.inviteUser(ctx, idOf(req)), 'Invitation sent'),
  remove: handle((ctx, req) => rbac.deleteUser(ctx, idOf(req)), 'User deleted'),
  inviteLink: handle((ctx, req) => rbac.inviteLink(ctx, idOf(req))),
  preferences: handle((ctx, req) => rbac.updatePreferences(ctx, body<{ theme?: string; language?: string }>(req)), 'Preferences saved'),
};
