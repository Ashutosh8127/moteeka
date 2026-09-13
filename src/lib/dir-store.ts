import { readFileSync, writeFileSync, renameSync, readdirSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A folder of JSON documents, one file per record.
 *
 * One 4,000-line products.json becomes one readable file per product. That
 * matters as the catalogue grows: you can open a single piece, diffs name the
 * product that changed, and two people editing different products no longer
 * collide in the same file.
 *
 * Writes are atomic per file (temp + rename), and the cache re-reads a file
 * when its mtime moves, so editing one by hand takes effect without a restart.
 */
export class DirStore<T extends { id: string }> {
  readonly dir: string;
  private readonly nameOf: (doc: T) => string;
  private cache = new Map<string, { doc: T; mtime: number }>();
  private dirMtime = -1;

  constructor(dir: string, nameOf: (doc: T) => string) {
    this.dir = dir;
    this.nameOf = nameOf;
    mkdirSync(dir, { recursive: true });
  }

  private fileFor(doc: T): string {
    return join(this.dir, `${this.nameOf(doc)}.json`);
  }

  all(): T[] {
    const mtime = statSync(this.dir).mtimeMs;
    const files = readdirSync(this.dir).filter((f) => f.endsWith('.json'));

    // A changed directory means a file was added or removed; either way the
    // set has to be rebuilt rather than patched.
    if (mtime !== this.dirMtime) {
      this.dirMtime = mtime;
      for (const key of [...this.cache.keys()]) {
        if (!files.includes(key)) this.cache.delete(key);
      }
    }

    const out: T[] = [];
    for (const f of files) {
      const path = join(this.dir, f);
      const fm = statSync(path).mtimeMs;
      const hit = this.cache.get(f);
      if (hit && hit.mtime === fm) { out.push(hit.doc); continue; }
      try {
        const doc = JSON.parse(readFileSync(path, 'utf8')) as T;
        this.cache.set(f, { doc, mtime: fm });
        out.push(doc);
      } catch (e) {
        // One malformed file must not take the whole catalogue down.
        console.error(`  skipping ${f}: ${e instanceof Error ? e.message : 'unreadable'}`);
      }
    }
    return out;
  }

  get(predicate: (doc: T) => boolean): T | null {
    return this.all().find(predicate) ?? null;
  }

  put(doc: T, previousName?: string): void {
    // A rename leaves the old file behind unless it is removed explicitly.
    if (previousName && previousName !== this.nameOf(doc)) {
      const old = join(this.dir, `${previousName}.json`);
      if (existsSync(old)) rmSync(old);
      this.cache.delete(`${previousName}.json`);
    }
    const file = this.fileFor(doc);
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n');
    renameSync(tmp, file);
    this.cache.delete(`${this.nameOf(doc)}.json`);
    this.dirMtime = -1;
  }

  remove(doc: T): boolean {
    const file = this.fileFor(doc);
    if (!existsSync(file)) return false;
    rmSync(file);
    this.cache.delete(`${this.nameOf(doc)}.json`);
    this.dirMtime = -1;
    return true;
  }

  invalidate(): void {
    this.cache.clear();
    this.dirMtime = -1;
  }
}
