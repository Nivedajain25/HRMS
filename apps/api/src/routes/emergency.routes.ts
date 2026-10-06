import { emergencyDecisionSchema, emergencyListQuery, emergencyRaiseSchema, emergencyUpdateSchema, idParam } from '@stencil/shared';
import { emergencyController as em } from '../controllers/emergency.controller';
import { createModule } from './registry';

export const emergencyModule = createModule('Emergencies', '/api/v1/emergencies');
emergencyModule.route(
  {
    method: 'post',
    path: '/',
    summary: 'Raise an emergency (any employee)',
    description:
      'Alerts every user with `emergency:manage` (HR) and the employee’s manager immediately: in-app, email and mobile push, regardless of notification preferences. One active alert per employee (409 `EMERGENCY_ALREADY_OPEN`).',
    body: emergencyRaiseSchema,
  },
  em.raise,
);
emergencyModule.route({ method: 'get', path: '/', summary: 'List emergencies (HR: all; others: their own)', query: emergencyListQuery }, em.list);
// Registered before '/:id' so "active" is not taken for an id.
emergencyModule.route(
  { method: 'get', path: '/active', summary: 'Unresolved emergencies (HR alert banner)', permissions: ['emergency:manage'] },
  em.active,
);
emergencyModule.route({ method: 'get', path: '/:id', summary: 'Get an emergency (HR or the employee who raised it)', params: idParam }, em.get);
emergencyModule.route(
  {
    method: 'patch',
    path: '/:id',
    summary: 'Acknowledge or resolve an emergency',
    description: 'The employee is notified when the status changes. An optional note is appended to the timeline.',
    permissions: ['emergency:manage'],
    params: idParam,
    body: emergencyUpdateSchema,
  },
  em.update,
);
emergencyModule.route(
  {
    method: 'post',
    path: '/:id/decision',
    summary: 'Approve or decline the request to leave',
    description:
      'Closes the alert and notifies the employee at once (push, in-app, email). Approving also notes it on their attendance for today.',
    permissions: ['emergency:manage'],
    params: idParam,
    body: emergencyDecisionSchema,
  },
  em.decide,
);
