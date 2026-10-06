/**
 * `pnpm --filter @stencil/api dev:memory`
 *
 * Starts an in-memory MongoDB replica set, seeds the demo organization and
 * runs the API against it. Nothing is persisted: stopping the process discards
 * all data. Useful for demos and frontend work without a local MongoDB.
 */
import os from 'node:os';
import path from 'node:path';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

process.env.MONGOMS_DOWNLOAD_DIR ??= path.join(os.homedir(), '.cache', 'mongodb-binaries');

const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
// Must be set before any module reads the environment (config/env parses at import).
process.env.MONGODB_URI = replSet.getUri('stencil_dev');

const stop = () => {
  void replSet.stop().catch(() => undefined);
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

const { connectDatabase, disconnectDatabase } = await import('../src/config/database');
const { printCredentials, seedDemo } = await import('../src/seed/demo');
const { printStencilSummary, seedStencil } = await import('../src/seed/stencil-org');

await connectDatabase();
printCredentials(await seedDemo());
printStencilSummary(await seedStencil());
await disconnectDatabase();

// The server connects again using MONGODB_URI and starts listening.
await import('../src/server');
