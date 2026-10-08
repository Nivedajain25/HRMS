import { z } from 'zod';
import {
  USER_STATUS,
  idParam,
  optionalObjectId,
  organizationSettingsSchema,
  organizationUpdateSchema,
  paginationQuery,
  preferencesSchema,
  roleSchema,
  userCreateSchema,
  userUpdateSchema,
} from '@stencil/shared';
import { organizationController as org, roleController as roles, userController as users } from '../controllers/admin.controller';
import { createModule } from './registry';

export const organizationModule = createModule('Organization', '/api/v1/organization');
organizationModule.route({ method: 'get', path: '/', summary: 'Get organization profile' }, org.get);
organizationModule.route(
  { method: 'patch', path: '/', summary: 'Update organization profile', permissions: ['settings:manage'], body: organizationUpdateSchema },
  org.update,
);
organizationModule.route({ method: 'get', path: '/settings', summary: 'Get organization settings' }, org.getSettings);
organizationModule.route(
  { method: 'patch', path: '/settings', summary: 'Update organization settings', permissions: ['settings:manage'], body: organizationSettingsSchema },
  org.updateSettings,
);
organizationModule.route({ method: 'get', path: '/payroll-rule-packs', summary: 'Available payroll rule packs' }, org.countryPacks);
organizationModule.route({ method: 'get', path: '/email-status', summary: 'SMTP configuration status', permissions: ['settings:manage'] }, org.emailStatus);
organizationModule.route({ method: 'post', path: '/test-email', summary: 'Send a test email to yourself', permissions: ['settings:manage'] }, org.testEmail);
organizationModule.route({ method: 'get', path: '/integrations', summary: 'Available integrations and their status', permissions: ['settings:manage'] }, org.integrations);

export const roleModule = createModule('Roles & Permissions', '/api/v1/roles');
roleModule.route({ method: 'get', path: '/permissions', summary: 'Permission catalog grouped by module', anyPermission: ['role:manage', 'user:manage'] }, roles.permissions);
roleModule.route({ method: 'get', path: '/', summary: 'List roles', anyPermission: ['role:manage', 'user:manage'] }, roles.list);
roleModule.route({ method: 'post', path: '/', summary: 'Create a custom role', permissions: ['role:manage'], body: roleSchema }, roles.create);
roleModule.route({ method: 'put', path: '/:id', summary: 'Update a role', permissions: ['role:manage'], params: idParam, body: roleSchema }, roles.update);
roleModule.route({ method: 'delete', path: '/:id', summary: 'Delete a custom role', permissions: ['role:manage'], params: idParam }, roles.remove);

export const userModule = createModule('Users', '/api/v1/users');
userModule.route(
  { method: 'patch', path: '/me/preferences', summary: 'Update own preferences (theme, language)', body: preferencesSchema },
  users.preferences,
);
userModule.route(
  {
    method: 'get',
    path: '/',
    summary: 'List users',
    permissions: ['user:manage'],
    query: paginationQuery.extend({ status: z.enum(USER_STATUS).optional(), roleId: optionalObjectId }),
  },
  users.list,
);
userModule.route({ method: 'post', path: '/', summary: 'Create and invite a user', permissions: ['user:manage'], body: userCreateSchema }, users.create);
userModule.route(
  { method: 'patch', path: '/:id', summary: 'Update user roles/status', permissions: ['user:manage'], params: idParam, body: userUpdateSchema },
  users.update,
);
userModule.route({ method: 'post', path: '/:id/invite', summary: 'Resend invitation', permissions: ['user:manage'], params: idParam }, users.invite);
userModule.route(
  { method: 'delete', path: '/:id', summary: 'Delete a login (Super Admin only); the linked employee record and history are kept', permissions: ['user:manage'], params: idParam },
  users.remove,
);
userModule.route(
  {
    method: 'delete',
    path: '/:id/employee',
    summary: 'Remove the login’s employee record (Super Admin only): the login stays; the record is archived and its reports unassigned',
    permissions: ['user:manage'],
    params: idParam,
  },
  users.removeEmployee,
);
userModule.route({ method: 'post', path: '/:id/invite-link', summary: 'Activation link to hand over directly (not-yet-activated users only)', permissions: ['user:manage'], params: idParam }, users.inviteLink);
