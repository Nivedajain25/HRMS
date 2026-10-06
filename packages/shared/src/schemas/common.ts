import { z } from 'zod';

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid identifier');
export const optionalObjectId = z.preprocess(
  (v) => (v === '' || v === null ? undefined : v),
  objectId.optional(),
);
/** Nullable id: empty string / null clear the reference. */
export const nullableObjectId = z.preprocess((v) => (v === '' ? null : v), objectId.nullable().optional());

/** Calendar date without time, `YYYY-MM-DD`. */
export const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use format YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Invalid date');
export const optionalDateString = z.preprocess(
  (v) => (v === '' || v === null ? undefined : v),
  dateString.optional(),
);
export const nullableDateString = z.preprocess((v) => (v === '' ? null : v), dateString.nullable().optional());

/** Time of day, `HH:mm` 24h. */
export const timeString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use format HH:mm');

export const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(254);
export const optionalEmail = z.preprocess((v) => (v === '' || v === null ? undefined : v), email.optional());
export const phone = z
  .string()
  .trim()
  .regex(/^[+\d][\d\s\-()]{5,19}$/, 'Enter a valid phone number');
export const optionalPhone = z.preprocess((v) => (v === '' || v === null ? undefined : v), phone.optional());

/** Optional enum where an unselected form control (`''`/`null`) means "not provided". */
export const optionalEnum = <const T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess((v) => (v === '' || v === null ? undefined : v), z.enum(values).optional());

export const optionalString = (max = 500) =>
  z.preprocess((v) => (v === null ? undefined : v), z.string().trim().max(max).optional());
export const requiredString = (label: string, max = 200) =>
  z.string({ error: `${label} is required` }).trim().min(1, `${label} is required`).max(max);

export const money = z.coerce.number().min(0, 'Must be zero or more').max(1e12);
export const percent = z.coerce.number().min(0).max(100);

export const password = z
  .string()
  .min(8, 'At least 8 characters')
  .max(128)
  .regex(/[a-z]/, 'Include a lowercase letter')
  .regex(/[A-Z]/, 'Include an uppercase letter')
  .regex(/\d/, 'Include a number');

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
  sortBy: z.string().regex(/^[a-zA-Z.]{1,40}$/).optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
export type PaginationQuery = z.infer<typeof paginationQuery>;

export const idParam = z.object({ id: objectId });

type PatchField<F> = F extends z.ZodDefault<infer I>
  ? z.ZodOptional<I>
  : F extends z.ZodType
    ? undefined extends z.output<F>
      ? z.ZodOptional<z.ZodNullable<F>>
      : z.ZodOptional<F>
    : never;
export type PatchShape<T extends z.ZodRawShape> = { [K in keyof T]: PatchField<T[K]> };

/**
 * PATCH variant of an object schema: every field optional and **defaults
 * removed**. (Zod 4's `.partial()` still applies `.default()` values, which
 * would silently reset omitted fields such as `status` on update.)
 *
 * Omitted (`undefined`) means "unchanged". Fields that are optional in the
 * base schema also accept an explicit `null`, meaning "clear the stored
 * value"; required fields (and fields with defaults) still reject `null`.
 */
export const patchSchema = <T extends z.ZodRawShape>(schema: z.ZodObject<T>) => {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(schema.shape) as [string, z.ZodType][]) {
    if (field instanceof z.ZodDefault) {
      shape[key] = (field.unwrap() as z.ZodType).optional();
      continue;
    }
    const clearable = field.safeParse(undefined).success;
    shape[key] = clearable ? z.union([z.null(), field]).optional() : field.optional();
  }
  return z.object(shape) as unknown as z.ZodObject<PatchShape<T>>;
};

export const commentBody = z.object({ comment: optionalString(1000) });
export const rejectBody = z.object({ reason: requiredString('Reason', 1000) });
