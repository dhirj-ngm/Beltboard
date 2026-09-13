# Belt Board

A production board for the factory's centre hall, styled like a railway station
arrivals board.

The operator picks a belt and types three things — **belt size**, **machine**, and
**model number**. The TV in the centre hall shows every belt in a large table and
updates the moment the operator saves.

## How it's wired

One PC, one cable, one TV.

- The operator's PC runs this app.
- The TV is connected to that PC as a **second display** (one HDMI cable).
- The app puts the entry form on the operator's monitor and the board full-screen
  on the TV, by itself. Plugging the TV in is enough — nobody opens anything on it.

There is no server, no database, no network and no login.

> **Windows display setting:** the two screens must be set to **Extend these
> displays**, not *Duplicate*. Duplicate would show the operator's form on the TV.

## What the operator does

| Belt shows | Operator can |
|---|---|
| Free | Fill in the three fields → **Put on board** |
| Under construction | Correct any of the three fields → **Save changes**, or **Mark completed**, or **Clear belt** |
| Completed | Stays on the board as completed. Filling in the fields → **Put next machine on board** replaces it |

- Machine names and model numbers typed before are offered as suggestions next
  time, most recent first.
- **Mark completed** and **Clear belt** need a second tap within three seconds, so a
  stray tap on a busy floor changes nothing.
- The header shows whether the TV is connected — *No TV detected* means check the
  cable.

## What is and isn't kept

Only what is on the board **right now** is saved on the PC, so it comes back after
a power cut instead of the hall going blank. When an entry is replaced, the old one
is gone. There is no history and no report — by design.

The saved file is written safely (write, then rename), so a power cut mid-save
leaves the previous board intact. If the file is ever damaged it is set aside, not
overwritten, and the board starts empty.

## Development

```
npm install
npm start      # opens both windows; with one screen the board opens in a normal window
npm test       # the board's rules: entries, editing, completion, validation, recovery
```

Electron downloads its own binary the first time it runs.

## Shipping to the client

The Windows installer is built by GitHub Actions on a real Windows machine
(`.github/workflows/release.yml`), not locally — the NSIS installer step needs
Windows.

```
# 1. bump "version" in package.json and commit it, then:
git tag v0.1.0
git push origin main --tags

# 2. wait for the build (a few minutes)
gh run watch

# 3. the installer is attached to a DRAFT release — invisible until published
gh release view v0.1.0

# 4. ship it: publishing makes the download link public
gh release edit v0.1.0 --draft=false
```

The client downloads `BeltBoard-Setup-<version>.exe` from the release page and
runs it: it installs for the current user, puts a shortcut on the desktop, opens
the app, and starts it automatically every time Windows signs in.

Windows may show a *"Windows protected your PC"* warning, because the installer
is not code-signed. **More info → Run anyway** gets past it. Signing needs a paid
certificate and can be added later.

## Layout

```
src/
  board-state.js     every rule for changing the board (no Electron — tested with plain Node)
  main.js            the two windows, finding the TV, saving to disk
  preload.js         the small bridge the screens are allowed to use
  renderer/
    operator.*       the entry form
    board.*          the station board
    fonts/           bundled fonts, so nothing is fetched from the internet
tests/
  board-state.test.js
```

The number of belts is `BELT_COUNT` in `src/board-state.js` (currently 10).

## Fonts

DotGothic16 and Share Tech Mono are bundled under the SIL Open Font License; the
licence files sit next to the fonts in `src/renderer/fonts/`.
