import { join } from 'node:path';
import { ROOT } from '../config.ts';
import { DirStore } from './dir-store.ts';
import { JsonStore } from './json-store.ts';
import type { Category, Product } from '../types.ts';

/**
 * One place the scripts get at the catalogue, so the storage shape is decided
 * here rather than in eight different files.
 */
export const products = new DirStore<Product>(join(ROOT, 'data', 'products'), (p) => p.slug);

export const categories = new JsonStore<Category[]>(join(ROOT, 'data', 'categories.json'), () => []);

/** Finds by slug or id, the two things a human types. */
export function findProduct(key: string): Product | null {
  return products.get((p) => p.slug === key || p.id === key);
}

/** Applies a change and keeps the filename in step with the slug. */
export function saveProduct(next: Product, previousSlug?: string): Product {
  const stamped = { ...next, updatedAt: new Date().toISOString() };
  products.put(stamped, previousSlug);
  return stamped;
}
