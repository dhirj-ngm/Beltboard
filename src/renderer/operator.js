'use strict';

// The operator's screen: pick a belt, type three things, and the TV follows.

const api = window.beltBoard;
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');

let state = null;
let selected = 1;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const entryOf = (belt) => state.belts.find((b) => b.belt === belt)?.entry ?? null;

function statusOf(entry) {
  if (!entry) return { key: 'free', label: 'Free' };
  return entry.status === 'completed'
    ? { key: 'done', label: 'Completed' }
    : { key: 'building', label: 'Under construction' };
}

function renderBelts() {
  const buttons = state.belts.map((belt) => {
    const entry = belt.entry;
    const status = statusOf(entry);
    const button = el('button', `belt-btn${belt.belt === selected ? ' selected' : ''}`);
    button.type = 'button';
    button.dataset.status = status.key;
    button.setAttribute('aria-pressed', String(belt.belt === selected));
    button.append(
      el('span', 'belt-num', pad(belt.belt)),
      el('span', 'belt-text', entry ? `${entry.machine} · ${entry.model}` : 'No machine'),
      el('span', `chip ${status.key}`, status.label),
    );
    button.addEventListener('click', () => select(belt.belt));
    return button;
  });
  $('belts').replaceChildren(...buttons);
}

function renderSuggestions() {
  const options = (list) => list.map((value) => {
    const option = document.createElement('option');
    option.value = value;
    return option;
  });
  $('machine-list').replaceChildren(...options(state.suggestions.machines));
  $('model-list').replaceChildren(...options(state.suggestions.models));
}

function setFields(size, machine, model) {
  $('size').value = size;
  $('machine').value = machine;
  $('model').value = model;
}

/** `fillForm` is false for background refreshes, so typing is never wiped out. */
function renderPanel(fillForm) {
  const entry = entryOf(selected);
  $('belt-label').textContent = `Belt ${pad(selected)}`;
  disarmAll();

  if (!entry) {
    $('belt-title').textContent = 'No machine on this belt';
    $('belt-note').textContent = 'Fill in the three details and put it on the board.';
    $('save').textContent = 'Put on board';
    $('complete').hidden = true;
    $('clear').hidden = true;
    if (fillForm) setFields('', '', '');
  } else if (entry.status === 'building') {
    $('belt-title').textContent = `${entry.machine} · ${entry.model}`;
    $('belt-note').textContent =
      'Under construction. You can correct the details until it is marked completed.';
    $('save').textContent = 'Save changes';
    $('complete').hidden = false;
    $('clear').hidden = false;
    if (fillForm) setFields(String(entry.size), entry.machine, entry.model);
  } else {
    $('belt-title').textContent = `${entry.machine} · ${entry.model} — completed`;
    $('belt-note').textContent =
      'This stays on the board as completed until you put the next machine on this belt.';
    $('save').textContent = 'Put next machine on board';
    $('complete').hidden = true;
    $('clear').hidden = true;
    if (fillForm) setFields('', '', '');
  }
}

function renderAll(fillForm) {
  renderBelts();
  renderSuggestions();
  renderPanel(fillForm);
}

function showMessage(text, kind) {
  const message = $('message');
  message.textContent = text;
  message.dataset.kind = kind;
}

function select(belt) {
  selected = belt;
  showMessage('', '');
  renderAll(true);
  $('size').focus();
}

function afterChange(result, success) {
  if (!result.ok) {
    showMessage(result.error, 'error');
    return;
  }
  state = result.state;
  renderAll(true);
  showMessage(result.warning ?? success, result.warning ? 'error' : 'ok');
}

// Completing or clearing can't be undone, so each needs a second tap within a
// few seconds. One tap by accident on a busy floor does nothing.
const armLabels = { complete: 'Tap again to mark completed', clear: 'Tap again to clear' };
const restLabels = { complete: 'Mark completed', clear: 'Clear belt' };
const timers = {};

function disarm(id) {
  clearTimeout(timers[id]);
  const button = $(id);
  delete button.dataset.armed;
  button.textContent = restLabels[id];
}

function disarmAll() {
  disarm('complete');
  disarm('clear');
}

function armOrRun(id, action) {
  const button = $(id);
  // Checked as a string on purpose: an empty data-armed value is falsy, which
  // once made the second tap re-arm the button instead of confirming it.
  if (button.dataset.armed !== 'true') {
    disarmAll();
    button.dataset.armed = 'true';
    button.textContent = armLabels[id];
    timers[id] = setTimeout(() => disarm(id), 3000);
    return;
  }
  disarm(id);
  action();
}

$('entry-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const result = await api.save({
    belt: selected,
    size: $('size').value,
    machine: $('machine').value,
    model: $('model').value,
  });
  afterChange(result, `Belt ${pad(selected)} is on the board.`);
});

$('complete').addEventListener('click', () =>
  armOrRun('complete', async () => {
    afterChange(await api.complete(selected), `Belt ${pad(selected)} is marked completed.`);
  }),
);

$('clear').addEventListener('click', () =>
  armOrRun('clear', async () => {
    afterChange(await api.clear(selected), `Belt ${pad(selected)} is cleared.`);
  }),
);

function showDisplay({ tvConnected }) {
  const tv = $('tv');
  tv.dataset.connected = tvConnected ? 'yes' : 'no';
  tv.textContent = tvConnected ? 'TV connected' : 'No TV detected — check the cable';
}

api.get().then((initial) => {
  state = initial;
  renderAll(true);
  $('size').focus();
});
api.onState((next) => {
  state = next;
  renderBelts();
  renderSuggestions();
  renderPanel(false);
});
api.getDisplay().then(showDisplay);
api.onDisplay(showDisplay);

const clockFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const tick = () => {
  $('clock').textContent = clockFormat.format(new Date());
};
tick();
setInterval(tick, 15000);
