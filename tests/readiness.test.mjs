import test from 'node:test';
import assert from 'node:assert/strict';
import { applyReadinessDemo, stockBreakdown, unitReadiness } from '../js/readiness.js';

test('Supabase availability is used directly and demo breakdowns stay offline', () => {
  const live = { source: 'supabase', type: 'equipment', unit: 'Emergency', name: 'Ventilator', qty: 2, status: 'available' };
  const [row] = applyReadinessDemo([live]);
  assert.deepEqual(row, live);
  assert.equal(stockBreakdown(row).available, 2);
  assert.equal(stockBreakdown(row).transferable, undefined);
  const [demo] = applyReadinessDemo([{ ...live, source: undefined }]);
  assert.equal(stockBreakdown(demo).available, 1);
});

test('missing critical stock cannot produce a ready status', () => {
  const row = { source: 'supabase', unit: 'Emergency', name: 'Ventilator', qty: 2, status: 'available' };
  assert.equal(unitReadiness([], row.unit).level, 'no-data');
  const partial = unitReadiness([row], row.unit);
  assert.equal(partial.level, 'incomplete');
  assert.match(partial.issues[0], /Defibrillator/);
  assert.equal(unitReadiness([{ ...row, qty: 0 }], row.unit).level, 'not-ready');
});
