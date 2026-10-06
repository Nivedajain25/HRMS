import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { assetUpdateSchema, optionalDateString, optionalString, patchSchema, requiredString } from '@stencil/shared';

describe('patchSchema', () => {
  const schema = patchSchema(
    z.object({
      name: requiredString('Name'),
      note: optionalString(100),
      due: optionalDateString,
      status: z.enum(['A', 'B']).default('A'),
    }),
  );

  it('treats omitted fields as unchanged and applies no defaults', () => {
    expect(schema.parse({})).toEqual({});
  });

  it('keeps an explicit null for optional fields (clear)', () => {
    expect(schema.parse({ note: null, due: null })).toEqual({ note: null, due: null });
  });

  it('rejects null for required fields and fields with defaults', () => {
    expect(schema.safeParse({ name: null }).success).toBe(false);
    expect(schema.safeParse({ status: null }).success).toBe(false);
  });

  it('still validates and transforms provided values', () => {
    expect(schema.parse({ name: '  Ada ', due: '2030-01-01' })).toEqual({ name: 'Ada', due: '2030-01-01' });
    expect(schema.safeParse({ due: '2030-13-45' }).success).toBe(false);
  });

  it('asset updates can clear dates/cost but never the tag', () => {
    expect(assetUpdateSchema.parse({ purchaseDate: null, purchaseCost: null })).toEqual({ purchaseDate: null, purchaseCost: null });
    expect(assetUpdateSchema.safeParse({ assetTag: null }).success).toBe(false);
  });
});
