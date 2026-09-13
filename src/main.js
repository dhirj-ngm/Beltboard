'use strict';

const { app, BrowserWindow, ipcMain, Menu, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const {
  EntryError,
  clearBelt,
  completeEntry,
  emptyState,
  normalizeState,
  saveEntry,
} = require('./board-state');

/**
 * One PC, two screens.
 *
 * The operator's monitor gets the entry form. The TV — the second display, on
 * the one cable to the centre hall — gets the board, full-screen. There is no
 * server and no network: both windows live in this process, and this file holds
 * the only copy of the board.
 */

// A second copy would keep its own board and fight this one over the saved file.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  start();
}

function start() {
  let state = emptyState();
  let operatorWin = null;
  let boardWin = null;
  let quitting = false;

  const stateFile = () => path.join(app.getPath('userData'), 'board.json');

  function loadState() {
    const file = stateFile();
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') console.error('Could not read the saved board:', error.message);
      return emptyState();
    }
    try {
      return normalizeState(JSON.parse(text));
    } catch (error) {
      // Keep the unreadable file for inspection rather than overwriting it on the
      // next save and losing the evidence.
      const aside = `${file}.unreadable-${Date.now()}`;
      try {
        fs.renameSync(file, aside);
      } catch {
        // Nothing more to do; start empty either way.
      }
      console.error(`The saved board was unreadable and was moved to ${aside}:`, error.message);
      return emptyState();
    }
  }

  // Not history: only what is on the board right now, so it comes back after a
  // power cut instead of the hall going blank.
  function persist() {
    const file = stateFile();
    const temp = `${file}.tmp`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Write-then-rename: a power cut mid-save leaves the previous board intact
    // instead of a half-written file.
    fs.writeFileSync(temp, JSON.stringify(state));
    fs.renameSync(temp, file);
  }

  function send(channel, payload) {
    for (const win of [operatorWin, boardWin]) {
      if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
    }
  }

  function tvDisplay() {
    const primary = screen.getPrimaryDisplay();
    return screen.getAllDisplays().find((d) => d.id !== primary.id) ?? null;
  }

  const displayStatus = () => ({ tvConnected: tvDisplay() !== null });

  // Runs at start and whenever a screen appears or disappears. Connecting the TV
  // is what puts the board on it — nobody has to open or arrange anything.
  function placeBoard() {
    if (!boardWin || boardWin.isDestroyed()) return;
    const tv = tvDisplay();
    if (tv) {
      boardWin.setFullScreen(false);
      boardWin.setBounds(tv.bounds);
      boardWin.setFullScreen(true);
      // Never take keyboard focus away from the operator's form.
      boardWin.showInactive();
    } else if (!app.isPackaged) {
      // Developing on a single screen: show the board in an ordinary window.
      boardWin.setFullScreen(false);
      boardWin.setBounds({ width: 1280, height: 720 });
      boardWin.center();
      boardWin.showInactive();
    } else {
      boardWin.hide();
    }
    send('display:status', displayStatus());
  }

  function apply(event, change) {
    if (!operatorWin || event.sender !== operatorWin.webContents) {
      return { ok: false, error: 'Only the operator screen can change the board.' };
    }

    let next;
    try {
      next = change(state);
    } catch (error) {
      if (error instanceof EntryError) return { ok: false, error: error.message };
      throw error;
    }

    state = next;
    // Update the TV first: a disk problem must not stop the hall seeing the change.
    send('board:state', state);

    try {
      persist();
      return { ok: true, state };
    } catch (error) {
      console.error('Could not save the board to disk:', error);
      return {
        ok: true,
        state,
        warning:
          'The board is updated, but it could not be saved on this computer. It will be lost if the power goes off.',
      };
    }
  }

  ipcMain.handle('board:get', () => state);
  ipcMain.handle('display:get', () => displayStatus());
  ipcMain.handle('board:save', (event, input) => apply(event, (s) => saveEntry(s, input)));
  ipcMain.handle('board:complete', (event, belt) => apply(event, (s) => completeEntry(s, belt)));
  ipcMain.handle('board:clear', (event, belt) => apply(event, (s) => clearBelt(s, belt)));

  const webPreferences = {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  };

  // Both screens are local files and stay that way: no navigating away, no popups.
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event) => event.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  });

  app.on('second-instance', () => {
    if (!operatorWin) return;
    if (operatorWin.isMinimized()) operatorWin.restore();
    operatorWin.focus();
  });

  app.whenReady().then(() => {
    state = loadState();
    Menu.setApplicationMenu(null);

    if (app.isPackaged && (process.platform === 'win32' || process.platform === 'darwin')) {
      // The operator's PC boots straight into the board.
      app.setLoginItemSettings({ openAtLogin: true });
    }

    operatorWin = new BrowserWindow({
      width: 1180,
      height: 780,
      minWidth: 900,
      minHeight: 620,
      title: 'Belt Board — Operator',
      backgroundColor: '#eceef1',
      webPreferences,
    });
    operatorWin.loadFile(path.join(__dirname, 'renderer', 'operator.html'));
    operatorWin.on('closed', () => {
      operatorWin = null;
      quitting = true;
      app.quit();
    });

    boardWin = new BrowserWindow({
      show: false,
      title: 'Belt Board',
      backgroundColor: '#050506',
      webPreferences,
    });
    boardWin.loadFile(path.join(__dirname, 'renderer', 'board.html'));
    // Closing the TV window by accident — Alt+F4 with the wrong window focused —
    // must not blank the hall. It closes only when the whole app quits.
    boardWin.on('close', (event) => {
      if (!quitting) event.preventDefault();
    });
    boardWin.webContents.once('did-finish-load', placeBoard);

    for (const change of ['display-added', 'display-removed', 'display-metrics-changed']) {
      screen.on(change, placeBoard);
    }
  });

  app.on('before-quit', () => {
    quitting = true;
  });
  app.on('window-all-closed', () => app.quit());
}
