import { z } from 'zod';
import {
  EXIT_TYPES,
  OFFBOARDING_STATUS,
  idParam,
  offboardingAdvanceSchema,
  offboardingCancelSchema,
  offboardingCreateSchema,
  optionalObjectId,
  paginationQuery,
} from '@stencil/shared';
import { offboardingController as offboarding } from '../controllers/operations.controller';
import { createModule } from './registry';

export const offboardingModule = createModule('Offboarding', '/api/v1/offboarding');
offboardingModule.route(
  {
    method: 'get',
    path: '/',
    summary: 'List offboardings (offboarding:manage → all; managers → team; employees → own)',
    query: paginationQuery.extend({
      scope: z.enum(['me', 'team', 'all']).optional(),
      status: z.enum([...OFFBOARDING_STATUS, 'ACTIVE']).optional(),
      exitType: z.enum(EXIT_TYPES).optional(),
      employeeId: optionalObjectId,
    }),
  },
  offboarding.list,
);
offboardingModule.route(
  {
    method: 'post',
    path: '/',
    summary: 'Start offboarding (offboarding:manage) or submit own resignation',
    body: offboardingCreateSchema,
  },
  offboarding.create,
);
offboardingModule.route(
  { method: 'get', path: '/:id', summary: 'Offboarding with employee, assigned assets and timeline', params: idParam },
  offboarding.get,
);
offboardingModule.route(
  {
    method: 'post',
    path: '/:id/advance',
    summary: 'Advance to the next step (asset return, clearance and final payroll gates apply)',
    permissions: ['offboarding:manage'],
    params: idParam,
    body: offboardingAdvanceSchema,
  },
  offboarding.advance,
);
offboardingModule.route(
  {
    method: 'post',
    path: '/:id/cancel',
    summary: 'Cancel before the asset return step (restores employment status)',
    params: idParam,
    body: offboardingCancelSchema,
  },
  offboarding.cancel,
);
