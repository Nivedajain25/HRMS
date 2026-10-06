import { z } from 'zod';
import { salesController as s } from '../controllers/sales.controller';
import { uploadSingle } from '../middleware/upload';
import { createModule } from './registry';

/** Monthly sales figures (imported from Excel / CSV) for the admin dashboard's Sales overview graph. */
export const salesModule = createModule('Sales', '/api/v1/sales');
salesModule.route(
  {
    method: 'get',
    path: '/monthly',
    summary: 'Monthly sales for the last N months (default 12)',
    anyPermission: ['report:read', 'employee:read'],
    query: z.object({ months: z.coerce.number().int().min(3).max(36).optional() }),
  },
  s.monthly,
);
salesModule.route(
  {
    method: 'post',
    path: '/import',
    summary: 'Import monthly sales from an Excel (.xlsx) or CSV file',
    description:
      'Multipart field `file`. The sheet needs a header row with a Month column and a Sales / Amount / Revenue column (optional Target). Months like 2026-09, 09/2026, Sep 2026 or real dates; amounts like 1250000, ₹12,50,000, 12.5 L, 1.2 Cr. Re-importing a month replaces it; several rows for one month are added up.',
    permissions: ['settings:manage'],
    before: [uploadSingle()],
  },
  s.import,
);
