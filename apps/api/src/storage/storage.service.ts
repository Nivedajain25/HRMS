import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
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

/** Cloudinary account from its "API environment variable": `cloudinary://<api_key>:<api_secret>@<cloud_name>`. */
export interface CloudinaryConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  /** Folder every file goes under, e.g. `stencil-hrms/<org>/2026/10/<id>`. */
  folder: string;
}

export const parseCloudinaryUrl = (url: string, folder = 'stencil-hrms'): CloudinaryConfig => {
  let u: URL;
  try {
    // Accept the dashboard line as copied (with or without CLOUDINARY_URL= and quotes).
    u = new URL(url.trim().replace(/^CLOUDINARY_URL=/, '').replace(/^['"]|['"]$/g, ''));
  } catch {
    u = new URL('invalid://');
  }
  if (u.protocol !== 'cloudinary:' || !u.username || !u.password || !u.hostname) {
    throw new Error('CLOUDINARY_URL must look like cloudinary://<api_key>:<api_secret>@<cloud_name>');
  }
  const apiKey = decodeURIComponent(u.username);
  const apiSecret = decodeURIComponent(u.password);
  // The dashboard shows the line with <your_api_key>:<your_api_secret> placeholders until they are filled in.
  if (/[<>]/.test(apiKey + apiSecret + u.hostname)) {
    throw new Error('CLOUDINARY_URL still has the <your_api_key>/<your_api_secret> placeholders; put in the real key and secret');
  }
  return { cloudName: u.hostname, apiKey, apiSecret, folder };
};

/**
 * Cloudinary request signature: the parameters (without file, api_key, resource_type and cloud_name) sorted by
 * name as `key=value` joined with `&`, followed by the API secret, SHA-1 hex.
 */
export const cloudinarySignature = (params: Record<string, string | number | undefined>, apiSecret: string) => {
  const toSign = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== '')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return createHash('sha1').update(toSign + apiSecret).digest('hex');
};

const cloudinaryError = async (res: Response) => {
  const header = res.headers.get('x-cld-error');
  if (header) return header;
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return body?.error?.message ?? res.statusText;
};

/**
 * Files in a Cloudinary account, stored **private** (as raw files, so any type works): only this server can fetch
 * them, with a signed download link, and the apps keep loading them through the API with the user's sign-in.
 */
export class CloudinaryStorageProvider implements StorageProvider {
  readonly name = 'cloudinary';

  constructor(
    private readonly cfg: CloudinaryConfig,
    private readonly http: typeof fetch = (...args) => fetch(...args),
  ) {}

  private publicId(key: string) {
    return `${this.cfg.folder}/${key}`;
  }

  private endpoint(action: 'upload' | 'download' | 'destroy') {
    return `https://api.cloudinary.com/v1_1/${encodeURIComponent(this.cfg.cloudName)}/raw/${action}`;
  }

  /** The parameters plus timestamp, api_key and signature. */
  private signed(params: Record<string, string>) {
    const withTime = { ...params, timestamp: String(Math.floor(Date.now() / 1000)) };
    return { ...withTime, api_key: this.cfg.apiKey, signature: cloudinarySignature(withTime, this.cfg.apiSecret) };
  }

  /** Signed, short-lived link to a private file (Cloudinary's "private download URL"). */
  downloadUrl(key: string) {
    return `${this.endpoint('download')}?${new URLSearchParams(this.signed({ public_id: this.publicId(key), type: 'private' }))}`;
  }

  async put(key: string, body: Buffer, contentType: string) {
    const form = new FormData();
    for (const [k, v] of Object.entries(this.signed({ public_id: this.publicId(key), type: 'private', overwrite: 'true' }))) form.append(k, v);
    form.append('file', new Blob([new Uint8Array(body)], { type: contentType }), key.split('/').pop() || 'file');
    const res = await this.http(this.endpoint('upload'), { method: 'POST', body: form });
    if (!res.ok) throw new Error(`Cloudinary upload failed (${res.status}): ${await cloudinaryError(res)}`);
  }

  private async fetchFile(key: string) {
    const res = await this.http(this.downloadUrl(key));
    if (res.status === 404) throw missing(key);
    if (!res.ok || !res.body) throw new Error(`Cloudinary download failed (${res.status}): ${await cloudinaryError(res)}`);
    return res;
  }

  async getStream(key: string): Promise<Readable> {
    const res = await this.fetchFile(key);
    return Readable.fromWeb(res.body as unknown as WebReadableStream);
  }

  async getBuffer(key: string) {
    const res = await this.fetchFile(key);
    return Buffer.from(await res.arrayBuffer());
  }

  async delete(key: string) {
    const res = await this.http(this.endpoint('destroy'), {
      method: 'POST',
      body: new URLSearchParams(this.signed({ public_id: this.publicId(key), type: 'private', invalidate: 'true' })),
    });
    // "not found" is fine: the file is gone either way.
    if (!res.ok && res.status !== 404) throw new Error(`Cloudinary delete failed (${res.status}): ${await cloudinaryError(res)}`);
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

/** For the health check: the storage in use, or that it is set up wrongly (e.g. CLOUDINARY_URL still has placeholders). */
export const storageStatus = () => {
  try {
    return storage().name;
  } catch {
    return `${storageKind()} (misconfigured)`;
  }
};

/** Which storage is in use: STORAGE_PROVIDER when set, else Cloudinary when CLOUDINARY_URL is set, else the database. */
export const storageKind = () => env.STORAGE_PROVIDER ?? (env.CLOUDINARY_URL ? 'cloudinary' : 'mongo');

export const storage = (): StorageProvider => {
  if (provider) return provider;
  const kind = storageKind();
  // Database storage; files uploaded before it was turned on stay readable from the local folder.
  const database = () => new FallbackStorageProvider(new MongoStorageProvider(), new LocalStorageProvider(env.STORAGE_LOCAL_DIR));
  if (kind === 's3') {
    if (!env.AWS_BUCKET) throw new Error('AWS_BUCKET is required when STORAGE_PROVIDER=s3');
    provider = new S3StorageProvider(env.AWS_BUCKET);
  } else if (kind === 'local') {
    provider = new LocalStorageProvider(env.STORAGE_LOCAL_DIR);
  } else if (kind === 'cloudinary') {
    if (!env.CLOUDINARY_URL) throw new Error('CLOUDINARY_URL is required when STORAGE_PROVIDER=cloudinary');
    // New files go to Cloudinary; files saved earlier (database or local folder) stay readable.
    provider = new FallbackStorageProvider(new CloudinaryStorageProvider(parseCloudinaryUrl(env.CLOUDINARY_URL)), database());
  } else {
    provider = database();
  }
  return provider;
};

/** Test hook to swap the provider. */
export const setStorageProvider = (p: StorageProvider) => {
  provider = p;
};
