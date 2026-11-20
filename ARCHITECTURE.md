# Piano architecture

The map of the code. A file added, removed or renamed, or a flow changed,
is updated here in the same change.

## How it fits

A lesson is Markdown. `app.js` renders it with markdown-it; each `abc`
block and each piece link becomes something you can start. Starting one
calls `practice.load(target)`, which:

1. draws the score with an adapter from `score.js` (abcjs or OSMD), which
   also returns the **song**: notes `{midi, ms, dur, hand, finger, tied, measure}`
   grouped into steps by `music.song()`;
2. hands the song to the **engine**, a pure state machine: time comes in
   (`update(now)`, `noteOn(midi, now)`), events come out (`drain()`), so
   the tests replay it without a browser;
3. turns the events into sound (`synth.js` or MIDI out), score marks and
   falling notes (`roll.js`, `timeline.js`), drawn in one
   requestAnimationFrame loop that stops when nothing moves.

## Files

```
index.html           the page: its Content-Security-Policy first, then the scripts in load order
manifest.json        the web app manifest
icon.svg             the app icon
sw.js                the service worker: the files for offline use (ASSETS)
src/app.js           the app: screens, lesson rendering, transport, settings; APP_VERSION
src/styles.css       the tokens per theme, then the styles
src/icons.js         Lucide icons, one map
src/music.js         note names, the song model (steps, beats, bars), transpose
src/hands.js         which hand plays each note of a one-track MIDI file (pure)
src/midifile.js      reads and writes Standard MIDI Files; skips empty lead-in bars
src/lesson.js        front matter, block options, links: everything about lesson text
src/engine.js        the practice engine: wait/flow/recital/watch, hands, loops, metronome, results
src/recital.js       recital scoring: points, combo, stars (pure, fed the engine's events)
src/touch.js         what comes from the piano first: touch curve, light-touch floor, double notes, port names, key delay (pure)
src/midi.js          Web MIDI in and out, lit keys, and the computer keyboard as a piano; SysEx on request
src/instrument.js    the piano's own panel: Roland's app protocol (RQ1/DT1 to model 00 00 00 28), standard MIDI, the learn log
src/synth.js         the app's piano: Salamander samples (made sound until they load), pedal, room
src/sounds/piano/    30 Salamander Grand Piano MP3s (CC-BY 3.0, LICENSE.md), one every 3 semitones
src/score.js         score adapters: abcjs, OSMD, none; each returns a song
src/roll.js          falling notes and the keyboard, one canvas
src/timeline.js      the bars strip: seek, drag a loop
src/layout.js        the panel split tree: normalise, place, resize, render
src-tauri/src/portable.rs  where the data lives (beside the exe by default) and the in-place updater
src/menus.js         the menu bar: menus built on open, Alt+letter, arrows, Esc
src/library.js       courses: built-in, folders (File System Access), single files
src/practice.js      one practice session: engine + score + roll + sound; transpose, auto speed-up, free play
src/progress.js      time per day, runs, best tempo and weak bars (pure, over a store)
src/hotkeys.js       rebindable shortcuts, computer keys and piano keys (pure)
src/recorder.js      what you play, as notes for midifile.write; layers keep their start
src/theme.js         the colour editor's tokens, its JSON and the readability check
src/pdfview.js       the book panel: pdf.js, loaded the first time a book opens
src/plan.js          a piece's practice plan: sections × hands × speeds (pure)
src/chords.js        names the chord under your fingers, and a song's chords beat by beat (pure)
src/takes.js         a run's notes for replay, loud-and-soft judging, the replay scheduler
src/abcwrite.js      writing ABC: a note in a key (bar accidentals carried); sight-reading, scale, chord, rhythm and ear exercises (pure)
src/editor.js        the lesson editor: text, drafts, notes from the piano into the music block
src/effects.js       glow over held keys and sparks where notes land (roll.setEffects)
src/vendor/          abcjs, osmd, markdown-it, pdfjs, each with its licence
src/keel/            from keel: errlog, platform, i18n, releases, motion (+ unused qr, github, drive)
lessons/             the built-in courses, getting-started (with an example PDF book), first-year and songs; index.json lists them
test/                engine, lesson, layout, progress, hotkeys, recorder, theme, abcwrite, score, plan, keys and keel's checks; run-all.js runs them
server.js            the local server: this computer only (from keel)
tools/build-www.js   copies sw.js's ASSETS into www-desktop/ for Tauri
tools/               release.js, keel-sync.js, keel-checks.js (from keel)
package.json         the Tauri CLI only
src-tauri/           the Windows app: one window on the same files, MIDI allowed
.github/workflows/   tests; desktop.yml builds the Windows zip and publishes a release when APP_VERSION is new
```

www-desktop/ and src-tauri's icons are made in CI, never committed.

The files listed in `keel.lock.json` come from keel and are never edited
here: fix them in keel, release it, then `node tools/keel-sync.js v<x.y.z>`.

## Trade-offs

- **`style-src 'unsafe-inline'`.** abcjs and OSMD set style attributes on
  the SVG they draw, and OSMD uses `new Function`. Scripts stay `'self'`
  only, so injected script still can't run; injected styles could.
  `test/csp.test.js` expects exactly these findings and no others.
- **MIDI is granted without asking** in the Windows app
  (`main.rs`, `on_permission_request`). The window only ever loads the
  app's own files.
- **SysEx is asked for when Piano controls opens**, not at the start
  (`midi.allowSysex`). In the Windows app the existing MIDI grant already
  covers it: wry's `PermissionKind::Midi` is WebView2's
  `MIDI_SYSTEM_EXCLUSIVE_MESSAGES` permission. With SysEx a page could
  also send a piano messages that change or reset its settings; the
  window only loads the app's own files.
- **Roland's app protocol is unpublished.** The address map is what
  others saw Roland's app send an FP-10 and FP-30 (fp30remote, GPL-3;
  roland-piano, MIT): facts only, our own code. Connecting turns the
  piano's remote mode on (01000306) and its change reports on (01000300),
  as Roland's app does; leaving the app turns both off (`pagehide`). A
  crash leaves them on until the piano is switched off, which only means
  it sends a few extra SysEx messages.
- **Folders are read and written through File System Access.** The app
  keeps the folder handles in IndexedDB; Windows asks again after a
  restart when the permission lapsed.
- **No installer; the zip updates itself** (`portable.rs`). It reads the
  latest release from GitHub's API without a token, so the repo's releases
  must be public. It installs only a Piano.exe whose minisign signature
  matches `src-tauri/updater.pub`; the private key is the
  `TAURI_SIGNING_PRIVATE_KEY` secret, used only by desktop.yml. A copy in a
  read-only folder (Program Files) can't update and says so.
- **Data beside the exe by default.** Anyone who can read the folder can
  read the progress and settings in `Data\EBWebView`. Settings → About can
  move it to AppData or another folder; the move copies and leaves the old
  copy, so nothing is lost if it fails half-way.
- **English only.** keel's i18n is loaded but there is no second language.
- **Progress lives in this computer's storage** (localStorage
  `piano.progress`), not in the lesson folders: built-in lessons have no
  folder, and a folder can be shared. Settings → Your progress saves and
  loads a copy.
- **pdf.js is an ES module**, loaded with `import()` the first time a book
  opens, and runs in a module worker (`worker-src 'self'`). Font eval is
  off (`isEvalSupported: false`).
- **Lesson drafts** are kept in localStorage (`piano.draft:<course>|<path>`)
  until saved, so a crash or closing the editor doesn't lose them.
- **Lit keys** are note-ons at velocity 1 on the channel picked in
  Settings. A keyboard that sounds that channel plays them very softly.
- **A pasted colour theme** can only set the known colour tokens to plain
  `#rrggbb` values (`theme.clean`), so it can't restyle anything else.
- **Piano samples** (~2 MB) ship with the app, so the sound works offline.
  One velocity layer only: soft notes are the same recording, quieter and
  through a lowpass.
- **Vendored libraries** (~2.5 MB) instead of a bundle, so there's still
  no build step. Updating one is replacing its file.

## Traps

- portable.rs decides the data folder before the window opens: the window
  is built in `setup()` with `data_directory`, not in tauri.conf.json
  (whose `windows` list is empty). The WebView keeps its files open while
  it runs, so a move is written to piano-data.json and done on the next
  start.
- The updater swaps exes by renaming the running one to Piano.exe.old and
  starts the new one through `cmd` a second later, after this one has
  exited; started straight away, the one-copy check would hand it back to
  the old process.
- `settings.lookVersion`: the first start on the desktop look (2) drops
  the saved panel layout and turns "system" into dark. Bump it only for a
  change that needs the same reset.
- The score's SVG text takes the CSS `color`, so `.score-abc`/`.score-xml`
  set `color: var(--score-ink)`; without it titles draw in the UI's text
  colour on the paper.
- menus.js listens for keys in the capture phase after app.js's shortcut
  handler, so that handler returns while a menu is open (`menu.open`).

- The app's panels: `PANELS` in app.js names them; a saved layout with an
  unknown panel drops it (`layout.normalize`), so renaming one resets it
  for everyone.
- The editor writes notes in the block's key and carries accidentals
  from the start of the bar to the cursor, but doesn't check the bar's
  length: a bar can overflow.
- A run where the app played every hand isn't recorded as progress, or
  every listen would be a "100% right" best tempo.

- OSMD's `halfTone` is MIDI − 12; its timestamps are in whole notes.
  Tempo comes from `SourceMeasures[i].TempoInBPM` (0 means no change) and
  `score.tempoMap` turns whole notes into ms through each change.
- The timing delay (`engine.setLatency`) only moves judging: a note is
  taken as played that many ms earlier. The song and the sound don't move.
- abcjs `visualTranspose` redraws the score but leaves its audio pitches
  written, so practice.js still transposes the song itself: don't add
  `midiTranspose` too, or the notes move twice.
- Dynamics: abcjs gives each note a volume (with beat accents of ±10);
  OSMD's are read from `SourceMeasures[].StaffLinkedExpressions` and
  their `instantaneousDynamic.Volume` (0–1). Music with less than 25
  between its softest and loudest note isn't judged for loud and soft.
- Review dates are day keys (`YYYY-MM-DD`) compared as strings, which
  sorts right only because they're zero-padded.
- A rhythm drill maps every key to `abcwrite.TAP` in `routeNote`, before
  the engine sees it.
- `music.transpose` rebuilds the song; it copies the steps' `measure` and
  a MIDI file's `tracks` back on, since the weak bars and the tracks panel
  read them.
- Key times are the MIDI message's `timeStamp` (same clock as
  `performance.now()`), not when the handler ran; one more than 1 s off
  falls back to now.
- Touch response, the light-touch floor and the double-note filter run in
  midi.js before `routeNote`; a dropped press also drops one release of
  that key, or the note would end early or hang.
- The master has a soft clip (a WaveShaper), not a compressor: a
  DynamicsCompressor delays everything through it about 6 ms.
- The hand split and the skipped bars happen in `midifile.parse`, so a
  setting changed while a file is open applies from the next one opened.
- Piano controls redraw only when the panel's shape changes (found the
  piano, another keyboard mode); a value the piano reports moves its
  control in place, and never the slider that has focus, or a drag would
  jump back while the piano's echo is on its way.
- The piano's messages are matched to its out port by name
  (`touch.deviceName`), since Web MIDI gives inputs and outputs different
  ids.
- abcjs note timings are matched to notes by `startChar`, not by order.
- Wait mode credits the next required note even when pressed early and
  jumps the song to it; flow mode only within 250 ms.
- `.abc-preview svg` must keep abcjs's own height, or the preview
  collapses.
