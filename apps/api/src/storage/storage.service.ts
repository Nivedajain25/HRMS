import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import mongoose from 'mongoose';
import { env } from '../config/env';

export interface StorageProvider {
  readonly name: string;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  getStream(key: string): Promise<Readable>;
  getBuffer(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

/** Stores files on the local disk, outside any statically served directory. */
export class LocalStorageProvider implements StorageProvider {
  readonly name = 'local';
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private resolve(key: string) {
    const full = path.resolve(this.root, key);
    // Prevent path traversal out of the storage root.
    if (!full.startsWith(this.root + path.sep)) throw new Error('Invalid storage key');
    return full;
  }

  async put(key: string, body: Buffer) {
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, body, { mode: 0o600 });
  }

  async getStream(key: string) {
    const full = this.resolve(key);
    await fs.access(full);
    return createReadStream(full);
  }

  async getBuffer(key: string) {
    return fs.readFile(this.resolve(key));
  }

  async delete(key: string) {
    await fs.rm(this.resolve(key), { force: true });
  }
}

/** S3 / S3-compatible (MinIO, R2, Spaces) private bucket storage. */
export class S3StorageProvider implements StorageProvider {
  readonly name = 's3';
  private readonly client: S3Client;

  constructor(private readonly bucket: string) {
    this.client = new S3Client({
      region: env.AWS_REGION ?? 'us-east-1',
      endpoint: env.S3_ENDPOINT || undefined,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials:
        env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
          ? { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY }
          : undefined,
    });
  }

  async put(key: string, body: Buffer, contentType: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ServerSideEncryption: 'AES256',
      }),
    );
  }

  async getStream(key: string) {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return res.Body as Readable;
  }

  async getBuffer(key: string) {
    const stream = await this.getStream(key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
    return Buffer.concat(chunks);
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

const missing = (key: string) => Object.assign(new Error(`Stored object missing: ${key}`), { code: 'ENOENT' });

/**
 * Files kept in the database itself (MongoDB GridFS, bucket `uploads`). Unlike a server's own disk, they survive
 * redeploys and are covered by the database's backups, with nothing else to set up. Clock-in selfies are ~20 KB.
 */
export class MongoStorageProvider implements StorageProvider {
  readonly name = 'mongo';

  private bucket() {
    const db = mongoose.connection.db;
    if (!db) throw new Error('Database is not connected');
    return new mongoose.mongo.GridFSBucket(db, { bucketName: 'uploads' });
  }

  private async remove(key: string) {
    const bucket = this.bucket();
    for (const f of await bucket.find({ filename: key }).toArray()) await bucket.delete(f._id);
  }

  async put(key: string, body: Buffer, contentType: string) {
    await this.remove(key);
    await new Promise<void>((resolve, reject) => {
      const upload = this.bucket().openUploadStream(key, { metadata: { contentType } });
      upload.once('error', reject).once('finish', () => resolve());
      upload.end(body);
    });
  }

  async getStream(key: string): Promise<Readable> {
    const file = await this.bucket().find({ filename: key }).sort({ uploadDate: -1 }).limit(1).next();
    if (!file) throw missing(key);
    return this.bucket().openDownloadStream(file._id);
  }

  async getBuffer(key: string) {
    const chunks: Buffer[] = [];
    for await (const chunk of await this.getStream(key)) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }

  async delete(key: string) {
    await this.remove(key);
  }
}

/** New files go to `primary`; files saved before the switch are still read (and deleted) from `legacy`. */
export class FallbackStorageProvider implements StorageProvider {
  readonly name: string;

  constructor(
    private readonly primary: StorageProvider,
    private readonly legacy: StorageProvider,
  ) {
    this.name = primary.name;
  }

  put(key: string, body: Buffer, contentType: string) {
    return this.primary.put(key, body, contentType);
  }

  async getStream(key: string) {
    try {
      return await this.primary.getStream(key);
    } catch {
      return this.legacy.getStream(key);
    }
  }

  async getBuffer(key: string) {
    try {
      return await this.primary.getBuffer(key);
    } catch {
      return this.legacy.getBuffer(key);
    }
  }

  async delete(key: string) {
    await Promise.all([this.primary.delete(key), this.legacy.delete(key).catch(() => undefined)]);
  }
}

let provider: StorageProvider | null = null;

export const storage = (): StorageProvider => {
  if (provider) return provider;
  if (env.STORAGE_PROVIDER === 's3') {
    if (!env.AWS_BUCKET) throw new Error('AWS_BUCKET is required when STORAGE_PROVIDER=s3');
    provider = new S3StorageProvider(env.AWS_BUCKET);
  } else if (env.STORAGE_PROVIDER === 'local') {
    provider = new LocalStorageProvider(env.STORAGE_LOCAL_DIR);
  } else {
    // Database storage; files uploaded before it was turned on stay readable from the local folder.
    provider = new FallbackStorageProvider(new MongoStorageProvider(), new LocalStorageProvider(env.STORAGE_LOCAL_DIR));
  }
  return provider;
};

/** Test hook to swap the provider. */
export const setStorageProvider = (p: StorageProvider) => {
  provider = p;
};
