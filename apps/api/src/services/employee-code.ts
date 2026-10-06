import type { ClientSession, Types } from 'mongoose';
import { EmployeeModel, OrganizationModel } from '../models';

/** Next unique employee code, e.g. `EMP0042`, using the organization prefix. */
export const generateEmployeeCode = async (organizationId: Types.ObjectId, session?: ClientSession) => {
  for (let attempt = 0; attempt < 5; attempt++) {
    const org = await OrganizationModel.findByIdAndUpdate(
      organizationId,
      { $inc: { employeeSequence: 1 } },
      { new: true, session },
    )
      .select('employeeIdPrefix employeeSequence')
      .lean();
    if (!org) throw new Error('Organization not found');
    const code = `${org.employeeIdPrefix}${String(org.employeeSequence).padStart(4, '0')}`;
    // Guard against manually-entered codes colliding with the sequence.
    const taken = await EmployeeModel.exists({ organizationId, employeeId: code }).session(session ?? null);
    if (!taken) return code;
  }
  throw new Error('Could not allocate an employee code');
};
