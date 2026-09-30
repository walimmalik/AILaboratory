import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * Where file bytes live (plan 011a, ADR 0033): content-addressed, so a file is named by the sha256
 * of its bytes and identical files are stored once. A local folder now (a Docker volume in
 * compose); an S3-compatible store later is another implementation of the same interface.
 */
export interface FileStore {
  /** Stores the bytes and returns their sha256. Storing bytes already there is a no-op. */
  put(bytes: Uint8Array): Promise<string>;
  /** The bytes with this sha256, or undefined when the store doesn't have them. */
  get(sha256: string): Promise<Uint8Array | undefined>;
}

export const sha256Of = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Bytes in a folder, as `ab/cd/abcd…`, so no folder grows too large. */
export class LocalFileStore implements FileStore {
  constructor(private readonly root: string) {}

  #path(sha256: string) {
    return join(this.root, sha256.slice(0, 2), sha256.slice(2, 4), sha256);
  }

  async put(bytes: Uint8Array): Promise<string> {
    const sha256 = sha256Of(bytes);
    const path = this.#path(sha256);
    const exists = await stat(path).then(
      (s) => s.size === bytes.byteLength,
      () => false,
    );
    if (!exists) {
      await mkdir(dirname(path), { recursive: true });
      // Write then rename, so a reader never sees half a file.
      const partial = `${path}.${process.pid}.${Date.now()}.partial`;
      await writeFile(partial, bytes);
      await rename(partial, path);
    }
    return sha256;
  }

  async get(sha256: string): Promise<Uint8Array | undefined> {
    if (!/^[0-9a-f]{64}$/.test(sha256)) return undefined;
    return readFile(this.#path(sha256)).then(
      (b) => new Uint8Array(b),
      () => undefined,
    );
  }
}

/** Bytes in memory, for tests. */
export class MemoryFileStore implements FileStore {
  readonly #bytes = new Map<string, Uint8Array>();

  async put(bytes: Uint8Array): Promise<string> {
    const sha256 = sha256Of(bytes);
    if (!this.#bytes.has(sha256)) this.#bytes.set(sha256, bytes.slice());
    return sha256;
  }

  async get(sha256: string): Promise<Uint8Array | undefined> {
    return this.#bytes.get(sha256);
  }
}

/** The store `.env` asks for: FILE_STORE_DIR, or `data/files` under the working folder. */
export function fileStoreFromEnv(env: NodeJS.ProcessEnv): FileStore {
  return new LocalFileStore(env.FILE_STORE_DIR || join(process.cwd(), 'data', 'files'));
}
