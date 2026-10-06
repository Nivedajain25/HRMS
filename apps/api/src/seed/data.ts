/**
 * Static demo dataset. Every name, email and figure here is fictional.
 * Emails use the reserved `.test` TLD so nothing can ever be delivered.
 */
import type { SystemRoleKey } from '@stencil/shared';

export const DEMO_SLUG = 'stencil-demo';
export const DEMO_DOMAIN = 'stencil-demo.test';
export const DEMO_PASSWORD = 'Demo@12345';

export const DEPARTMENTS = [
  { code: 'ENG', name: 'Engineering', description: 'Product engineering and platform' },
  { code: 'PRD', name: 'Product', description: 'Product management and design' },
  { code: 'SAL', name: 'Sales', description: 'New business and accounts' },
  { code: 'MKT', name: 'Marketing', description: 'Brand, content and growth' },
  { code: 'HR', name: 'HR', description: 'People operations and talent' },
  { code: 'FIN', name: 'Finance', description: 'Accounting, payroll and treasury' },
  { code: 'OPS', name: 'Operations', description: 'Leadership, facilities and IT operations' },
] as const;
export type DeptCode = (typeof DEPARTMENTS)[number]['code'];

export const DESIGNATIONS: { code: string; name: string; level: number; dept: DeptCode }[] = [
  { code: 'CEO', name: 'Chief Executive Officer', level: 8, dept: 'OPS' },
  { code: 'EM', name: 'Engineering Manager', level: 6, dept: 'ENG' },
  { code: 'SSE', name: 'Senior Software Engineer', level: 4, dept: 'ENG' },
  { code: 'SE', name: 'Software Engineer', level: 3, dept: 'ENG' },
  { code: 'ASE', name: 'Associate Software Engineer', level: 2, dept: 'ENG' },
  { code: 'INT', name: 'Engineering Intern', level: 1, dept: 'ENG' },
  { code: 'PM', name: 'Product Manager', level: 5, dept: 'PRD' },
  { code: 'PA', name: 'Product Analyst', level: 3, dept: 'PRD' },
  { code: 'SM', name: 'Sales Manager', level: 5, dept: 'SAL' },
  { code: 'SEX', name: 'Sales Executive', level: 3, dept: 'SAL' },
  { code: 'MM', name: 'Marketing Manager', level: 5, dept: 'MKT' },
  { code: 'MS', name: 'Marketing Specialist', level: 3, dept: 'MKT' },
  { code: 'HRM', name: 'HR Manager', level: 5, dept: 'HR' },
  { code: 'HRE', name: 'HR Executive', level: 3, dept: 'HR' },
  { code: 'TAS', name: 'Talent Acquisition Specialist', level: 3, dept: 'HR' },
  { code: 'FM', name: 'Finance Manager', level: 5, dept: 'FIN' },
  { code: 'PAYS', name: 'Payroll Specialist', level: 3, dept: 'FIN' },
  { code: 'ACC', name: 'Accountant', level: 3, dept: 'FIN' },
  { code: 'OE', name: 'Operations Executive', level: 3, dept: 'OPS' },
];

/** Monthly gross (INR) by designation level. */
export const GROSS_BY_LEVEL: Record<number, number> = { 1: 20000, 2: 45000, 3: 70000, 4: 110000, 5: 150000, 6: 200000, 8: 400000 };

export type LocationKey = 'BLR' | 'MUM' | 'REMOTE';
export const LOCATIONS: { key: LocationKey; name: string; type: 'OFFICE' | 'BRANCH' | 'REMOTE'; city?: string; state?: string }[] = [
  { key: 'BLR', name: 'Bengaluru HQ', type: 'OFFICE', city: 'Bengaluru', state: 'Karnataka' },
  { key: 'MUM', name: 'Mumbai Branch', type: 'BRANCH', city: 'Mumbai', state: 'Maharashtra' },
  { key: 'REMOTE', name: 'Remote', type: 'REMOTE' },
];

export interface PersonSeed {
  key: string;
  firstName: string;
  lastName: string;
  gender: 'MALE' | 'FEMALE';
  dept: DeptCode;
  designation: string;
  manager: string | null;
  location: LocationKey;
  /** Days before today the employee joined. */
  joinedDaysAgo: number;
  employmentType?: 'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'INTERN';
  status?: 'ACTIVE' | 'PROBATION';
  /** Demo login: local part of the email + system role. */
  login?: { local: string; role: SystemRoleKey; label: string };
  nightShift?: boolean;
  /** Birthday this many days from today (else pseudo-random). */
  birthdayInDays?: number;
}

export const PEOPLE: PersonSeed[] = [
  { key: 'ceo', firstName: 'Aarav', lastName: 'Mehta', gender: 'MALE', dept: 'OPS', designation: 'CEO', manager: null, location: 'BLR', joinedDaysAgo: 1815, login: { local: 'superadmin', role: 'super_admin', label: 'Super Admin' } },
  { key: 'hr', firstName: 'Priya', lastName: 'Nair', gender: 'FEMALE', dept: 'HR', designation: 'HRM', manager: 'ceo', location: 'BLR', joinedDaysAgo: 1450, login: { local: 'hr', role: 'hr_admin', label: 'HR Admin' } },
  { key: 'hrmanager', firstName: 'Kavya', lastName: 'Iyer', gender: 'FEMALE', dept: 'HR', designation: 'HRE', manager: 'hr', location: 'BLR', joinedDaysAgo: 1100, login: { local: 'hrmanager', role: 'hr_manager', label: 'HR Manager' } },
  { key: 'manager', firstName: 'Rohan', lastName: 'Kapoor', gender: 'MALE', dept: 'ENG', designation: 'EM', manager: 'ceo', location: 'BLR', joinedDaysAgo: 1300, login: { local: 'manager', role: 'manager', label: 'Manager' } },
  { key: 'employee', firstName: 'Ananya', lastName: 'Sharma', gender: 'FEMALE', dept: 'ENG', designation: 'SE', manager: 'manager', location: 'BLR', joinedDaysAgo: 720, birthdayInDays: 3, login: { local: 'employee', role: 'employee', label: 'Employee' } },
  { key: 'recruiter', firstName: 'Neha', lastName: 'Gupta', gender: 'FEMALE', dept: 'HR', designation: 'TAS', manager: 'hr', location: 'BLR', joinedDaysAgo: 700, login: { local: 'recruiter', role: 'recruiter', label: 'Recruiter' } },
  { key: 'finance', firstName: 'Meera', lastName: 'Pillai', gender: 'FEMALE', dept: 'FIN', designation: 'FM', manager: 'ceo', location: 'MUM', joinedDaysAgo: 1200, login: { local: 'finance', role: 'finance', label: 'Finance' } },
  { key: 'payroll', firstName: 'Vikram', lastName: 'Rao', gender: 'MALE', dept: 'FIN', designation: 'PAYS', manager: 'finance', location: 'MUM', joinedDaysAgo: 1085, login: { local: 'payroll', role: 'payroll_admin', label: 'Payroll Admin' } },
  { key: 'arjun', firstName: 'Arjun', lastName: 'Desai', gender: 'MALE', dept: 'PRD', designation: 'PM', manager: 'ceo', location: 'BLR', joinedDaysAgo: 1000 },
  { key: 'sanjay', firstName: 'Sanjay', lastName: 'Verma', gender: 'MALE', dept: 'SAL', designation: 'SM', manager: 'ceo', location: 'MUM', joinedDaysAgo: 1350 },
  { key: 'isha', firstName: 'Isha', lastName: 'Malhotra', gender: 'FEMALE', dept: 'MKT', designation: 'MM', manager: 'ceo', location: 'MUM', joinedDaysAgo: 900 },
  { key: 'karan', firstName: 'Karan', lastName: 'Singh', gender: 'MALE', dept: 'ENG', designation: 'SSE', manager: 'manager', location: 'BLR', joinedDaysAgo: 600, birthdayInDays: 9 },
  { key: 'diya', firstName: 'Diya', lastName: 'Menon', gender: 'FEMALE', dept: 'ENG', designation: 'SSE', manager: 'manager', location: 'REMOTE', joinedDaysAgo: 540 },
  { key: 'aditya', firstName: 'Aditya', lastName: 'Joshi', gender: 'MALE', dept: 'ENG', designation: 'SE', manager: 'manager', location: 'BLR', joinedDaysAgo: 400, birthdayInDays: 0 },
  { key: 'sneha', firstName: 'Sneha', lastName: 'Reddy', gender: 'FEMALE', dept: 'ENG', designation: 'SE', manager: 'manager', location: 'BLR', joinedDaysAgo: 380 },
  { key: 'rahul', firstName: 'Rahul', lastName: 'Bose', gender: 'MALE', dept: 'ENG', designation: 'ASE', manager: 'karan', location: 'BLR', joinedDaysAgo: 200 },
  { key: 'pooja', firstName: 'Pooja', lastName: 'Kulkarni', gender: 'FEMALE', dept: 'ENG', designation: 'ASE', manager: 'karan', location: 'BLR', joinedDaysAgo: 5, status: 'PROBATION' },
  { key: 'nikhil', firstName: 'Nikhil', lastName: 'Chawla', gender: 'MALE', dept: 'ENG', designation: 'INT', manager: 'diya', location: 'REMOTE', joinedDaysAgo: 90, employmentType: 'INTERN' },
  { key: 'tanvi', firstName: 'Tanvi', lastName: 'Shah', gender: 'FEMALE', dept: 'PRD', designation: 'PA', manager: 'arjun', location: 'BLR', joinedDaysAgo: 350 },
  { key: 'varun', firstName: 'Varun', lastName: 'Bhatt', gender: 'MALE', dept: 'PRD', designation: 'PA', manager: 'arjun', location: 'BLR', joinedDaysAgo: 300, birthdayInDays: 21 },
  { key: 'riya', firstName: 'Riya', lastName: 'Das', gender: 'FEMALE', dept: 'SAL', designation: 'SEX', manager: 'sanjay', location: 'MUM', joinedDaysAgo: 500 },
  { key: 'aman', firstName: 'Aman', lastName: 'Khanna', gender: 'MALE', dept: 'SAL', designation: 'SEX', manager: 'sanjay', location: 'MUM', joinedDaysAgo: 450 },
  { key: 'farhan', firstName: 'Farhan', lastName: 'Qureshi', gender: 'MALE', dept: 'SAL', designation: 'SEX', manager: 'sanjay', location: 'MUM', joinedDaysAgo: 250, employmentType: 'CONTRACT' },
  { key: 'nisha', firstName: 'Nisha', lastName: 'Agarwal', gender: 'FEMALE', dept: 'MKT', designation: 'MS', manager: 'isha', location: 'MUM', joinedDaysAgo: 800 },
  { key: 'kabir', firstName: 'Kabir', lastName: 'Arora', gender: 'MALE', dept: 'MKT', designation: 'MS', manager: 'isha', location: 'REMOTE', joinedDaysAgo: 150, employmentType: 'PART_TIME' },
  { key: 'lakshmi', firstName: 'Lakshmi', lastName: 'Krishnan', gender: 'FEMALE', dept: 'FIN', designation: 'ACC', manager: 'finance', location: 'MUM', joinedDaysAgo: 1400 },
  { key: 'suresh', firstName: 'Suresh', lastName: 'Patil', gender: 'MALE', dept: 'OPS', designation: 'OE', manager: 'ceo', location: 'BLR', joinedDaysAgo: 1715, nightShift: true },
  { key: 'gaurav', firstName: 'Gaurav', lastName: 'Mishra', gender: 'MALE', dept: 'OPS', designation: 'OE', manager: 'ceo', location: 'BLR', joinedDaysAgo: 2000, nightShift: true },
  { key: 'anjali', firstName: 'Anjali', lastName: 'Saxena', gender: 'FEMALE', dept: 'OPS', designation: 'OE', manager: 'ceo', location: 'BLR', joinedDaysAgo: 715 },
  { key: 'deepak', firstName: 'Deepak', lastName: 'Yadav', gender: 'MALE', dept: 'ENG', designation: 'SSE', manager: 'manager', location: 'BLR', joinedDaysAgo: 60, status: 'PROBATION' },
];

export const DEPARTMENT_HEADS: Record<DeptCode, string> = {
  OPS: 'ceo',
  ENG: 'manager',
  PRD: 'arjun',
  SAL: 'sanjay',
  MKT: 'isha',
  HR: 'hr',
  FIN: 'finance',
};

/** Holidays for the current year (fictional-generic names; Diwali date approximate). */
export const HOLIDAYS = [
  { md: '01-01', name: "New Year's Day", type: 'PUBLIC' },
  { md: '01-14', name: 'Harvest Festival', type: 'OPTIONAL' },
  { md: '01-26', name: 'Republic Day', type: 'PUBLIC' },
  { md: '08-15', name: 'Independence Day', type: 'PUBLIC' },
  { md: '10-02', name: 'Gandhi Jayanti', type: 'PUBLIC' },
  { md: '11-08', name: 'Diwali', type: 'PUBLIC' },
  { md: '12-25', name: 'Christmas', type: 'PUBLIC' },
] as const;
