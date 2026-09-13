'use strict';

/**
 * Everything the board knows, and the only rules for changing it.
 *
 * Kept free of Electron so it can be tested with plain Node. The main process
 * owns the single copy of this state; both windows only ever receive it.
 *
 * There is deliberately no history. Each belt holds at most one entry, and a new
 * entry on a completed belt replaces it outright — the client asked for a live
 * display, not a record.
 */

const BELT_COUNT = 10;
const MAX_TEXT = 40;
const MAX_SIZE = 99999;
const MAX_SUGGESTIONS = 30;

class EntryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EntryError';
  }
}

function emptyState(beltCount = BELT_COUNT) {
  return {
    belts: Array.from({ length: beltCount }, (_, i) => ({ belt: i + 1, entry: null })),
    suggestions: { machines: [], models: [] },
  };
}

function cleanText(value, label) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!text) throw new EntryError(`Enter the ${label}.`);
  if (text.length > MAX_TEXT) {
    throw new EntryError(`Keep the ${label} to ${MAX_TEXT} characters or fewer.`);
  }
  return text;
}

function cleanSize(value) {
  let size;
  if (typeof value === 'number') {
    size = value;
  } else {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) throw new EntryError('Enter the belt size.');
    // Digits with an optional decimal part only. Number() alone would also accept
    // things like "1e3" or "0x10", which no one on the floor means.
    if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
      throw new EntryError('Enter the belt size as a number, like 12 or 12.5.');
    }
    size = Number(raw);
  }
  if (!Number.isFinite(size) || size <= 0) {
    throw new EntryError('Belt size must be more than zero.');
  }
  if (size > MAX_SIZE) throw new EntryError(`Belt size can't be more than ${MAX_SIZE}.`);
  return Math.round(size * 100) / 100;
}

function findBelt(state, belt) {
  const number = Number(belt);
  const index = state.belts.findIndex((b) => b.belt === number);
  if (index === -1) throw new EntryError(`There is no belt ${belt}.`);
  return index;
}

function withEntry(state, index, entry) {
  const belts = state.belts.slice();
  belts[index] = { ...belts[index], entry };
  return { ...state, belts };
}

/** Most recent first, one copy regardless of capitalisation. */
function remember(list, value) {
  const key = value.toLowerCase();
  return [value, ...list.filter((item) => item.toLowerCase() !== key)].slice(0, MAX_SUGGESTIONS);
}

/**
 * Puts a machine on a belt.
 *
 * On a belt that is empty or shows a completed machine, this starts the next
 * machine and replaces what was shown. On a machine still under construction it
 * corrects the details — which is the only time editing is allowed.
 */
function saveEntry(state, input, now = new Date()) {
  const index = findBelt(state, input?.belt);
  const size = cleanSize(input?.size);
  const machine = cleanText(input?.machine, 'machine name');
  const model = cleanText(input?.model, 'model number');

  const updated = withEntry(state, index, {
    size,
    machine,
    model,
    status: 'building',
    updatedAt: now.toISOString(),
  });

  return {
    ...updated,
    suggestions: {
      machines: remember(state.suggestions.machines, machine),
      models: remember(state.suggestions.models, model),
    },
  };
}

function completeEntry(state, belt, now = new Date()) {
  const index = findBelt(state, belt);
  const entry = state.belts[index].entry;
  if (!entry || entry.status !== 'building') {
    throw new EntryError(`Nothing is under construction on belt ${belt}.`);
  }
  return withEntry(state, index, { ...entry, status: 'completed', updatedAt: now.toISOString() });
}

function clearBelt(state, belt) {
  const index = findBelt(state, belt);
  if (!state.belts[index].entry) throw new EntryError(`Belt ${belt} is already empty.`);
  return withEntry(state, index, null);
}

/**
 * Rebuilds a board from whatever was saved on disk.
 *
 * The file survives power cuts, so it can be damaged. A bad entry is dropped on
 * its own rather than taking the whole board down, and anything unrecognisable
 * gives an empty board instead of a crash.
 */
function normalizeState(raw, beltCount = BELT_COUNT) {
  const state = emptyState(beltCount);
  if (!raw || typeof raw !== 'object') return state;

  for (const item of Array.isArray(raw.belts) ? raw.belts : []) {
    const index = state.belts.findIndex((b) => b.belt === item?.belt);
    if (index === -1 || !item.entry || typeof item.entry !== 'object') continue;
    try {
      const saved = item.entry;
      state.belts[index].entry = {
        size: cleanSize(saved.size),
        machine: cleanText(saved.machine, 'machine name'),
        model: cleanText(saved.model, 'model number'),
        status: saved.status === 'completed' ? 'completed' : 'building',
        updatedAt: typeof saved.updatedAt === 'string' ? saved.updatedAt : new Date(0).toISOString(),
      };
    } catch {
      // Damaged entry: leave the belt empty.
    }
  }

  const names = (list) =>
    Array.isArray(list)
      ? list
          .filter((v) => typeof v === 'string' && v.trim() && v.length <= MAX_TEXT)
          .slice(0, MAX_SUGGESTIONS)
      : [];
  state.suggestions = {
    machines: names(raw.suggestions?.machines),
    models: names(raw.suggestions?.models),
  };
  return state;
}

module.exports = {
  BELT_COUNT,
  MAX_SUGGESTIONS,
  EntryError,
  clearBelt,
  completeEntry,
  emptyState,
  normalizeState,
  saveEntry,
};
