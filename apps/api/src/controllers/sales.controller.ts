import { query } from '../middleware/validate';
import * as sales from '../services/sales.service';
import { handle } from '../utils/controller';

export const salesController = {
  monthly: handle((ctx, req) => sales.monthlySales(ctx, query<{ months?: number }>(req))),
  import: handle((ctx, req) => sales.importSales(ctx, req.file), 'Sales imported'),
};
