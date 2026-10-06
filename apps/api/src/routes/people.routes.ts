import { z } from 'zod';
import {
  ENTITY_STATUS,
  LOCATION_TYPES,
  TASK_STATUS,
  departmentSchema,
  designationSchema,
  employeeCreateSchema,
  employeeListQuery,
  employeeUpdateSchema,
  idParam,
  locationSchema,
  objectId,
  onboardingStartSchema,
  onboardingTemplateSchema,
  optionalObjectId,
  paginationQuery,
  patchSchema,
  selfProfileUpdateSchema,
  taskStatusSchema,
} from '@stencil/shared';
import {
  departmentController as dept,
  designationController as desig,
  employeeController as emp,
  locationController as loc,
  onboardingController as onb,
} from '../controllers/people.controller';
import { createModule } from './registry';

const statusQuery = paginationQuery.extend({ status: z.enum(ENTITY_STATUS).optional() });

export const departmentModule = createModule('Departments', '/api/v1/departments');
departmentModule.route({ method: 'get', path: '/', summary: 'List departments with employee counts', query: statusQuery }, dept.list);
departmentModule.route({ method: 'get', path: '/all', summary: 'All active departments (for pickers)' }, dept.all);
departmentModule.route({ method: 'get', path: '/tree', summary: 'Department hierarchy' }, dept.tree);
departmentModule.route({ method: 'get', path: '/:id', summary: 'Get a department', params: idParam }, dept.get);
departmentModule.route({ method: 'post', path: '/', summary: 'Create a department', permissions: ['department:manage'], body: departmentSchema }, dept.create);
departmentModule.route({ method: 'patch', path: '/:id', summary: 'Update a department', permissions: ['department:manage'], params: idParam, body: patchSchema(departmentSchema) }, dept.update);
departmentModule.route({ method: 'delete', path: '/:id', summary: 'Archive a department', permissions: ['department:manage'], params: idParam }, dept.remove);

export const designationModule = createModule('Designations', '/api/v1/designations');
designationModule.route({ method: 'get', path: '/', summary: 'List designations', query: statusQuery.extend({ departmentId: optionalObjectId }) }, desig.list);
designationModule.route({ method: 'get', path: '/all', summary: 'All active designations' }, desig.all);
designationModule.route({ method: 'get', path: '/:id', summary: 'Get a designation', params: idParam }, desig.get);
designationModule.route({ method: 'post', path: '/', summary: 'Create a designation', permissions: ['designation:manage'], body: designationSchema }, desig.create);
designationModule.route({ method: 'patch', path: '/:id', summary: 'Update a designation', permissions: ['designation:manage'], params: idParam, body: patchSchema(designationSchema) }, desig.update);
designationModule.route({ method: 'delete', path: '/:id', summary: 'Archive a designation', permissions: ['designation:manage'], params: idParam }, desig.remove);

export const locationModule = createModule('Locations', '/api/v1/locations');
locationModule.route({ method: 'get', path: '/', summary: 'List locations', query: statusQuery.extend({ type: z.enum(LOCATION_TYPES).optional() }) }, loc.list);
locationModule.route({ method: 'get', path: '/all', summary: 'All active locations' }, loc.all);
locationModule.route({ method: 'get', path: '/:id', summary: 'Get a location', params: idParam }, loc.get);
locationModule.route({ method: 'post', path: '/', summary: 'Create a location', permissions: ['location:manage'], body: locationSchema }, loc.create);
locationModule.route({ method: 'patch', path: '/:id', summary: 'Update a location', permissions: ['location:manage'], params: idParam, body: patchSchema(locationSchema) }, loc.update);
locationModule.route({ method: 'delete', path: '/:id', summary: 'Archive a location', permissions: ['location:manage'], params: idParam }, loc.remove);

export const employeeModule = createModule('Employees', '/api/v1/employees');
employeeModule.route(
  {
    method: 'get',
    path: '/',
    summary: 'List employees (scoped: all / team / self)',
    description: 'Supports `search`, `department` (id or code), `designation`, `location`, `manager`, `status`, `employmentType`, `sortBy`, `sortOrder`, `scope`.',
    query: paginationQuery.extend(employeeListQuery.shape).extend({ scope: z.enum(['me', 'team', 'all']).optional() }),
  },
  emp.list,
);
employeeModule.route(
  {
    method: 'get',
    path: '/directory',
    summary: 'People directory (minimal fields) for pickers',
    query: z.object({ search: z.string().max(100).optional(), limit: z.coerce.number().int().min(1).max(200).optional(), includeExited: z.coerce.boolean().optional() }),
  },
  emp.directory,
);
employeeModule.route({ method: 'get', path: '/me', summary: 'My employee profile' }, emp.me);
employeeModule.route({ method: 'patch', path: '/me', summary: 'Update my contact details', body: selfProfileUpdateSchema }, emp.updateMe);
employeeModule.route({ method: 'get', path: '/team', summary: 'My direct reports' }, emp.team);
employeeModule.route({ method: 'get', path: '/teammates', summary: 'My manager and the colleagues who share them' }, emp.teammates);
employeeModule.route({ method: 'get', path: '/org-chart', summary: 'Organization chart' }, emp.orgChart);
employeeModule.route({ method: 'get', path: '/:id', summary: 'Get an employee (IDOR-protected)', params: idParam }, emp.get);
employeeModule.route({ method: 'get', path: '/:id/history', summary: 'Employment change history', params: idParam }, emp.history);
employeeModule.route({ method: 'post', path: '/', summary: 'Create an employee (+ user account, onboarding, leave balances)', permissions: ['employee:create'], body: employeeCreateSchema }, emp.create);
employeeModule.route({ method: 'patch', path: '/:id', summary: 'Update an employee (tracked history)', permissions: ['employee:update'], params: idParam, body: employeeUpdateSchema }, emp.update);
employeeModule.route({ method: 'delete', path: '/:id', summary: 'Archive an employee', permissions: ['employee:delete'], params: idParam }, emp.archive);

export const onboardingModule = createModule('Onboarding', '/api/v1/onboarding');
onboardingModule.route({ method: 'get', path: '/templates', summary: 'List onboarding templates', permissions: ['onboarding:manage'], query: paginationQuery }, onb.templates);
onboardingModule.route({ method: 'get', path: '/templates/all', summary: 'All onboarding templates', anyPermission: ['onboarding:manage', 'employee:create', 'recruitment:update'] }, onb.allTemplates);
onboardingModule.route({ method: 'get', path: '/templates/:id', summary: 'Get template', permissions: ['onboarding:manage'], params: idParam }, onb.getTemplate);
onboardingModule.route({ method: 'post', path: '/templates', summary: 'Create template', permissions: ['onboarding:manage'], body: onboardingTemplateSchema }, onb.createTemplate);
onboardingModule.route({ method: 'patch', path: '/templates/:id', summary: 'Update template', permissions: ['onboarding:manage'], params: idParam, body: patchSchema(onboardingTemplateSchema) }, onb.updateTemplate);
onboardingModule.route({ method: 'delete', path: '/templates/:id', summary: 'Archive template', permissions: ['onboarding:manage'], params: idParam }, onb.removeTemplate);
onboardingModule.route({ method: 'get', path: '/', summary: 'List onboardings (scoped)', query: paginationQuery.extend({ status: z.enum(TASK_STATUS).optional() }) }, onb.list);
onboardingModule.route({ method: 'post', path: '/', summary: 'Start onboarding for an employee', permissions: ['onboarding:manage'], body: onboardingStartSchema }, onb.start);
onboardingModule.route({ method: 'get', path: '/:id', summary: 'Get onboarding checklist', params: idParam }, onb.get);
onboardingModule.route(
  { method: 'patch', path: '/:id/tasks/:taskId', summary: 'Update a checklist task', params: z.object({ id: objectId, taskId: objectId }), body: taskStatusSchema },
  onb.updateTask,
);
