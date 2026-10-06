import { complaintListQuery, complaintReplySchema, complaintSchema, complaintStatusSchema, idParam } from '@stencil/shared';
import { complaintController as c } from '../controllers/complaint.controller';
import { createModule } from './registry';

/** Complaints: anyone raises and follows their own; HR / admin (employee:update) see all, reply and resolve. */
export const complaintModule = createModule('Complaints', '/api/v1/complaints');
complaintModule.route({ method: 'get', path: '/', summary: 'My complaints (or all with scope=all, HR / admin)', query: complaintListQuery }, c.list);
complaintModule.route({ method: 'post', path: '/', summary: 'Raise a complaint', body: complaintSchema }, c.create);
complaintModule.route({ method: 'get', path: '/:id', summary: 'A complaint with its replies', params: idParam }, c.get);
complaintModule.route({ method: 'post', path: '/:id/replies', summary: 'Reply on a complaint', params: idParam, body: complaintReplySchema }, c.reply);
complaintModule.route({ method: 'patch', path: '/:id/status', summary: 'Change the status (HR / admin)', params: idParam, body: complaintStatusSchema }, c.status);
