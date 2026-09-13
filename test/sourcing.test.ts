import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rekeyVariants, type VariantSourcing } from '../src/lib/sourcing.ts';

/**
 * The catalogue shows your SKU and says nothing about who makes the piece.
 * That is deliberate — and it means this map is the only thing standing
 * between a paid order and a reorder you cannot place.
 */
const table: Record<string, VariantSourcing> = {
  'EAR-GOL-FX9162': { supplierSku: 'FX916-2', supplierSkuId: '109560468717', costPaise: 15398 },
  'EAR-GOL-A19': { supplierSku: 'A-19', costPaise: 40210 },
};

test('a SKU change carries the supplier reference with it', () => {
  const { variants, moved } = rekeyVariants(table, {
    'EAR-GOL-FX9162': 'HOO-STU-GOLDMI',
    'EAR-GOL-A19': 'HOO-STU-GOLDPE',
  });
  assert.equal(moved, 2);
  assert.equal(variants['HOO-STU-GOLDMI']!.supplierSku, 'FX916-2');
  assert.equal(variants['HOO-STU-GOLDMI']!.supplierSkuId, '109560468717');
  assert.equal(variants['HOO-STU-GOLDPE']!.costPaise, 40210);
  assert.equal(variants['EAR-GOL-FX9162'], undefined, 'the old key should be gone');
});

test('SKUs that did not move are left alone', () => {
  const { variants, moved } = rekeyVariants(table, { 'EAR-GOL-A19': 'NEW-A19' });
  assert.equal(moved, 1);
  assert.equal(variants['EAR-GOL-FX9162']!.supplierSku, 'FX916-2');
  assert.equal(variants['NEW-A19']!.supplierSku, 'A-19');
});

test('an empty move set changes nothing', () => {
  const { variants, moved } = rekeyVariants(table, {});
  assert.equal(moved, 0);
  assert.deepEqual(Object.keys(variants), Object.keys(table));
});
