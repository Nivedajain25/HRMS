import { describe, expect, it } from 'vitest';
import { FallbackStorageProvider, MongoStorageProvider, type StorageProvider } from '../../src/storage/storage.service';

/** A stand-in for the old local folder. */
const legacyWith = (files: Record<string, string>): StorageProvider => {
  const map = new Map(Object.entries(files).map(([k, v]) => [k, Buffer.from(v)]));
  const get = (key: string) => {
    const f = map.get(key);
    if (!f) throw new Error('not found');
    return f;
  };
  return {
    name: 'legacy',
    put: async (key, body) => void map.set(key, body),
    getBuffer: async (key) => get(key),
    getStream: async (key) => (await import('node:stream')).Readable.from(get(key)),
    delete: async (key) => void map.delete(key),
  };
};

describe('Database file storage (selfies, documents)', () => {
  it('keeps files in the database: save, read back, replace and delete', async () => {
    const store = new MongoStorageProvider();
    const key = 'org/2026/10/selfie.jpg';
    await store.put(key, Buffer.from('first photo'), 'image/jpeg');
    expect((await store.getBuffer(key)).toString()).toBe('first photo');

    // Saving under the same key replaces the file (no duplicates left behind).
    await store.put(key, Buffer.from('second photo'), 'image/jpeg');
    expect((await store.getBuffer(key)).toString()).toBe('second photo');
    const chunks: Buffer[] = [];
    for await (const c of await store.getStream(key)) chunks.push(c as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe('second photo');

    await store.delete(key);
    await expect(store.getStream(key)).rejects.toThrow(/missing/);
  });

  it('still reads files saved on disk before the switch', async () => {
    const store = new FallbackStorageProvider(new MongoStorageProvider(), legacyWith({ 'old/selfie.jpg': 'old photo' }));
    expect((await store.getBuffer('old/selfie.jpg')).toString()).toBe('old photo');
    await store.put('new/selfie.jpg', Buffer.from('new photo'), 'image/jpeg');
    expect((await new MongoStorageProvider().getBuffer('new/selfie.jpg')).toString()).toBe('new photo');
    await expect(store.getStream('nowhere.jpg')).rejects.toThrow();
  });
});
