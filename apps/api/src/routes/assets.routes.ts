import { z } from 'zod';
import {
  ASSET_CATEGORIES,
  ASSET_STATUS,
  assetAssignSchema,
  assetReturnSchema,
  assetSchema,
  assetStatusSchema,
  assetUpdateSchema,
  idParam,
  optionalObjectId,
  paginationQuery,
} from '@stencil/shared';
import { assetController as assets } from '../controllers/operations.controller';
import { createModule } from './registry';

const scope = z.enum(['me', 'team', 'all']).optional();

export const assetModule = createModule('Assets', '/api/v1/assets');
assetModule.route(
  {
    method: 'get',
    path: '/',
    summary: 'List assets (asset:read → all; otherwise assets assigned to me/my team)',
    query: paginationQuery.extend({
      scope,
      status: z.enum(ASSET_STATUS).optional(),
      category: z.enum(ASSET_CATEGORIES).optional(),
      locationId: optionalObjectId,
    }),
  },
  assets.list,
);
assetModule.route({ method: 'get', path: '/mine', summary: 'Assets currently assigned to me' }, assets.mine);
assetModule.route({ method: 'get', path: '/summary', summary: 'Counts by status/category and total value', permissions: ['asset:read'] }, assets.summary);
assetModule.route(
  {
    method: 'get',
    path: '/assignments',
    summary: 'Assignment history (scoped)',
    query: paginationQuery.extend({
      scope,
      employeeId: optionalObjectId,
      assetId: optionalObjectId,
      status: z.enum(['ACTIVE', 'RETURNED']).optional(),
    }),
  },
  assets.assignments,
);
assetModule.route({ method: 'get', path: '/:id', summary: 'Asset with assignment and status history', params: idParam }, assets.get);
assetModule.route({ method: 'post', path: '/', summary: 'Create an asset (tag auto-generated if omitted)', permissions: ['asset:create'], body: assetSchema }, assets.create);
assetModule.route(
  { method: 'patch', path: '/:id', summary: 'Update asset details', permissions: ['asset:create'], params: idParam, body: assetUpdateSchema },
  assets.update,
);
assetModule.route(
  { method: 'post', path: '/:id/assign', summary: 'Assign an available asset to an employee', permissions: ['asset:assign'], params: idParam, body: assetAssignSchema },
  assets.assign,
);
assetModule.route(
  { method: 'post', path: '/:id/return', summary: 'Record the return of an assigned asset (DAMAGED → repair)', permissions: ['asset:return'], params: idParam, body: assetReturnSchema },
  assets.return,
);
assetModule.route(
  { method: 'post', path: '/:id/status', summary: 'Move an asset to available / repair / retired', permissions: ['asset:return'], params: idParam, body: assetStatusSchema },
  assets.status,
);
assetModule.route(
  { method: 'delete', path: '/:id', summary: 'Delete an available or retired asset (soft)', permissions: ['asset:create'], params: idParam },
  assets.remove,
);
