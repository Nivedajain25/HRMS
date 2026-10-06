const values = <T extends readonly string[]>(...v: T) => v;

export const ORGANIZATION_STATUS = values('ACTIVE', 'SUSPENDED');
export const USER_STATUS = values('ACTIVE', 'INACTIVE', 'SUSPENDED');
export type UserStatus = (typeof USER_STATUS)[number];

export const WEEKDAYS = values('SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT');
export type Weekday = (typeof WEEKDAYS)[number];

export const GENDERS = values('MALE', 'FEMALE', 'NON_BINARY', 'UNDISCLOSED');
export const BLOOD_GROUPS = values('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-');
export const EMPLOYMENT_TYPES = values('FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'CONSULTANT');
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
export const EMPLOYMENT_STATUS = values(
  'ACTIVE',
  'PROBATION',
  'NOTICE_PERIOD',
  'ON_LEAVE',
  'EXITED',
  'ARCHIVED',
);
export type EmploymentStatus = (typeof EMPLOYMENT_STATUS)[number];

export const ENTITY_STATUS = values('ACTIVE', 'INACTIVE', 'ARCHIVED');
export const LOCATION_TYPES = values('OFFICE', 'BRANCH', 'REMOTE', 'HYBRID');

export const EMPLOYEE_HISTORY_FIELDS = values(
  'department',
  'designation',
  'manager',
  'salary',
  'location',
  'shift',
  'status',
  'employmentType',
);

export const ATTENDANCE_STATUS = values(
  'PRESENT',
  'ABSENT',
  'HALF_DAY',
  'LATE',
  'WORK_FROM_HOME',
  'HOLIDAY',
  'LEAVE',
  'WEEK_OFF',
);
export type AttendanceStatus = (typeof ATTENDANCE_STATUS)[number];
export const WORK_MODES = values('OFFICE', 'REMOTE');

export const APPROVAL_STATUS = values(
  'DRAFT',
  'SUBMITTED',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
);
export type ApprovalStatus = (typeof APPROVAL_STATUS)[number];
export const APPROVER_TYPES = values('MANAGER', 'HR', 'FINANCE', 'PAYROLL');
export type ApproverType = (typeof APPROVER_TYPES)[number];
export const APPROVAL_STEP_STATUS = values('PENDING', 'APPROVED', 'REJECTED', 'SKIPPED');

export const HOLIDAY_TYPES = values('PUBLIC', 'COMPANY', 'OPTIONAL', 'REGIONAL');

export const LEAVE_STATUS = APPROVAL_STATUS;
export type LeaveStatus = ApprovalStatus;
export const LEAVE_UNITS = values('DAY', 'HALF_DAY');
export const HALF_DAY_SESSIONS = values('FIRST_HALF', 'SECOND_HALF');

export const SALARY_COMPONENT_TYPES = values('EARNING', 'DEDUCTION');
export type SalaryComponentType = (typeof SALARY_COMPONENT_TYPES)[number];
export const SALARY_CALCULATION_TYPES = values(
  'FIXED',
  'PERCENT_OF_BASIC',
  'PERCENT_OF_GROSS',
  'SLAB',
);
export type SalaryCalculationType = (typeof SALARY_CALCULATION_TYPES)[number];

export const PAYROLL_STATUS = values('DRAFT', 'PROCESSING', 'REVIEW', 'APPROVED', 'PAID', 'CANCELLED');
export type PayrollStatus = (typeof PAYROLL_STATUS)[number];

export const CYCLE_STATUS = values(
  'DRAFT',
  'GOAL_SETTING',
  'IN_PROGRESS',
  'SELF_REVIEW',
  'MANAGER_REVIEW',
  'HR_REVIEW',
  'COMPLETED',
);
export type CycleStatus = (typeof CYCLE_STATUS)[number];
export const GOAL_STATUS = values('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
export const GOAL_CATEGORIES = values('KPI', 'OKR', 'DEVELOPMENT', 'PROJECT', 'OTHER');
export const REVIEW_STATUS = values(
  'PENDING_SELF',
  'PENDING_MANAGER',
  'PENDING_HR',
  'COMPLETED',
);
export type ReviewStatus = (typeof REVIEW_STATUS)[number];

export const JOB_STATUS = values('DRAFT', 'OPEN', 'ON_HOLD', 'CLOSED');
export const CANDIDATE_STAGES = values(
  'APPLIED',
  'SCREENING',
  'SHORTLISTED',
  'INTERVIEW',
  'ASSESSMENT',
  'SELECTED',
  'OFFERED',
  'HIRED',
  'REJECTED',
);
export type CandidateStage = (typeof CANDIDATE_STAGES)[number];
export const CANDIDATE_SOURCES = values(
  'CAREERS_PAGE',
  'REFERRAL',
  'LINKEDIN',
  'JOB_BOARD',
  'AGENCY',
  'CAMPUS',
  'OTHER',
);
export const INTERVIEW_TYPES = values('PHONE', 'VIDEO', 'ONSITE', 'TECHNICAL', 'HR');
export const INTERVIEW_STATUS = values('SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

export const ONBOARDING_TASK_CATEGORIES = values(
  'DOCUMENTS',
  'IDENTITY',
  'BANK',
  'OFFER_LETTER',
  'AGREEMENT',
  'POLICY_ACCEPTANCE',
  'EQUIPMENT',
  'ACCOUNTS',
  'ORIENTATION',
  'OTHER',
);
export const TASK_STATUS = values('PENDING', 'IN_PROGRESS', 'COMPLETED');
export const TASK_ASSIGNEE = values('EMPLOYEE', 'HR', 'MANAGER', 'IT');

export const EXIT_TYPES = values('RESIGNATION', 'TERMINATION', 'RETIREMENT', 'CONTRACT_END', 'OTHER');
export const OFFBOARDING_STATUS = values(
  'EXIT_REQUEST',
  'NOTICE_PERIOD',
  'ASSET_RETURN',
  'CLEARANCE',
  'FINAL_PAYROLL',
  'EXIT_INTERVIEW',
  'DEACTIVATION',
  'COMPLETED',
  'CANCELLED',
);
export type OffboardingStatus = (typeof OFFBOARDING_STATUS)[number];

export const DOCUMENT_CATEGORIES = values(
  'IDENTITY',
  'RESUME',
  'OFFER_LETTER',
  'EMPLOYMENT_AGREEMENT',
  'PAYSLIP',
  'TAX',
  'CERTIFICATE',
  'POLICY',
  'OTHER',
);
export const DOCUMENT_VERIFICATION = values('PENDING', 'VERIFIED', 'REJECTED');

export const ASSET_CATEGORIES = values(
  'LAPTOP',
  'DESKTOP',
  'MONITOR',
  'PHONE',
  'TABLET',
  'KEYBOARD',
  'MOUSE',
  'VEHICLE',
  'OTHER',
);
export const ASSET_STATUS = values('AVAILABLE', 'ASSIGNED', 'REPAIR', 'RETIRED');
export type AssetStatus = (typeof ASSET_STATUS)[number];
export const ASSET_CONDITIONS = values('NEW', 'GOOD', 'FAIR', 'DAMAGED');

export const EXPENSE_CATEGORIES = values(
  'TRAVEL',
  'MEALS',
  'ACCOMMODATION',
  'OFFICE_SUPPLIES',
  'SOFTWARE',
  'TRAINING',
  'COMMUNICATION',
  'OTHER',
);
export const EXPENSE_STATUS = values(
  'DRAFT',
  'SUBMITTED',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'PAID',
  'CANCELLED',
);
export type ExpenseStatus = (typeof EXPENSE_STATUS)[number];

export const ANNOUNCEMENT_PRIORITY = values('LOW', 'NORMAL', 'HIGH', 'URGENT');
export const ANNOUNCEMENT_AUDIENCE = values('ALL', 'DEPARTMENTS', 'EMPLOYEES');

export const NOTIFICATION_TYPES = values(
  'LEAVE_SUBMITTED',
  'LEAVE_APPROVED',
  'LEAVE_REJECTED',
  'ATTENDANCE_CORRECTION',
  'PAYROLL_GENERATED',
  'DOCUMENT_EXPIRY',
  'PERFORMANCE_REVIEW',
  'ANNOUNCEMENT',
  'EXPENSE_APPROVAL',
  'INTERVIEW_SCHEDULED',
  'ONBOARDING',
  'OFFBOARDING',
  'ASSET',
  'GOAL',
  'GENERAL',
  'EMERGENCY',
  'TASK',
);
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export const NOTIFICATION_CHANNELS = values('IN_APP', 'EMAIL');

export const AUDIT_ACTIONS = values(
  'LOGIN',
  'LOGOUT',
  'LOGIN_FAILED',
  'PASSWORD_CHANGED',
  'PASSWORD_RESET',
  'ORGANIZATION_REGISTERED',
  'ORGANIZATION_UPDATED',
  'USER_CREATED',
  'USER_UPDATED',
  'ROLE_CREATED',
  'ROLE_UPDATED',
  'ROLE_DELETED',
  'ROLE_CHANGED',
  'EMPLOYEE_CREATED',
  'EMPLOYEE_UPDATED',
  'EMPLOYEE_ARCHIVED',
  'SALARY_UPDATED',
  'ATTENDANCE_UPDATED',
  'ATTENDANCE_REGULARIZED',
  'LEAVE_SUBMITTED',
  'LEAVE_APPROVED',
  'LEAVE_REJECTED',
  'LEAVE_CANCELLED',
  'LEAVE_BALANCE_ADJUSTED',
  'PAYROLL_CREATED',
  'PAYROLL_PROCESSED',
  'PAYROLL_APPROVED',
  'PAYROLL_PAID',
  'ASSET_ASSIGNED',
  'ASSET_RETURNED',
  'ASSET_STATUS_CHANGED',
  'DOCUMENT_UPLOADED',
  'DOCUMENT_DELETED',
  'DOCUMENT_VERIFIED',
  'EXPENSE_SUBMITTED',
  'EXPENSE_APPROVED',
  'EXPENSE_REJECTED',
  'EXPENSE_PAID',
  'CANDIDATE_HIRED',
  'OFFBOARDING_UPDATED',
  'RECORD_CREATED',
  'RECORD_UPDATED',
  'RECORD_DELETED',
  'EMERGENCY_RAISED',
  'EMERGENCY_UPDATED',
  'TASK_ASSIGNED',
  'TASK_UPDATED',
  'TASK_COMPLETED',
  'TASK_DELETED',
);
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Emergency alerts: an employee's urgent personal situation (e.g. must rush home), sent straight to HR and their manager. */
export const EMERGENCY_CATEGORIES = values('FAMILY', 'HEALTH', 'HOME', 'CHILD', 'ACCIDENT', 'OTHER');
export type EmergencyCategory = (typeof EMERGENCY_CATEGORIES)[number];
export const EMERGENCY_STATUS = values('OPEN', 'ACKNOWLEDGED', 'RESOLVED');
export type EmergencyStatus = (typeof EMERGENCY_STATUS)[number];

/** Tasks a manager / department head / HR assigns to an employee. */
export const WORK_TASK_STATUS = values('TODO', 'IN_PROGRESS', 'DONE');
export type WorkTaskStatus = (typeof WORK_TASK_STATUS)[number];
export const WORK_TASK_PRIORITY = values('LOW', 'MEDIUM', 'HIGH');
export type WorkTaskPriority = (typeof WORK_TASK_PRIORITY)[number];
