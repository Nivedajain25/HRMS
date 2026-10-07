/**
 * Permission catalog. Permissions are `module:action` strings.
 *
 * Scope convention used throughout the API:
 *  - `<module>:read` grants organization-wide read access.
 *  - Without it, users only see their own records, plus their direct/indirect
 *    reports' records if they hold `team:view`.
 */
export const PERMISSION_GROUPS = {
  employee: {
    label: 'Employees',
    actions: {
      'employee:create': 'Create employees',
      'employee:read': 'View all employees',
      'employee:update': 'Update employees',
      'employee:delete': 'Archive employees',
      'employee:read_sensitive': 'View bank and identity details',
    },
  },
  team: {
    label: 'Team',
    actions: {
      'team:view': 'View own team (direct and indirect reports)',
    },
  },
  organization: {
    label: 'Organization structure',
    actions: {
      'department:manage': 'Manage departments',
      'designation:manage': 'Manage designations',
      'location:manage': 'Manage locations',
    },
  },
  attendance: {
    label: 'Attendance',
    actions: {
      'attendance:create': 'Record attendance for others',
      'attendance:read': 'View all attendance',
      'attendance:update': 'Edit attendance records',
      'attendance:approve': 'Approve regularization requests',
      'shift:manage': 'Manage shifts and assignments',
      'holiday:manage': 'Manage holidays',
    },
  },
  leave: {
    label: 'Leave',
    actions: {
      'leave:create': 'Apply leave on behalf of others',
      'leave:read': 'View all leave requests',
      'leave:update': 'Adjust leave balances',
      'leave:approve': 'Approve leave',
      'leave:reject': 'Reject leave',
      'leave_type:manage': 'Manage leave types and policies',
    },
  },
  payroll: {
    label: 'Payroll',
    actions: {
      'payroll:create': 'Create payroll runs',
      'payroll:read': 'View payroll runs and all payslips',
      'payroll:process': 'Process payroll',
      'payroll:approve': 'Approve and pay payroll',
      'salary:read': 'View salary structures',
      'salary:update': 'Update salary structures and components',
    },
  },
  performance: {
    label: 'Performance',
    actions: {
      'performance:create': 'Create cycles and goals',
      'performance:read': 'View all performance data',
      'performance:review': 'Perform HR/final reviews',
    },
  },
  recruitment: {
    label: 'Recruitment',
    actions: {
      'recruitment:create': 'Create jobs and candidates',
      'recruitment:read': 'View recruitment data',
      'recruitment:update': 'Update jobs, candidates, interviews',
    },
  },
  lifecycle: {
    label: 'Onboarding & Offboarding',
    actions: {
      'onboarding:manage': 'Manage onboarding',
      'offboarding:manage': 'Manage offboarding',
    },
  },
  document: {
    label: 'Documents',
    actions: {
      'document:create': 'Upload documents for any employee',
      'document:read': 'View all documents',
      'document:delete': 'Delete documents',
      'document:verify': 'Verify documents',
    },
  },
  asset: {
    label: 'Assets',
    actions: {
      'asset:create': 'Create and edit assets',
      'asset:read': 'View all assets',
      'asset:assign': 'Assign assets',
      'asset:return': 'Return, repair and retire assets',
    },
  },
  expense: {
    label: 'Expenses',
    actions: {
      'expense:create': 'Submit expenses on behalf of others',
      'expense:read': 'View all expenses',
      'expense:approve': 'Approve expenses',
      'expense:reject': 'Reject expenses',
      'expense:pay': 'Mark expenses as paid',
    },
  },
  communication: {
    label: 'Communication',
    actions: {
      'announcement:manage': 'Manage announcements',
      'emergency:manage': 'Receive and respond to emergency alerts',
    },
  },
  reporting: {
    label: 'Reports & Audit',
    actions: {
      'report:read': 'View and export reports',
      'audit:read': 'View audit logs',
    },
  },
  administration: {
    label: 'Administration',
    actions: {
      'settings:manage': 'Manage organization settings',
      'user:manage': 'Manage users',
      'role:manage': 'Manage roles and permissions',
    },
  },
} as const;

type Groups = typeof PERMISSION_GROUPS;
export type Permission = {
  [G in keyof Groups]: keyof Groups[G]['actions'];
}[keyof Groups] &
  string;

export const ALL_PERMISSIONS = Object.values(PERMISSION_GROUPS).flatMap((g) =>
  Object.keys(g.actions),
) as Permission[];

export const isPermission = (value: string): value is Permission =>
  (ALL_PERMISSIONS as string[]).includes(value);

export const SYSTEM_ROLE_KEYS = [
  'super_admin',
  'admin',
  'hr_admin',
  'hr_manager',
  'manager',
  'employee',
  'recruiter',
  'payroll_admin',
  'finance',
] as const;
export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];

const HR_BASE: Permission[] = [
  'employee:create',
  'employee:read',
  'employee:update',
  'team:view',
  'department:manage',
  'designation:manage',
  'location:manage',
  'attendance:read',
  'attendance:update',
  'attendance:approve',
  'shift:manage',
  'holiday:manage',
  'leave:read',
  'leave:approve',
  'leave:reject',
  'performance:read',
  'performance:review',
  'recruitment:read',
  'onboarding:manage',
  'offboarding:manage',
  'document:create',
  'document:read',
  'document:verify',
  'asset:read',
  'asset:assign',
  'asset:return',
  'announcement:manage',
  'emergency:manage',
  'report:read',
];

export const SYSTEM_ROLES: Record<
  SystemRoleKey,
  { name: string; description: string; permissions: Permission[] }
> = {
  super_admin: {
    name: 'Super Admin',
    description: 'Full access to everything in the organization',
    permissions: [...ALL_PERMISSIONS],
  },
  admin: {
    name: 'Admin',
    description: 'Full access, except Super-Admin-only controls (breaks on/off, granting the Super Admin role)',
    permissions: [...ALL_PERMISSIONS],
  },
  hr_admin: {
    name: 'HR Admin',
    description: 'Full HR operations',
    permissions: [
      ...HR_BASE,
      'employee:delete',
      'employee:read_sensitive',
      'attendance:create',
      'leave:create',
      'leave:update',
      'leave_type:manage',
      'performance:create',
      'recruitment:create',
      'recruitment:update',
      'document:delete',
      'asset:create',
      'expense:read',
      'audit:read',
      'user:manage',
    ],
  },
  hr_manager: {
    name: 'HR Manager',
    description: 'HR operations with limited administrative scope',
    permissions: [...HR_BASE],
  },
  manager: {
    name: 'Manager',
    description: 'Manages a team: approvals, goals and reviews',
    permissions: [
      'team:view',
      'attendance:approve',
      'leave:approve',
      'leave:reject',
      'performance:create',
      'expense:approve',
      'expense:reject',
    ],
  },
  employee: {
    name: 'Employee',
    description: 'Self-service access',
    permissions: [],
  },
  recruiter: {
    name: 'Recruiter',
    description: 'Recruitment and hiring',
    permissions: ['recruitment:create', 'recruitment:read', 'recruitment:update', 'report:read'],
  },
  payroll_admin: {
    name: 'Payroll Admin',
    description: 'Salary structures and payroll processing',
    permissions: [
      'employee:read',
      'employee:read_sensitive',
      'attendance:read',
      'leave:read',
      'payroll:create',
      'payroll:read',
      'payroll:process',
      'payroll:approve',
      'salary:read',
      'salary:update',
      'report:read',
    ],
  },
  finance: {
    name: 'Finance',
    description: 'Expense and financial workflows',
    permissions: [
      'expense:read',
      'expense:approve',
      'expense:reject',
      'expense:pay',
      'payroll:read',
      'report:read',
    ],
  },
};

export const hasPermission = (granted: readonly string[], required: Permission) =>
  granted.includes(required);

export const hasAnyPermission = (granted: readonly string[], required: readonly Permission[]) =>
  required.some((p) => granted.includes(p));
