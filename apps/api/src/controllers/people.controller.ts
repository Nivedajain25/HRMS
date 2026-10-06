import type { Request } from 'express';
import type { EmployeeCreateInput, PaginationQuery } from '@stencil/shared';
import type { Pagination } from '@stencil/types';
import type { RequestContext } from '../types/context';
import { body, query } from '../middleware/validate';
import * as employees from '../services/employee.service';
import * as onboarding from '../services/onboarding.service';
import { departments, designations, locations } from '../services/org-structure.service';
import { handle, handleCreated, handlePaged, idOf } from '../utils/controller';

type Q = PaginationQuery & Record<string, string | undefined>;
const q = (req: Request) => query<Q>(req);
const b = (req: Request) => body<Record<string, unknown>>(req);

interface MasterDataService {
  list: (ctx: RequestContext, q: Q) => Promise<{ items: unknown[]; pagination: Pagination }>;
  all: (ctx: RequestContext, extra: Record<string, unknown>) => Promise<unknown>;
  get: (ctx: RequestContext, id: string) => Promise<unknown>;
  create: (ctx: RequestContext, input: Record<string, unknown>) => Promise<unknown>;
  update: (ctx: RequestContext, id: string, input: Record<string, unknown>) => Promise<unknown>;
  remove: (ctx: RequestContext, id: string) => Promise<void>;
}

const masterData = (svc: MasterDataService, label: string) => ({
  list: handlePaged((ctx, req) => svc.list(ctx, q(req))),
  all: handle((ctx) => svc.all(ctx, { status: 'ACTIVE' })),
  get: handle((ctx, req) => svc.get(ctx, idOf(req))),
  create: handleCreated((ctx, req) => svc.create(ctx, b(req)), `${label} created`),
  update: handle((ctx, req) => svc.update(ctx, idOf(req), b(req)), `${label} updated`),
  remove: handle((ctx, req) => svc.remove(ctx, idOf(req)), `${label} archived`),
});

export const departmentController = { ...masterData(departments, 'Department'), tree: handle((ctx) => departments.tree(ctx)) };
export const designationController = masterData(designations, 'Designation');
export const locationController = masterData(locations, 'Location');

export const employeeController = {
  list: handlePaged((ctx, req) => employees.listEmployees(ctx, q(req))),
  directory: handle((ctx, req) => employees.directory(ctx, query<{ search?: string; limit?: number; includeExited?: boolean }>(req))),
  get: handle((ctx, req) => employees.getEmployee(ctx, idOf(req))),
  me: handle(async (ctx) => (ctx.employeeId ? employees.getEmployee(ctx, String(ctx.employeeId)) : null)),
  updateMe: handle((ctx, req) => employees.updateOwnProfile(ctx, body(req)), 'Profile updated'),
  team: handle((ctx) => employees.getTeam(ctx)),
  teammates: handle((ctx) => employees.getTeammates(ctx)),
  orgChart: handle((ctx) => employees.orgChart(ctx)),
  history: handle((ctx, req) => employees.getHistory(ctx, idOf(req))),
  create: handleCreated((ctx, req) => employees.createEmployee(ctx, body<EmployeeCreateInput>(req)), 'Employee created'),
  update: handle((ctx, req) => employees.updateEmployee(ctx, idOf(req), body(req)), 'Employee updated'),
  archive: handle((ctx, req) => employees.archiveEmployee(ctx, idOf(req)), 'Employee archived'),
};

export const onboardingController = {
  templates: handlePaged((ctx, req) => onboarding.onboardingTemplates.list(ctx, q(req))),
  allTemplates: handle((ctx) => onboarding.onboardingTemplates.all(ctx)),
  getTemplate: handle((ctx, req) => onboarding.onboardingTemplates.get(ctx, idOf(req))),
  createTemplate: handleCreated((ctx, req) => onboarding.onboardingTemplates.create(ctx, b(req)), 'Template created'),
  updateTemplate: handle((ctx, req) => onboarding.onboardingTemplates.update(ctx, idOf(req), b(req)), 'Template updated'),
  removeTemplate: handle((ctx, req) => onboarding.onboardingTemplates.remove(ctx, idOf(req)), 'Template archived'),
  list: handlePaged((ctx, req) => onboarding.listOnboardings(ctx, q(req))),
  get: handle((ctx, req) => onboarding.getOnboarding(ctx, idOf(req))),
  start: handleCreated((ctx, req) => onboarding.startOnboarding(ctx, body(req)), 'Onboarding started'),
  updateTask: handle(
    (ctx, req) => onboarding.updateOnboardingTask(ctx, idOf(req), idOf(req, 'taskId'), body(req)),
    'Task updated',
  ),
};
