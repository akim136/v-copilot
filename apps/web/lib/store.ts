import { BlobPreconditionFailedError, get, put } from '@vercel/blob';

export type WriteMode = 'overwrite' | 'create' | { ifMatch: string };

// The only Blob operations this app uses: read one path, write one path. There is deliberately no list,
// which is an advanced operation and must never run on a page load or in the health job.
export interface Store {
  read(path: string): Promise<{ body: string; etag: string } | null>;
  write(path: string, body: string, opts: { contentType: string; mode: WriteMode }): Promise<void>;
}

// A create found the path already there, or an ifMatch write found a newer version.
export class StoreConflictError extends Error {
  override name = 'StoreConflictError';
}

// Private Vercel Blob store, authenticated by BLOB_READ_WRITE_TOKEN.
export function blobStore(): Store {
  const store: Store = {
    async read(path) {
      const res = await get(path, { access: 'private', useCache: false });
      if (!res || res.statusCode !== 200) return null;
      return { body: await new Response(res.stream).text(), etag: res.blob.etag };
    },
    async write(path, body, { contentType, mode }) {
      const opts = { access: 'private', contentType, addRandomSuffix: false } as const;
      try {
        if (mode === 'overwrite') await put(path, body, { ...opts, allowOverwrite: true });
        else if (mode === 'create') await put(path, body, { ...opts, allowOverwrite: false });
        else await put(path, body, { ...opts, allowOverwrite: true, ifMatch: mode.ifMatch });
      } catch (err) {
        if (err instanceof BlobPreconditionFailedError) throw new StoreConflictError(`${path} changed since it was read`);
        // Blob reports an existing path on a create as a generic error, so look before calling it a conflict.
        if (mode === 'create' && (await store.read(path))) throw new StoreConflictError(`${path} already exists`);
        throw err;
      }
    },
  };
  return store;
}
