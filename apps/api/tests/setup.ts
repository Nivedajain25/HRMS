import mongoose from 'mongoose';
import { afterAll, beforeAll, inject } from 'vitest';
import { connectDatabase } from '../src/config/database';
import { syncPermissionCatalog } from '../src/services/organization-setup.service';
import { setStorageProvider, type StorageProvider } from '../src/storage/storage.service';
import { Readable } from 'node:stream';

/** In-memory storage so tests never touch the disk. */
class MemoryStorage implements StorageProvider {
  readonly name = 'memory';
  files = new Map<string, Buffer>();
  async put(key: string, body: Buffer) {
    this.files.set(key, body);
  }
  async getStream(key: string) {
    const f = this.files.get(key);
    if (!f) throw new Error('not found');
    return Readable.from(f);
  }
  async getBuffer(key: string) {
    const f = this.files.get(key);
    if (!f) throw new Error('not found');
    return f;
  }
  async delete(key: string) {
    this.files.delete(key);
  }
}

beforeAll(async () => {
  setStorageProvider(new MemoryStorage());
  // Each test file gets its own database on the shared replica set.
  const dbName = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const uri = inject('mongoUri').replace(/\/(\?|$)/, `/${dbName}$1`);
  await connectDatabase(uri);
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  await syncPermissionCatalog();
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
