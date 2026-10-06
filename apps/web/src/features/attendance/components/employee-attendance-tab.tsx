import { usePermissions } from '@/store/auth';
import { MonthlyAttendance } from './monthly-attendance';

/** Attendance tab on the employee profile: monthly summary, calendar and records. */
const EmployeeAttendanceTab = ({ employeeId }: { employeeId: string }) => {
  const { user } = usePermissions();
  const isSelf = user?.employeeId === employeeId;
  return <MonthlyAttendance employeeId={employeeId} allowCorrections={isSelf} title="Attendance" />;
};

export default EmployeeAttendanceTab;
