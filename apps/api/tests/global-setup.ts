import os from 'node:os';
import path from 'node:path';
import type { TestProject } from 'vitest/node';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

let replSet: MongoMemoryReplSet | undefined;

declare module 'vitest' {
  export interface ProvidedContext {
    mongoUri: string;
  }
}

export default async function setup(project: TestProject) {
  // Keep the downloaded mongod binary in the user cache (not inside the repo).
  process.env.MONGOMS_DOWNLOAD_DIR ??= path.join(os.homedir(), '.cache', 'mongodb-binaries');
  // A single-node replica set so MongoDB transactions are exercised in tests.
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  project.provide('mongoUri', replSet.getUri());
  return async () => {
    await replSet?.stop();
  };
}
