import type { Model, Types } from 'mongoose';
import {
  DepartmentModel,
  DesignationModel,
  DocumentModel,
  EmployeeModel,
  LocationModel,
  ShiftModel,
} from '../models';
import { badRequest } from '../utils/errors';

const REF_MODELS: Record<string, { model: Model<never>; label: string }> = {
  departmentId: { model: DepartmentModel as unknown as Model<never>, label: 'Department' },
  parentId: { model: DepartmentModel as unknown as Model<never>, label: 'Parent department' },
  designationId: { model: DesignationModel as unknown as Model<never>, label: 'Designation' },
  locationId: { model: LocationModel as unknown as Model<never>, label: 'Location' },
  shiftId: { model: ShiftModel as unknown as Model<never>, label: 'Shift' },
  managerId: { model: EmployeeModel as unknown as Model<never>, label: 'Manager' },
  headId: { model: EmployeeModel as unknown as Model<never>, label: 'Department head' },
  employeeId: { model: EmployeeModel as unknown as Model<never>, label: 'Employee' },
  hiringManagerId: { model: EmployeeModel as unknown as Model<never>, label: 'Hiring manager' },
  referredBy: { model: EmployeeModel as unknown as Model<never>, label: 'Referring employee' },
  attachmentId: { model: DocumentModel as unknown as Model<never>, label: 'Attachment' },
  receiptFileId: { model: DocumentModel as unknown as Model<never>, label: 'Receipt' },
  resumeFileId: { model: DocumentModel as unknown as Model<never>, label: 'Resume' },
};

/**
 * Verifies that every referenced id in `input` belongs to the caller's
 * organization (and is not archived). Prevents cross-tenant linking.
 */
export const assertRefsInOrg = async (organizationId: Types.ObjectId, input: Record<string, unknown>, keys?: string[]) => {
  const checks = (keys ?? Object.keys(REF_MODELS))
    .filter((k) => input[k] !== undefined && input[k] !== null && input[k] !== '' && REF_MODELS[k])
    .map(async (k) => {
      const { model, label } = REF_MODELS[k]!;
      const exists = await model.exists({ _id: input[k], organizationId, deletedAt: null } as never);
      if (!exists) throw badRequest(`${label} not found`, 'INVALID_REFERENCE', [{ path: k, message: `${label} not found` }]);
    });
  await Promise.all(checks);
};

/** Same check for an array of ids of one kind. */
export const assertIdsInOrg = async (
  organizationId: Types.ObjectId,
  model: Model<never>,
  ids: (string | Types.ObjectId)[],
  label: string,
) => {
  const unique = [...new Set(ids.map(String))];
  if (!unique.length) return;
  const count = await model.countDocuments({ _id: { $in: unique }, organizationId } as never);
  if (count !== unique.length) throw badRequest(`One or more ${label} were not found`, 'INVALID_REFERENCE');
};
