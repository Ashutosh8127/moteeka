import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * A tiny JSON-file store.
 *
 * Writes go to a temp file and are renamed into place, so a crash mid-write
 * leaves the previous file intact rather than a truncated one. That is the
 * single property that makes a flat file safe enough to run a catalogue on
 * until the real database arrives.
 */
export class JsonStore<T> {
  // Written out longhand rather than as constructor parameter properties:
  // Node strips types at runtime and cannot erase that shorthand.
  readonly file: string;
  private readonly fallback: () => T;
  private cache: T | null = null;
  /** mtime the cache was built from, so an edit on disk is noticed. */
  private cachedAt = 0;

  constructor(file: string, fallback: () => T) {
    this.file = file;
    this.fallback = fallback;
  }

  read(): T {
    if (!existsSync(this.file)) {
      const seed = this.fallback();
      this.write(seed);
      return seed;
    }
    // Editing data/*.json by hand is a normal way to run this shop, so a cache
    // that never notices the file changed is a trap rather than an optimisation.
    const mtime = statSync(this.file).mtimeMs;
    if (this.cache !== null && mtime === this.cachedAt) return this.cache;
    this.cache = JSON.parse(readFileSync(this.file, 'utf8')) as T;
    this.cachedAt = mtime;
    return this.cache;
  }

  write(value: T): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
    renameSync(tmp, this.file);
    this.cache = value;
    this.cachedAt = statSync(this.file).mtimeMs;
  }

  update(fn: (current: T) => T): T {
    const next = fn(this.read());
    this.write(next);
    return next;
  }

  /** Drops the in-memory copy — used by tests and after an out-of-band edit. */
  invalidate(): void {
    this.cache = null;
    this.cachedAt = 0;
  }
}

export const dataDir = (root: string) => join(root, 'data');
