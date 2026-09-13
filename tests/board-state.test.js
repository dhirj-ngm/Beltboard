'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  BELT_COUNT,
  MAX_SUGGESTIONS,
  EntryError,
  clearBelt,
  completeEntry,
  emptyState,
  normalizeState,
  saveEntry,
} = require('../src/board-state');

const NOW = new Date('2026-09-14T09:30:00.000Z');
const entry = (overrides = {}) => ({
  belt: 3,
  size: '12',
  machine: 'Platform Scale',
  model: 'PS-500',
  ...overrides,
});
const beltOf = (state, belt) => state.belts.find((b) => b.belt === belt).entry;

test('starts with every belt empty', () => {
  const state = emptyState();
  assert.equal(state.belts.length, BELT_COUNT);
  assert.ok(state.belts.every((b) => b.entry === null));
  assert.deepEqual(state.belts.map((b) => b.belt), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('putting a machine on an empty belt shows it under construction', () => {
  const state = saveEntry(emptyState(), entry(), NOW);
  assert.deepEqual(beltOf(state, 3), {
    size: 12,
    machine: 'Platform Scale',
    model: 'PS-500',
    status: 'building',
    updatedAt: NOW.toISOString(),
  });
});

test('details can be corrected while the machine is under construction', () => {
  let state = saveEntry(emptyState(), entry(), NOW);
  state = saveEntry(state, entry({ size: '14', model: 'PS-600' }), NOW);
  const current = beltOf(state, 3);
  assert.equal(current.size, 14);
  assert.equal(current.model, 'PS-600');
  assert.equal(current.status, 'building');
});

test('marking completed keeps the machine on the board', () => {
  let state = saveEntry(emptyState(), entry(), NOW);
  state = completeEntry(state, 3, NOW);
  const current = beltOf(state, 3);
  assert.equal(current.status, 'completed');
  assert.equal(current.machine, 'Platform Scale');
});

test('the next entry on a completed belt replaces it', () => {
  let state = saveEntry(emptyState(), entry(), NOW);
  state = completeEntry(state, 3, NOW);
  state = saveEntry(state, entry({ size: '8', machine: 'Bench Scale', model: 'BS-30' }), NOW);
  assert.deepEqual(
    { ...beltOf(state, 3), updatedAt: undefined },
    { size: 8, machine: 'Bench Scale', model: 'BS-30', status: 'building', updatedAt: undefined },
  );
});

test('only a machine under construction can be marked completed', () => {
  assert.throws(() => completeEntry(emptyState(), 3), EntryError);
  const done = completeEntry(saveEntry(emptyState(), entry()), 3);
  assert.throws(() => completeEntry(done, 3), EntryError);
});

test('clearing a belt removes its entry, and an empty belt cannot be cleared', () => {
  const state = clearBelt(saveEntry(emptyState(), entry()), 3);
  assert.equal(beltOf(state, 3), null);
  assert.throws(() => clearBelt(state, 3), EntryError);
});

test('belt size must be a plain positive number', () => {
  for (const size of ['', '   ', 'abc', '0', '-4', '12,5', '1e3', '0x10', '12.345', undefined, null]) {
    assert.throws(() => saveEntry(emptyState(), entry({ size })), EntryError, `size ${String(size)}`);
  }
  assert.equal(beltOf(saveEntry(emptyState(), entry({ size: ' 12.5 ' })), 3).size, 12.5);
  assert.equal(beltOf(saveEntry(emptyState(), entry({ size: 20 })), 3).size, 20);
});

test('typed names are tidied and must not be blank or overlong', () => {
  const state = saveEntry(emptyState(), entry({ machine: '  Platform    Scale ' }));
  assert.equal(beltOf(state, 3).machine, 'Platform Scale');
  assert.throws(() => saveEntry(emptyState(), entry({ machine: '   ' })), EntryError);
  assert.throws(() => saveEntry(emptyState(), entry({ model: 'x'.repeat(41) })), EntryError);
  assert.throws(() => saveEntry(emptyState(), entry({ model: 42 })), EntryError);
});

test('a belt that does not exist is refused', () => {
  for (const belt of [0, 11, 'x', undefined]) {
    assert.throws(() => saveEntry(emptyState(), entry({ belt })), EntryError, `belt ${belt}`);
  }
});

test('typed names are remembered for next time, newest first, one copy each', () => {
  let state = saveEntry(emptyState(), entry({ belt: 1, machine: 'Bench Scale', model: 'BS-30' }));
  state = saveEntry(state, entry({ belt: 2, machine: 'Weighbridge', model: 'WB-10T' }));
  state = saveEntry(state, entry({ belt: 3, machine: 'bench scale', model: 'BS-30' }));
  assert.deepEqual(state.suggestions.machines, ['bench scale', 'Weighbridge']);
  assert.deepEqual(state.suggestions.models, ['BS-30', 'WB-10T']);
});

test('the remembered list does not grow without limit', () => {
  let state = emptyState();
  for (let i = 0; i < MAX_SUGGESTIONS + 10; i += 1) {
    state = saveEntry(state, entry({ machine: `Machine ${i}`, model: `M-${i}` }));
  }
  assert.equal(state.suggestions.machines.length, MAX_SUGGESTIONS);
  assert.equal(state.suggestions.machines[0], `Machine ${MAX_SUGGESTIONS + 9}`);
});

test('changes never alter the board they were given', () => {
  const before = emptyState();
  saveEntry(before, entry());
  assert.equal(beltOf(before, 3), null);
  assert.deepEqual(before.suggestions.machines, []);
});

test('an unreadable saved board gives an empty board, not a crash', () => {
  for (const raw of [null, 'text', 42, { belts: 'nope' }, {}]) {
    assert.deepEqual(normalizeState(raw), emptyState());
  }
});

test('a saved board keeps good entries and drops damaged ones', () => {
  const raw = {
    belts: [
      { belt: 1, entry: { size: 12, machine: 'Bench Scale', model: 'BS-30', status: 'completed', updatedAt: 'x' } },
      { belt: 2, entry: { size: -1, machine: 'Broken', model: 'B-1', status: 'building' } },
      { belt: 3, entry: { size: 8, machine: '', model: 'M-1', status: 'building' } },
      { belt: 4, entry: { size: 6, machine: 'Crane Scale', model: 'CS-2T', status: 'weird' } },
      { belt: 99, entry: { size: 6, machine: 'Ghost', model: 'G-1', status: 'building' } },
    ],
    suggestions: { machines: ['Bench Scale', 7, '', 'x'.repeat(41)], models: 'nope' },
  };
  const state = normalizeState(raw);
  assert.equal(beltOf(state, 1).status, 'completed');
  assert.equal(beltOf(state, 2), null);
  assert.equal(beltOf(state, 3), null);
  assert.equal(beltOf(state, 4).status, 'building');
  assert.equal(state.belts.length, BELT_COUNT);
  assert.deepEqual(state.suggestions, { machines: ['Bench Scale'], models: [] });
});
