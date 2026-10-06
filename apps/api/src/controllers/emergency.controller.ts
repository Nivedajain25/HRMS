import type { EmergencyStatus, EmergencyRaiseInput } from '@stencil/shared';
import { body, query } from '../middleware/validate';
import * as emergencies from '../services/emergency.service';
import { handle, handleCreated, handlePaged, idOf } from '../utils/controller';

type ListQuery = { status?: EmergencyStatus; scope?: 'mine' | 'all'; page: number; limit: number };
type UpdateBody = { status: 'ACKNOWLEDGED' | 'RESOLVED'; note?: string };

export const emergencyController = {
  raise: handleCreated(
    (ctx, req) => emergencies.raiseEmergency(ctx, body<Parameters<typeof emergencies.raiseEmergency>[1] & EmergencyRaiseInput>(req)),
    'HR has been alerted',
  ),
  list: handlePaged((ctx, req) => emergencies.listEmergencies(ctx, query<ListQuery>(req))),
  active: handle((ctx) => emergencies.activeEmergencies(ctx)),
  get: handle((ctx, req) => emergencies.getEmergency(ctx, idOf(req))),
  update: handle((ctx, req) => emergencies.updateEmergency(ctx, idOf(req), body<UpdateBody>(req)), 'Emergency updated'),
  decide: handle((ctx, req) => emergencies.decideEmergency(ctx, idOf(req), body<{ decision: 'APPROVED' | 'DECLINED'; note?: string }>(req)), 'Decision sent'),
};
