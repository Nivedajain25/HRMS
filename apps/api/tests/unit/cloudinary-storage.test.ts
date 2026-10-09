import { describe, expect, it } from 'vitest';
import { CloudinaryStorageProvider, cloudinarySignature, parseCloudinaryUrl } from '../../src/storage/storage.service';

const cfg = parseCloudinaryUrl('cloudinary://123456789012345:s3cr3t@stencil-demo');

/** Records requests and answers like Cloudinary would. */
const fakeCloudinary = (files = new Map<string, Buffer>()) => {
  const calls: { url: string; method: string; body: Record<string, string> }[] = [];
  const http = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body: Record<string, string> = {};
    if (init?.body instanceof FormData) for (const [k, v] of init.body.entries()) body[k] = typeof v === 'string' ? v : `<file ${v.size}B>`;
    if (init?.body instanceof URLSearchParams) for (const [k, v] of init.body.entries()) body[k] = v;
    calls.push({ url, method, body });
    if (url.includes('/raw/upload')) {
      const file = (init!.body as FormData).get('file') as Blob;
      files.set(body.public_id!, Buffer.from(await file.arrayBuffer()));
      return new Response(JSON.stringify({ public_id: body.public_id }), { status: 200 });
    }
    if (url.includes('/raw/download')) {
      const id = new URL(url).searchParams.get('public_id')!;
      const data = files.get(id);
      return data ? new Response(new Uint8Array(data), { status: 200 }) : new Response('', { status: 404, headers: { 'x-cld-error': 'Resource not found' } });
    }
    if (url.includes('/raw/destroy')) {
      const existed = files.delete(body.public_id!);
      return new Response(JSON.stringify({ result: existed ? 'ok' : 'not found' }), { status: 200 });
    }
    return new Response('', { status: 400 });
  }) as typeof fetch;
  return { http, calls, files };
};

describe('Cloudinary storage', () => {
  it('signs requests the way Cloudinary documents it', () => {
    // Worked example from Cloudinary's "Generating authentication signatures" guide.
    const signature = cloudinarySignature({ eager: 'w_400,h_300,c_pad|w_260,h_200,c_crop', public_id: 'sample_image', timestamp: 1315060510 }, 'abcd');
    expect(signature).toBe('bfd09f95f331f558cbd1320e67aa8d488770583e');
  });

  it('reads the account from CLOUDINARY_URL and rejects anything else', () => {
    expect(cfg).toEqual({ cloudName: 'stencil-demo', apiKey: '123456789012345', apiSecret: 's3cr3t', folder: 'stencil-hrms' });
    expect(() => parseCloudinaryUrl('https://example.com')).toThrow(/CLOUDINARY_URL/);
    expect(() => parseCloudinaryUrl('not a url')).toThrow(/CLOUDINARY_URL/);
    // The dashboard line pasted as-is works; one still holding the placeholders does not.
    expect(parseCloudinaryUrl(' CLOUDINARY_URL="cloudinary://123456789012345:s3cr3t@stencil-demo" ')).toEqual(cfg);
    expect(() => parseCloudinaryUrl('CLOUDINARY_URL=cloudinary://<your_api_key>:<your_api_secret>@stencil-demo')).toThrow(/CLOUDINARY_URL/);
  });

  it('uploads private files, reads them back through a signed link and deletes them', async () => {
    const cloud = fakeCloudinary();
    const store = new CloudinaryStorageProvider(cfg, cloud.http);
    const photo = Buffer.from('fake-png-bytes');

    await store.put('org1/2026/10/abc', photo, 'image/png');
    const upload = cloud.calls[0]!;
    expect(upload.url).toBe('https://api.cloudinary.com/v1_1/stencil-demo/raw/upload');
    expect(upload.body).toMatchObject({ public_id: 'stencil-hrms/org1/2026/10/abc', type: 'private', overwrite: 'true', api_key: '123456789012345' });
    const { api_key: _key, signature, file: _file, ...signedParams } = upload.body;
    expect(signature).toBe(cloudinarySignature(signedParams, 's3cr3t'));

    expect(await store.getBuffer('org1/2026/10/abc')).toEqual(photo);
    const chunks: Buffer[] = [];
    for await (const chunk of await store.getStream('org1/2026/10/abc')) chunks.push(Buffer.from(chunk as Uint8Array));
    expect(Buffer.concat(chunks)).toEqual(photo);
    const link = new URL(store.downloadUrl('org1/2026/10/abc'));
    expect(link.searchParams.get('type')).toBe('private');
    expect(link.searchParams.get('signature')).toMatch(/^[a-f0-9]{40}$/);

    await store.delete('org1/2026/10/abc');
    await expect(store.getBuffer('org1/2026/10/abc')).rejects.toMatchObject({ code: 'ENOENT' });
    // Deleting something already gone is fine.
    await expect(store.delete('org1/2026/10/abc')).resolves.toBeUndefined();
  });

  it('reports Cloudinary errors (e.g. wrong API secret) instead of failing silently', async () => {
    const http = (async () => new Response('', { status: 401, headers: { 'x-cld-error': 'Invalid Signature' } })) as typeof fetch;
    await expect(new CloudinaryStorageProvider(cfg, http).put('k', Buffer.from('x'), 'image/png')).rejects.toThrow('Cloudinary upload failed (401): Invalid Signature');
  });
});
