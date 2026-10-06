import { body, query } from '../middleware/validate';
import * as complaints from '../services/complaint.service';
import { handle, handleCreated, idOf } from '../utils/controller';

export const complaintController = {
  list: handle((ctx, req) => complaints.listComplaints(ctx, query<Parameters<typeof complaints.listComplaints>[1]>(req))),
  get: handle((ctx, req) => complaints.getComplaint(ctx, idOf(req))),
  create: handleCreated((ctx, req) => complaints.createComplaint(ctx, body<Parameters<typeof complaints.createComplaint>[1]>(req)), 'Complaint submitted'),
  reply: handle((ctx, req) => complaints.replyToComplaint(ctx, idOf(req), body<{ message: string }>(req)), 'Reply sent'),
  status: handle((ctx, req) => complaints.setComplaintStatus(ctx, idOf(req), body<Parameters<typeof complaints.setComplaintStatus>[2]>(req)), 'Status updated'),
};
