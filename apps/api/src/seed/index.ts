/**
 * `pnpm seed`           — (re)creates the "Stencil Demo Co." demo organization.
 * `pnpm seed:stencil`   — creates the "Stencil" organization from the org chart (refuses if it
 *                          exists; add `--force` to delete and recreate it).
 * Each only wipes its own organization (by slug); nothing else is touched.
 */
import { connectDatabase, disconnectDatabase } from '../config/database';
import { logger } from '../config/logger';
import { printCredentials, seedDemo } from './demo';
import { printStencilSummary, seedStencil } from './stencil-org';

const target = process.argv.includes('--stencil') ? 'stencil' : 'demo';

const main = async () => {
  await connectDatabase();
  try {
    if (target === 'stencil') printStencilSummary(await seedStencil({ replace: process.argv.includes('--force') }));
    else printCredentials(await seedDemo());
  } finally {
    await disconnectDatabase();
  }
};

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.fatal({ err }, 'Seeding failed');
    process.exit(1);
  });
