// Piano: the app. keel's files (src/keel/) load first, then the vendored
// libraries (src/vendor/), then the app's own modules on window.Piano,
// then this, which builds the screens and wires them together:
// the library, a lesson with its practice panels, the transport bar and
// Settings.
(function () {
  const APP_VERSION = "1.0.0";
  const K = window.Keel;
  const P = window.Piano;
  const $ = (id) => document.getElementById(id);
  const icon = P.icon;

  const i18n = K.i18n.create({ key: "piano.lang", langs: ["en"], version: APP_VERSION });
  const t = i18n.t;

  // ---- settings: one object, saved as it changes ----
  const DEFAULTS = { theme: "dark", lookVersion: 2, mode: "wait", metronome: false, countIn: false, echo: false, typing: true,
    lookahead: 3, range: "song", volume: 0.7, autoVolume: 0.8, room: 0.16, output: "", layout: null, last: null,
    noteNames: "off", fingers: true, autoSpeed: false, autoSpeedGoal: 100, colors: { light: {}, dark: {} },
    keys: {}, pianoKeys: {}, bookPages: {}, effects: null, lightChannel: -1, goal: 15, latency: 0, midiHands: {}, sound: "grand",
    touch: "normal", touchFloor: 0, doubles: true, skipEmptyBars: true, prompter: true,
    drill: { type: "reading", hand: "right", range: "five", key: "C", rhythm: "quarters", bars: 4, tempo: 70, next: true, octaves: 1, count: 4, earRange: "five" } };
  const settings = (() => {
    let data = { ...DEFAULTS };
    try { data = { ...data, ...JSON.parse(localStorage.getItem("piano.settings") || "{}") }; } catch (e) { /* first run or blocked storage */ }
    // The desktop look (lookVersion 2) starts dark, with its own panel layout.
    if (data.lookVersion !== 2) { data.lookVersion = 2; data.layout = null; if (data.theme === "system") data.theme = "dark"; }
    const listeners = new Set();
    return {
      get: (k) => data[k],
      set(k, v) {
        data[k] = v;
        try { localStorage.setItem("piano.settings", JSON.stringify(data)); } catch (e) { /* kept for this session */ }
        for (const fn of listeners) fn(k, v);
      },
      on: (fn) => listeners.add(fn),
      all: () => ({ ...data }),
    };
  })();

  const layoutBtn = button("", "icon-btn", null);

  // ---- theme ----
  const dark = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  function applyTheme() {
    const pick = settings.get("theme");
    const mode = pick === "dark" || (pick === "system" && dark && dark.matches) ? "dark" : "light";
    document.documentElement.dataset.theme = mode;
    P.theme.apply(document.documentElement, (settings.get("colors") || {})[mode]);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", getComputedStyle(document.documentElement).getPropertyValue("--surface").trim());
    if (practice) practice.readColors();
  }
  if (dark && dark.addEventListener) dark.addEventListener("change", applyTheme);

  // ---- toast ----
  let toastTimer = 0;
  function toast(text, ms = 3200) {
    const el = $("toast");
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, ms);
  }

  // ---- sound and devices ----
  const synth = P.synth.create();
  synth.setVolume(settings.get("volume"));
  synth.setRoom(settings.get("room"));
  synth.setSound(settings.get("sound"));
  let practice = null;
  const recorder = P.recorder.create();
  const hot = P.hotkeys.create(settings.get("keys"), settings.get("pianoKeys"));
  let captureNote = null, lastNoteAt = -Infinity, calibrating = false;

  // Every note you play comes through here: a piano key bound to a
  // shortcut runs it, the rest is recorded and practised.
  function routeNote(m, on, vel, now, source) {
    if (captureNote) { if (on) captureNote(m); return; }
    const action = hot.actionForNote(m);
    if (action) { if (on) runAction(action); return; }
    recorder.note(m, on, vel, now);
    lastNoteAt = now;
    if (on && ear) earNote(m);
    // A rhythm drill takes any key as its one note.
    if (lessonState && lessonState.drill && drillType() === "rhythm" && practice && practice.song) m = P.abcwrite.TAP;
    if (editor && editor.wantsNotes && editorShown()) {
      editor.note(m, on);
      if (source !== "midi" || settings.get("echo")) { if (on) synth.noteOn(m, vel); else synth.noteOff(m); }
      return;
    }
    takeNote(m, on, vel);
    chordNote(m, on);
    if (practice) practice.noteIn(m, on, vel, now, source);
  }
  function pedal(down) { synth.setPedal(down); recorder.setPedal(down, performance.now()); }

  const midi = P.midi.create({ onNote: routeNote, onDevices: () => renderDevice(), onPedal: pedal,
    touch: () => ({ curve: settings.get("touch"), floor: settings.get("touchFloor"), doubles: settings.get("doubles") }) });
  const typing = P.midi.typing({
    onNote: routeNote,
    enabled: () => settings.get("typing") && (calibrating || (!$("settings").open && !themeOpen())),
  });

  function renderDevice() {
    const d = midi.devices();
    const chip = $("device");
    chip.replaceChildren();
    const dot = document.createElement("span"); dot.className = "dot";
    const name = document.createElement("span");
    chip.classList.toggle("on", d.inputs.length > 0);
    if (d.status === "unsupported") name.textContent = t("No MIDI here");
    else if (d.status === "denied") name.textContent = t("MIDI blocked");
    else if (d.inputs.length) name.textContent = d.inputs.map((i) => i.name).join(", ");
    else name.textContent = t("No piano connected");
    chip.append(dot, name);
    chip.title = t("Piano and sound settings");
    if ($("settings").open) renderSettings();
  }

  // ---- library ----
  const library = P.library.create();
  let courses = [];

  async function showLibrary() {
    if (practice) { practice.engine.pause(); practice.stopSound(); }
    if (routine) endRoutine(false);
    if (stopReplay) stopReplay();
    plan = null; lastTake = null;
    ear = null;
    stopWatching();
    $("lesson-screen").hidden = true;
    $("library").hidden = false;
    if (editorShown()) toggleEditor(false);
    midi.light([], settings.get("lightChannel"));
    if (video) toggleVideo();
    if (editingLayout) { editingLayout = false; layoutBtn.setAttribute("aria-pressed", "false"); }
    if (recorder.recording) toggleRecord();
    $("title").textContent = "Piano";
    $("status").textContent = "";
    document.title = "Piano";
    await renderLibrary();
  }

  // The library: a navigation pane, a command bar, and the lessons and
  // pieces as a table with a details pane for the selected one.
  let libView = "all", libSel = null;
  const titles = {};
  const LIB_VIEWS = [["all", "book", "Library"], ["review", "repeat", "Due for review"], ["today", "target", "Today's practice"], ["drills", "music", "Drills"], ["progress", "chart", "Progress"], ["find", "search", "Find music"]];

  async function renderLibrary() {
    courses = await library.list();
    const due = progress.dueForReview(today()).filter((r) => openable(r.key));
    const nav = el("nav", "lib-nav");
    nav.setAttribute("aria-label", t("Library pages"));
    for (const [id, ic, label] of LIB_VIEWS) {
      const b = button("", null, () => { libView = id; renderLibrary(); });
      b.append(icon(ic), el("span", null, t(label)));
      if (id === "review" && due.length) b.appendChild(el("span", "count", String(due.length)));
      b.setAttribute("aria-current", String(libView === id));
      nav.appendChild(b);
    }
    const free = button("", null, () => openFree());
    free.append(icon("keyboard"), el("span", null, t("Free play")));
    const set = button("", null, () => openSettings());
    set.append(icon("sliders"), el("span", null, t("Settings")));
    nav.append(free, el("span", "grow"), set);

    const main = el("div", "lib-main");
    const view = { all: libraryView, review: reviewView, today: todayView, drills: drillsView, progress: progressView, find: findView }[libView] || libraryView;
    main.append(...view(due));
    $("library").replaceChildren(nav, main);
    renderToday();
  }

  function libHead(title, crumb) {
    const h = el("div", "lib-head");
    if (crumb) h.appendChild(el("div", "crumb", crumb));
    h.appendChild(el("h2", null, title));
    return h;
  }
  function commands(...kids) { const c = el("div", "commands"); c.setAttribute("role", "toolbar"); c.append(...kids.filter(Boolean)); return c; }
  function cmd(label, ic, onClick, primary) { const b = button(label, "btn" + (primary ? " primary" : ""), onClick); if (ic) b.prepend(icon(ic, 14)); return b; }
  function libCommands(note) {
    const last = settings.get("last");
    const cont = last && courses.some((c) => c.id === last.course) ? cmd(t("Continue: {name}", { name: last.title || last.path }), "play", () => openLesson(last.course, last.path), true) : null;
    return commands(
      cmd(t("Add a folder"), "folder-plus", async () => {
        try {
          if (library.canPick()) { const id = await library.addFolder(); if (id) await renderLibrary(); }
          else pickFiles(true);
        } catch (e) { if (e && e.name !== "AbortError") toast(t("Couldn't add that folder: {why}", { why: e.message })); }
      }),
      cmd(t("Open a file"), "file", () => pickFiles(false)),
      cont ? el("span", "sep") : null, cont,
      note ? el("span", "note", note) : null);
  }

  // What progress knows about a lesson (all its exercises) or a piece.
  function summary(all, course, path, lesson) {
    const keys = Object.keys(all).filter((k) => (lesson ? k.startsWith(course + "|" + path + "#") : k === course + "|" + path));
    if (!keys.length) return null;
    const out = { seconds: 0, runs: 0, last: "", best: 0, due: "", stars: 0 };
    for (const k of keys) {
      const p = all[k];
      out.seconds += p.seconds || 0; out.runs += p.runs || 0;
      if ((p.lastDay || "") > out.last) out.last = p.lastDay;
      if (p.best && p.best.speed > out.best) out.best = p.best.speed;
      if (p.recital && p.recital.stars > out.stars) out.stars = p.recital.stars;
      if (p.review && p.review.due && (!out.due || p.review.due < out.due)) out.due = p.review.due;
    }
    return out;
  }
  function dayLabel(day) {
    if (!day) return t("Never");
    const d = today();
    if (day === d) return t("Today");
    if (day === P.progress.addDays(d, -1)) return t("Yesterday");
    const [y, m, dd] = day.split("-").map(Number);
    return new Date(y, m - 1, dd).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  }
  function dueLabel(due) {
    if (!due) return "";
    const d = today();
    if (due < d) return t("Overdue");
    if (due === d) return t("Due today");
    if (due === P.progress.addDays(d, 1)) return t("Tomorrow");
    const days = Math.round((Date.parse(due) - Date.parse(d)) / 86400000);
    return t("In {n} days", { n: days });
  }
  const KINDS = { md: "Lesson", abc: "ABC", musicxml: "MusicXML", mxl: "MusicXML", midi: "MIDI" };
  function kindOf(path) { return t(/\.md$/i.test(path) ? "Lesson" : KINDS[P.lesson.kind(path)] || "Piece"); }

  // rows: [{ group } | { note } | { course, path, lesson, cells: [...] }]
  function fileTable(columns, rows, onPick) {
    const table = el("table", "files");
    table.setAttribute("role", "grid");
    const head = el("tr");
    for (const c of columns) head.appendChild(el("th", null, c));
    const thead = el("thead"); thead.appendChild(head);
    const body = el("tbody");
    const items = [];
    for (const r of rows) {
      const tr = el("tr");
      if (r.group) {
        tr.className = "group";
        const td = el("td", null, r.group); td.colSpan = columns.length;
        if (r.tools && r.tools.length) { const g = el("span", "group-tools"); g.append(...r.tools); td.appendChild(g); }
        tr.appendChild(td);
      } else if (r.note) {
        tr.className = "note";
        const td = el("td", null, r.note); td.colSpan = columns.length; tr.appendChild(td);
      } else {
        tr.className = "row-item";
        tr.tabIndex = -1;
        const selected = libSel && libSel.course === r.course && libSel.path === r.path;
        tr.setAttribute("aria-selected", String(!!selected));
        r.cells.forEach((c, i) => {
          const td = el("td", i === 0 ? "name" : null);
          if (i === 0) { td.append(icon(r.lesson ? "book" : "music", 14), c); td.title = typeof c === "string" ? c : c.textContent; }
          else if (c && c.nodeType) td.appendChild(c); else td.textContent = c || "";
          tr.appendChild(td);
        });
        tr.addEventListener("click", () => select(tr, r));
        tr.addEventListener("dblclick", () => openItem(r));
        tr.addEventListener("keydown", (e) => {
          const i = items.indexOf(tr);
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const next = items[Math.max(0, Math.min(items.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
            next.focus(); next.click();
          } else if (e.key === "Enter") { e.preventDefault(); openItem(r); }
        });
        items.push(tr);
      }
      body.appendChild(tr);
    }
    function select(tr, r) {
      for (const x of items) { x.setAttribute("aria-selected", String(x === tr)); x.tabIndex = x === tr ? 0 : -1; }
      libSel = r;
      onPick(r);
    }
    const first = items.find((x) => x.getAttribute("aria-selected") === "true") || items[0];
    if (first) first.tabIndex = 0;
    table.append(thead, body);
    return table;
  }
  function openItem(r) { if (r.open) r.open(); else if (r.lesson) openLesson(r.course, r.path); else openPiece(r.course, r.path); }

  function details(box, r, all) {
    box.replaceChildren();
    if (!r) { box.appendChild(el("p", "empty", t("Pick a lesson or piece to see how it's going."))); return; }
    const c = courses.find((x) => x.id === r.course);
    const name = r.title || titles[r.course + "|" + r.path] || P.lesson.title({}, "", r.path);
    const head = el("div");
    head.append(el("h3", null, name), el("div", "sub", kindOf(r.path) + (c ? ", " + c.title : "")));
    const sm = summary(all, r.course, r.path, r.lesson);
    const dl = el("dl");
    const add = (k, v) => { const dd = el("dd"); dd.append(v); dl.append(el("dt", null, k), dd); };
    add(t("Last practised"), dayLabel(sm && sm.last));
    add(t("Practised"), sm ? minutes(sm.seconds) : "–");
    add(t("Runs"), sm ? String(sm.runs) : "0");
    add(t("Best tempo"), sm && sm.best ? pct(sm.best) : "–");
    add(t("Recital"), sm && sm.stars ? starsCell(sm.stars) : t("Not played yet"));
    add(t("Review"), sm && sm.due ? dueLabel(sm.due) : t("Not learned yet"));
    const row = el("div", "row");
    row.appendChild(button(r.lesson && !r.key ? t("Open the lesson") : t("Practise"), "btn primary", () => openItem(r)));
    if (r.lesson && !r.key && library.writable(r.course)) row.appendChild(button(t("Edit"), "btn", async () => { await openLesson(r.course, r.path); if (!editorShown()) toggleEditor(true); }));
    box.append(head, dl, row, el("p", "hint", t("Enter opens, the arrows move, a double-click opens too.")));
  }

  function withDetails(table, pick, all) {
    const body = el("div", "lib-body");
    const scroll = el("div", "lib-scroll");
    scroll.appendChild(table);
    const side = el("aside", "details");
    side.setAttribute("aria-label", t("Details"));
    body.append(scroll, side);
    details(side, pick, all);
    return { body, side };
  }

  function libraryView(due) {
    const all = progress.all().pieces;
    let lessons = 0, pieces = 0;
    const rows = [];
    let side = null;
    const fill = (span, course, path) => {
      const key = course + "|" + path;
      if (titles[key]) { span.textContent = titles[key]; return; }
      library.read(course, path).then((r) => {
        const fm = P.lesson.frontMatter(r.data);
        titles[key] = P.lesson.title(fm.meta, fm.body, path);
        span.textContent = titles[key];
        if (side && libSel && libSel.course === course && libSel.path === path) details(side, libSel, all);
      }).catch(() => {});
    };
    for (const c of courses) {
      const tools = [];
      if (c.kind === "folder") {
        if (c.status === "needs-permission") tools.push(button(t("Allow access"), "btn", async () => { if (await library.reconnect(c.id)) renderLibrary(); }));
        const rm = iconButton("x", t("Remove from library"), async () => { await library.removeFolder(c.id); renderLibrary(); });
        rm.classList.add("quiet");
        tools.push(rm);
      }
      rows.push({ group: c.title, tools });
      if (c.status === "needs-permission") { rows.push({ note: t("The app needs your OK to read this folder again.") }); continue; }
      if (c.status === "missing") { rows.push({ note: t("This folder isn't there any more.") }); continue; }
      if (!c.lessons.length && !c.pieces.length) { rows.push({ note: t("No lessons or pieces in this folder yet.") }); continue; }
      for (const path of c.lessons) {
        const name = el("span", null, titles[c.id + "|" + path] || P.lesson.title({}, "", path));
        fill(name, c.id, path);
        const sm = summary(all, c.id, path, true);
        rows.push({ course: c.id, path, lesson: true, cells: [name, t("Lesson"), dayLabel(sm && sm.last), sm && sm.best ? pct(sm.best) : "", starsCell(sm && sm.stars), dueCell(sm)] });
        lessons++;
      }
      for (const path of c.pieces) {
        titles[c.id + "|" + path] = titles[c.id + "|" + path] || path.split("/").pop();
        const sm = summary(all, c.id, path, false);
        rows.push({ course: c.id, path, lesson: false, cells: [path.split("/").pop(), kindOf(path), dayLabel(sm && sm.last), sm && sm.best ? pct(sm.best) : "", starsCell(sm && sm.stars), dueCell(sm)] });
        pieces++;
      }
    }
    if (libSel && !rows.some((r) => r.course === libSel.course && r.path === libSel.path)) libSel = null;
    const parts = [t("{n} lessons", { n: lessons }), t("{n} pieces", { n: pieces })];
    if (due.length) parts.push(t("{n} due for review", { n: due.length }));
    const table = fileTable([t("Name"), t("Kind"), t("Last practised"), t("Best"), t("Recital"), t("Review")], rows, (r) => details(side, r, all));
    const w = withDetails(table, libSel, all);
    side = w.side;
    const note = library.canPick() ? parts.join(", ") : t("This browser can't keep folders between visits; use the desktop app for that.");
    return [libHead(t("Lessons and pieces"), t("Library")), libCommands(note), w.body];
  }
  // Best recital stars, out of 5.
  function starsCell(n) {
    if (!n) return "";
    const s = el("span", "stars", "★".repeat(n) + "☆".repeat(5 - n));
    s.setAttribute("aria-label", t("{n} of 5 stars", { n }));
    s.title = s.getAttribute("aria-label");
    return s;
  }
  function dueCell(sm) {
    if (!sm || !sm.due) return sm ? t("Not learned yet") : "";
    const s = el("span", sm.due <= today() ? "due" : null, dueLabel(sm.due));
    return s;
  }

  // A progress key as a row: lessons are course|path#block, pieces course|path.
  function keyRow(key, all) {
    const i = key.indexOf("|"), course = key.slice(0, i), rest = key.slice(i + 1);
    const m = /^(.*)#\d+$/.exec(rest);
    return { course, path: m ? m[1] : rest, lesson: !!m, title: (all[key] && all[key].title) || rest };
  }
  function reviewView(due) {
    const all = progress.all().pieces;
    const rows = due.map((r) => {
      const k = keyRow(r.key, all);
      const p = all[r.key] || {};
      return { ...k, key: r.key, open: () => openKey(r.key), cells: [r.title || k.title, k.lesson ? t("Exercise") : kindOf(k.path), dayLabel(p.lastDay), p.best ? pct(p.best.speed) : "", dueCell({ due: r.due })] };
    });
    if (!rows.length) rows.push({ note: t("Nothing to review today. Pieces you've learned come back after 1, 3, 7, 14, 30 and 60 days.") });
    let side = null;
    const table = fileTable([t("Name"), t("Kind"), t("Last practised"), t("Best"), t("Review")], rows, (r) => details(side, r, all));
    const w = withDetails(table, null, all);
    side = w.side;
    const start = due.length ? cmd(t("Review the first one"), "play", () => openKey(due[0].key), true) : null;
    return [libHead(t("Due for review"), t("Library")), commands(start, el("span", "note", t("A good run sends a piece further out: 1, 3, 7, 14, 30, then 60 days."))), w.body];
  }
  function todayView() {
    const body = el("div", "lib-body single");
    const scroll = el("div", "lib-scroll");
    const pg = el("div", "lib-page");
    const plan = routinePlan();
    const card = el("section", "course");
    const head = el("div", "course-head"); head.appendChild(el("h3", null, t("The plan, {n} minutes", { n: plan.steps.reduce((a, x) => a + x.minutes, 0) })));
    const ul = el("ul", "items");
    plan.steps.forEach((x, i) => {
      const li = document.createElement("li");
      const b = button("", null, () => startRoutine());
      b.append(el("span", "dim", String(i + 1) + "."), el("span", null, x.name), el("span", "meta", t("{n} min", { n: x.minutes })));
      li.appendChild(b); ul.appendChild(li);
    });
    card.append(head, ul);
    pg.append(card, el("p", "dim", t("The minutes come from your daily goal (Settings, Practice). The warm-up key moves round the circle of fifths a day at a time.")), daysCard());
    scroll.appendChild(pg); body.appendChild(scroll);
    return [libHead(t("Today's practice"), t("Library")), commands(cmd(t("Start"), "play", () => startRoutine(), true)), body];
  }
  function drillsView() {
    const body = el("div", "lib-body single");
    const scroll = el("div", "lib-scroll");
    const pg = el("div", "lib-page");
    const list = el("section", "course");
    const ul = el("ul", "items");
    for (const [type, name] of DRILL_TYPES) {
      const li = document.createElement("li");
      const b = button("", null, () => { settings.set("drill", { ...settings.get("drill"), type }); openDrills(); });
      b.append(icon("music", 14), el("span", null, t(name)), el("span", "meta", type === (settings.get("drill") || {}).type ? t("Last used") : ""));
      li.appendChild(b); ul.appendChild(li);
    }
    list.appendChild(ul);
    pg.append(el("p", "dim", t("Sight-reading, scales and chords in every key, rhythm and playing by ear. New music every time.")), list);
    scroll.appendChild(pg); body.appendChild(scroll);
    return [libHead(t("Drills"), t("Library")), commands(cmd(t("Start drills"), "play", () => openDrills(), true)), body];
  }
  // Free music from the Mutopia Project, searched and saved into one of
  // your folders as a MIDI file, its PDF and a lesson that ties them
  // together (catalog.js; the desktop app fetches, catalog.rs).
  const find = { q: "", composer: "", start: 0, pieces: null, next: null, busy: false, error: "", composers: null, saving: new Set() };
  function findView() {
    const body = el("div", "lib-body single");
    const scroll = el("div", "lib-scroll");
    const pg = el("div", "lib-page find");
    scroll.appendChild(pg); body.appendChild(scroll);
    const head = libHead(t("Find music"), t("Library"));
    if (!K.platform.desktop) {
      pg.appendChild(el("p", "dim", t("Finding and downloading music works in the Windows app.")));
      return [head, body];
    }
    const source = select([["mutopia", t("Mutopia Project")], ["pdmx", t("PDMX collection")]], findSource(), (v) => { settings.set("findSource", v); renderLibrary(); });
    source.setAttribute("aria-label", t("Source"));
    const folders = courses.filter((c) => c.kind === "folder" && library.writable(c.id));
    const to = settings.get("findFolder");
    const target = folders.find((c) => c.id === to) || folders[0] || null;
    const where = folders.length > 1 ? select(folders.map((c) => [c.id, c.title]), target.id, (v) => { settings.set("findFolder", v); renderLibrary(); }) : null;
    if (where) where.setAttribute("aria-label", t("Save to"));
    const saveTo = where ? [el("span", "sep"), el("span", "note", t("Save to")), where] : [];
    if (!target) {
      const row = el("div", "row");
      row.appendChild(button(t("Add a folder"), "btn primary", async () => { try { const id = await library.addFolder(); if (id) { settings.set("findFolder", id); await renderLibrary(); } } catch (e) { if (e && e.name !== "AbortError") toast(e.message); } }));
      pg.append(el("p", null, t("Downloads go into one of your folders, beside your own lessons. Add one first.")), row);
    }
    if (findSource() === "pdmx") return pdmxView(head, source, saveTo, target, pg, scroll, body);
    const box = document.createElement("input");
    box.type = "search"; box.className = "find-box"; box.value = find.q;
    box.placeholder = t("Title or keyword"); box.setAttribute("aria-label", t("Search for"));
    box.addEventListener("keydown", (e) => { if (e.key === "Enter") { find.q = box.value; findSearch(0); } });
    const who = select([["", t("Any composer")], ...(find.composers || [])], find.composer, (v) => { find.composer = v; find.q = box.value; findSearch(0); });
    who.setAttribute("aria-label", t("Composer"));
    if (!find.composers) loadComposers();
    const bar = commands(source, el("span", "sep"), box, who, cmd(t("Search"), "search", () => { find.q = box.value; findSearch(0); }, true),
      ...saveTo,
      el("span", "spacer"), cmd(t("Search IMSLP"), null, () => K.platform.openOutside("https://imslp.org/index.php?title=Special:Search&search=" + encodeURIComponent((box.value || "") + " piano"))));
    if (find.busy) pg.appendChild(el("p", "dim", t("Searching the Mutopia Project…")));
    else if (find.error) pg.appendChild(el("p", "find-error", find.error));
    if (find.pieces) {
      const have = new Set(target ? (courses.find((c) => c.id === target.id) || { lessons: [] }).lessons : []);
      const rows = find.pieces.map((p) => {
        const n = P.catalog.names(p);
        const got = have.has(n.lesson);
        const act = got ? button(t("Open"), "btn", () => openLesson(target.id, n.lesson))
          : button(find.saving.has(p.mid) ? t("Saving…") : t("Download"), "btn", () => findSave(p, target));
        act.disabled = !target || find.saving.has(p.mid);
        return { course: "find", path: p.mid, open: () => (got ? openLesson(target.id, n.lesson) : target && findSave(p, target)),
          cells: [p.title, p.composer.replace(/\s*\(.*\)$/, ""), p.style, Object.assign(el("span", null, p.licence), { title: p.licence }), act] };
      });
      if (!rows.length) rows.push({ note: t("Nothing found. Try fewer words, or another composer.") });
      const table = fileTable([t("Name"), t("Composer"), t("Style"), t("Licence"), ""], rows, () => {});
      table.classList.add("find-table");
      const nav = el("div", "row find-pages");
      if (find.start > 0) nav.appendChild(button(t("Previous"), "btn", () => findSearch(Math.max(0, find.start - 10))));
      if (find.next != null) nav.appendChild(button(t("Next 10"), "btn", () => findSearch(find.next)));
      scroll.append(table, nav);
    } else if (!find.busy) {
      pg.appendChild(el("p", "dim", t("Free piano music from the Mutopia Project: public domain or Creative Commons, each with its licence. A download is a MIDI file to practise with falling notes and its sheet music as a PDF beside it.")));
      pg.appendChild(el("h3", "find-head", t("Good places to start")));
      const list = el("section", "course");
      const ul = el("ul", "items");
      for (const s of P.catalog.SUGGESTED) {
        const li = document.createElement("li");
        const b = button("", null, async () => {
          if (!find.composers) await loadComposers();
          find.q = s.q; find.composer = P.catalog.composerFor(find.composers || [], s.who);
          findSearch(0);
        });
        b.append(icon("music", 14), el("span", null, s.label));
        li.appendChild(b); ul.appendChild(li);
      }
      list.appendChild(ul); pg.appendChild(list);
    }
    return [head, bar, body];
  }
  async function loadComposers() {
    try {
      find.composers = P.catalog.composers(await invoke("catalog_page", { url: P.catalog.SITE + "advsearch.html" }));
      if (libView === "find") renderLibrary();
    } catch (e) { find.composers = []; }
  }
  async function findSearch(start) {
    find.busy = true; find.error = ""; find.start = start;
    renderLibrary();
    try {
      const r = P.catalog.parse(await invoke("catalog_page", { url: P.catalog.searchUrl({ q: find.q, composer: find.composer, start }) }));
      find.pieces = r.pieces; find.next = r.next;
    } catch (e) {
      find.error = t("Couldn't reach the Mutopia Project: {why}", { why: String(e && e.message || e) });
    }
    find.busy = false;
    if (libView === "find") renderLibrary();
  }
  async function findSave(p, target) {
    if (!target || find.saving.has(p.mid)) return;
    find.saving.add(p.mid); renderLibrary();
    const n = P.catalog.names(p);
    try {
      const bytes = async (url) => new Uint8Array(await invoke("catalog_file", { url }));
      await library.write(target.id, n.mid, await bytes(p.mid));
      if (n.pdf) await library.write(target.id, n.pdf, await bytes(p.pdf));
      await library.write(target.id, n.lesson, P.catalog.lesson(p));
      toast(t("Saved {name} in {folder}", { name: p.title, folder: target.title }));
    } catch (e) {
      toast(t("Couldn't download it: {why}", { why: String(e && e.message || e) }));
    }
    find.saving.delete(p.mid);
    if (libView === "find") renderLibrary();
  }

  // The PDMX collection: got once into the data folder (pdmx.rs), then
  // searched here with no connection (pdmx.js).
  const findSource = () => settings.get("findSource") || "mutopia";
  const pd = { pieces: undefined, made: 0, unrated: false, progress: null, q: "", level: "", shown: 100, saving: new Set(), listening: false };
  async function pdmxLoad() {
    try {
      const text = await invoke("pdmx_index");
      const data = text ? JSON.parse(text) : null;
      pd.pieces = data ? data.pieces : null; pd.made = data ? data.made : 0;
    } catch (e) { pd.pieces = null; }
    try { pd.progress = (await invoke("pdmx_status")) || null; } catch (e) { pd.progress = null; }
    if (!pd.listening && window.__TAURI__.event) {
      pd.listening = true;
      await window.__TAURI__.event.listen("pdmx", ({ payload: p }) => {
        const was = pd.progress && pd.progress.phase;
        pd.progress = ["index", "scores"].includes(p.phase) ? p : null;
        if (p.phase === "done") { toast(t("The PDMX collection is ready: {n} pieces.", { n: p.found.toLocaleString() })); pd.pieces = undefined; }
        else if (p.phase === "error") toast(t("Couldn't get the PDMX collection: {why}", { why: p.message }));
        if (libView === "find" && findSource() === "pdmx" && (p.phase !== was || !document.querySelector(".pdmx-bar"))) renderLibrary();
        else pdmxBar();
      });
    }
    if (libView === "find") renderLibrary();
  }
  // Moves the bar without drawing the whole page again.
  function pdmxBar() {
    const bar = document.querySelector(".pdmx-bar"), p = pd.progress;
    if (!bar || !p) return;
    const meter = bar.querySelector("progress"), note = bar.querySelector(".note");
    if (p.total) { meter.max = p.total; meter.value = p.done; } else meter.removeAttribute("value");
    const mb = (n) => Math.round(n / 1048576).toLocaleString();
    note.textContent = p.phase === "index"
      ? t("Reading the index: {done} of {total} MB", { done: mb(p.done), total: p.total ? mb(p.total) : "?" })
      : t("Keeping {n} piano pieces: {done} of {total} MB", { n: p.pieces.toLocaleString(), done: mb(p.done), total: p.total ? mb(p.total) : "?" });
  }
  const rowOf = (...kids) => { const r = el("div", "row"); r.append(...kids); return r; };
  function pdmxView(head, source, saveTo, target, pg, scroll, body) {
    if (pd.pieces === undefined) { pdmxLoad(); pg.appendChild(el("p", "dim", t("Loading…"))); return [head, commands(source), body]; }
    if (pd.progress) {
      const bar = el("div", "pdmx-bar");
      bar.append(document.createElement("progress"), el("span", "note"));
      pg.append(el("p", null, t("Getting the PDMX collection. You can keep practising; it carries on in the background.")), bar,
        rowOf(button(t("Cancel"), "btn", () => invoke("pdmx_cancel"))));
      requestAnimationFrame(pdmxBar);
      return [head, commands(source), body];
    }
    if (!pd.pieces) {
      const box = document.createElement("label"); box.className = "check";
      const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = pd.unrated;
      cb.addEventListener("change", () => { pd.unrated = cb.checked; });
      box.append(cb, el("span", null, t("Also keep unrated pieces (about ten times as many, mostly single-line tunes)")));
      pg.append(
        el("p", null, t("PDMX is about 250,000 scores shared on MuseScore and marked public domain by their uploaders, collected by researchers at UC San Diego (CC BY 4.0).")),
        el("p", null, t("Getting it downloads about 2.1 GB from Zenodo and keeps only the solo piano pieces that other people have rated: about 3,800 pieces, around 30 MB. Nothing else is kept.")),
        el("p", "dim", t("Uploaders' licence marks aren't checked by anyone. Film, game and pop arrangements are for your own practice, not to share.")),
        box,
        rowOf(button(t("Get the collection"), "btn primary", async () => {
          try { await invoke("pdmx_get", { unrated: pd.unrated }); pd.progress = { phase: "index", done: 0, total: 0, pieces: 0 }; renderLibrary(); }
          catch (e) { toast(t("Couldn't get the PDMX collection: {why}", { why: String(e && e.message || e) })); }
        })));
      return [head, commands(source), body];
    }
    const box = document.createElement("input");
    box.type = "search"; box.className = "find-box"; box.value = pd.q;
    box.placeholder = t("Title, composer or genre"); box.setAttribute("aria-label", t("Search for"));
    let timer = 0;
    box.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { pd.q = box.value; pd.shown = 100; renderLibrary(); requestAnimationFrame(() => { const b = document.querySelector(".find-box"); if (b) { b.focus(); b.setSelectionRange(b.value.length, b.value.length); } }); }, 250); });
    const lvl = select([["", t("Any level")], ...P.pdmx.LEVELS.map((l, i) => [String(i), t(l)])], pd.level, (v) => { pd.level = v; pd.shown = 100; renderLibrary(); });
    lvl.setAttribute("aria-label", t("Level"));
    const bar = commands(source, el("span", "sep"), box, lvl, ...saveTo, el("span", "spacer"),
      cmd(t("Get it again"), null, () => { pd.pieces = null; renderLibrary(); }),
      cmd(t("Remove the collection"), null, async () => { try { await invoke("pdmx_remove"); pd.pieces = null; renderLibrary(); } catch (e) { toast(String(e && e.message || e)); } }));
    const found = P.pdmx.search(pd.pieces, { q: pd.q, level: pd.level });
    const have = new Set(target ? (courses.find((c) => c.id === target.id) || { lessons: [] }).lessons : []);
    const rows = found.slice(0, pd.shown).map((p) => {
      const n = P.pdmx.names(p);
      const got = have.has(n.lesson);
      const act = got ? button(t("Open"), "btn", () => openLesson(target.id, n.lesson))
        : button(pd.saving.has(p.file) ? t("Saving…") : t("Add to library"), "btn", () => pdmxSave(p, target));
      act.disabled = !target || pd.saving.has(p.file);
      return { course: "pdmx", path: p.file, open: () => (got ? openLesson(target.id, n.lesson) : target && pdmxSave(p, target)),
        cells: [p.title, p.composer, t(P.pdmx.LEVELS[p.level] || ""), p.rating.toFixed(1), act] };
    });
    if (!rows.length) rows.push({ note: t("Nothing found. Try fewer words.") });
    const table = fileTable([t("Name"), t("Composer"), t("Level"), t("Rating"), ""], rows, () => {});
    table.classList.add("find-table");
    pg.appendChild(el("p", "dim", t("{n} of {total} pieces", { n: found.length.toLocaleString(), total: pd.pieces.length.toLocaleString() })));
    const nav = el("div", "row find-pages");
    if (found.length > pd.shown) nav.appendChild(button(t("Show more"), "btn", () => { pd.shown += 100; renderLibrary(); }));
    scroll.append(table, nav);
    return [head, bar, body];
  }
  async function pdmxSave(p, target) {
    if (!target || pd.saving.has(p.file)) return;
    pd.saving.add(p.file); renderLibrary();
    const n = P.pdmx.names(p);
    try {
      await library.write(target.id, n.mxl, new Uint8Array(await invoke("pdmx_file", { name: p.file })));
      await library.write(target.id, n.lesson, P.pdmx.lesson(p));
      toast(t("Saved {name} in {folder}", { name: p.title, folder: target.title }));
    } catch (e) {
      toast(t("Couldn't save it: {why}", { why: String(e && e.message || e) }));
    }
    pd.saving.delete(p.file);
    if (libView === "find") renderLibrary();
  }

  function progressView() {
    const all = progress.all().pieces;
    const keys = Object.keys(all).filter((k) => all[k].seconds || all[k].runs).sort((a, b) => (all[b].lastDay || "").localeCompare(all[a].lastDay || ""));
    const rows = keys.map((key) => {
      const k = keyRow(key, all), p = all[key];
      return { ...k, key, open: () => { if (openable(key)) openKey(key); else toast(t("That one isn't in the library any more.")); }, cells: [p.title || k.title, minutes(p.seconds || 0), String(p.runs || 0), p.best ? pct(p.best.speed) : "", dayLabel(p.lastDay)] };
    });
    if (!rows.length) rows.push({ note: t("Nothing yet. Practise something and it shows here.") });
    const body = el("div", "lib-body single");
    const scroll = el("div", "lib-scroll");
    const pg = el("div", "lib-page");
    pg.appendChild(daysCard());
    const table = fileTable([t("Name"), t("Practised"), t("Runs"), t("Best tempo"), t("Last practised")], rows, () => {});
    scroll.append(pg, table); body.appendChild(scroll);
    return [libHead(t("Progress"), t("Library")), commands(el("span", "note", t("Every lesson exercise and piece you've practised, newest first."))), body];
  }

  function pickFiles(folder) {
    const input = document.createElement("input");
    input.type = "file";
    if (folder) { input.webkitdirectory = true; input.multiple = true; }
    else input.accept = ".musicxml,.xml,.mxl,.mid,.midi,.abc,.md";
    input.addEventListener("change", async () => {
      if (!input.files.length) return;
      if (folder) { library.addFiles(input.files); renderLibrary(); return; }
      const id = library.addFiles(input.files);
      const path = [...input.files][0].name;
      if (/\.md$/i.test(path)) openLesson(id, path); else openPiece(id, path);
    });
    input.click();
  }

  // ---- the lesson screen ----
  const PANELS = ["lesson", "score", "roll", "stats", "book", "editor"];
  const PANEL_NAMES = { lesson: "Lesson", score: "Score", roll: "Keys", stats: "Progress", book: "Book", editor: "Editor" };
  const DEFAULT_LAYOUT = { dir: "row", sizes: [0.24, 0.54, 0.22], children: ["lesson", { dir: "col", sizes: [0.6, 0.4], children: ["score", "roll"] }, "stats"] };
  const PRESETS = {
    lesson: { name: "Lesson", tree: DEFAULT_LAYOUT },
    play: { name: "Just playing", tree: { dir: "col", sizes: [0.5, 0.5], children: ["score", "roll"] } },
    book: { name: "Book beside", tree: { dir: "row", sizes: [0.42, 0.58], children: ["book", { dir: "col", sizes: [0.5, 0.5], children: ["score", "roll"] }] } },
    keys: { name: "Keys only", tree: { dir: "row", sizes: [0.78, 0.22], children: ["roll", "stats"] } },
  };
  let editingLayout = false;
  let pdf = null, editor = null, fx = null;
  const editBtn = button("", "icon-btn", null);
  editBtn.hidden = true;
  const mounts = {};
  // Each panel's title bar carries one line about what's in it.
  const heads = { lesson: el("span"), score: el("span"), roll: el("span"), stats: el("span"), book: el("span"), editor: el("span") };
  let lessonState = null; // { course, path, meta, blocks, pieces, active, modified }
  let watchTimer = 0;

  function buildPanels() {
    mounts.lesson = el("article", "lesson-text");
    mounts.score = el("div", "score");
    mounts.score.setAttribute("aria-label", t("Sheet music"));
    const rollWrap = el("div", "roll-wrap");
    const rollCanvas = document.createElement("canvas");
    rollCanvas.setAttribute("aria-label", t("Falling notes and keyboard"));
    rollWrap.appendChild(rollCanvas);
    const chord = el("div", "chord-name"); chord.id = "chord"; chord.hidden = true; chord.setAttribute("aria-live", "polite");
    rollWrap.appendChild(chord);
    const prompter = el("div", "chord-prompter"); prompter.id = "prompter"; prompter.hidden = true;
    rollWrap.appendChild(prompter);
    mounts.roll = rollWrap;
    const timelineCanvas = document.createElement("canvas");
    mounts.stats = el("div", "stats");
    mounts.book = el("div", "book");
    mounts.editor = el("div", "editor");
    editor = P.editor.create(mounts.editor, {
      t, icon, button,
      canSave: () => !!(lessonState && lessonState.course && library.writable(lessonState.course)),
      onInput: (text) => previewLesson(text),
      onSave: (text) => saveLesson(text),
      onClose: () => toggleEditor(false),
    });
    pdf = P.pdfview.create(mounts.book, { t, icon, onPage: (id, page) => { if (!id) return; const b = { ...settings.get("bookPages") }; b[id] = page; settings.set("bookPages", b); } });
    practice = P.practice.create({
      scoreEl: mounts.score, rollCanvas, timelineCanvas, midi, synth, settings,
      onChange: (s) => { renderTransport(s); statsSoon(); },
      onEvent,
      onFrame: prompt,
      onExpected: (list) => midi.light(list, settings.get("lightChannel")),
    });
    fx = P.effects.create();
    applyEffects();
    practice.engine.setLatency(settings.get("latency"));
    practice.roll.setRange(settings.get("range"));
    applyLabels();
    buildTransport(timelineCanvas);
    buildLayoutBar();
    mouseKeys(rollCanvas);
    new ResizeObserver(() => practice.resize()).observe($("panels"));
    new ResizeObserver(() => practice.resize()).observe(rollWrap);
    new ResizeObserver(() => pdf.resize()).observe(mounts.book);
  }

  function applyLabels() {
    const n = settings.get("noteNames");
    practice.roll.setLabels({ names: n !== "off", system: n === "solfege" ? "solfege" : "letters", fingers: !!settings.get("fingers") });
    practice.draw();
  }

  function currentLayout() { return P.layout.normalize(settings.get("layout") || DEFAULT_LAYOUT, PANELS) || DEFAULT_LAYOUT; }
  function setLayout(tree) { settings.set("layout", P.layout.normalize(tree, PANELS)); renderLayout(); }

  function renderLayout() {
    const tree = currentLayout();
    P.layout.render($("panels"), tree, {
      mount: (id) => mounts[id],
      onChange: (next) => setLayout(next),
      editing: editingLayout,
      label: (id) => t(PANEL_NAMES[id] || id),
      head: (id) => heads[id],
      onDrop: (panel, target, side) => setLayout(P.layout.place(currentLayout(), panel, target, side)),
    });
    $("panels").classList.toggle("editing", editingLayout);
    if (layoutBar) renderLayoutBar(tree);
    practice.resize();
    pdf.resize();
  }

  // ---- the layout editor: drag panels by their names, show or hide them, presets ----
  let layoutBar = null;
  function buildLayoutBar() {
    layoutBar = el("div", "layout-bar");
    layoutBar.hidden = true;
    $("lesson-screen").insertBefore(layoutBar, $("panels"));
  }
  function renderLayoutBar(tree) {
    layoutBar.hidden = !editingLayout;
    if (!editingLayout) return;
    const shown = P.layout.panels(tree);
    const chips = PANELS.map((id) => {
      const c = button(t(PANEL_NAMES[id]), "chip", () => {
        if (shown.includes(id)) { if (shown.length > 1) setLayout(P.layout.remove(tree, id)); }
        else setLayout(P.layout.show(tree, id, PANELS));
      });
      c.setAttribute("aria-pressed", String(shown.includes(id)));
      return c;
    });
    const preset = document.createElement("select");
    preset.setAttribute("aria-label", t("Presets"));
    preset.appendChild(new Option(t("Presets…"), ""));
    for (const [k, v] of Object.entries(PRESETS)) preset.appendChild(new Option(t(v.name), k));
    preset.addEventListener("change", () => { if (preset.value) setLayout(PRESETS[preset.value].tree); });
    layoutBar.replaceChildren(
      el("span", "hint", t("Drag a panel's name to another panel's edge to put it there, or to its middle to swap them.")),
      ...chips, preset,
      button(t("Done"), "btn primary", () => toggleLayoutEditor(false)),
    );
  }
  function toggleLayoutEditor(on) {
    editingLayout = on == null ? !editingLayout : on;
    layoutBtn.setAttribute("aria-pressed", String(editingLayout));
    renderLayout();
  }

  function showLessonScreen(title) {
    $("library").hidden = true;
    $("lesson-screen").hidden = false;
    editBtn.hidden = true;
    // The editor only stays for a lesson; pieces, drills and free play have no text.
    if (!(lessonState && lessonState.path) && P.layout.panels(currentLayout()).includes("editor")) settings.set("layout", P.layout.remove(currentLayout(), "editor"));
    $("title").textContent = title;
    document.title = title + " - Piano";
    heads.score.textContent = "";
    renderLayout();
  }

  const md = window.markdownit({ html: false, linkify: true, typographer: true });
  const baseFence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, opts, env, self) => {
    const tok = tokens[idx];
    const f = P.lesson.fence(tok.info);
    if (f.lang !== "abc") return baseFence(tokens, idx, opts, env, self);
    env.blocks.push({ text: tok.content, opts: f.opts });
    const i = env.blocks.length - 1;
    return '<div class="practice-block" data-block="' + i + '"><div class="block-head"><span class="name"></span><span class="opts"></span></div><div class="abc-preview"></div></div>';
  };

  async function openLesson(course, path) {
    let r;
    try { r = await library.read(course, path); }
    catch (e) { toast(t("Couldn't open that lesson: {why}", { why: e.message })); return; }
    const { meta, body } = P.lesson.frontMatter(r.data);
    const title = P.lesson.title(meta, body, path);
    settings.set("last", { course, path, title });
    lessonState = { course, path, meta, modified: r.modified, active: null, text: r.data };
    showLessonScreen(title);
    renderLessonText(body);
    if (meta.book) openBook(meta.book, false); else dropBook();
    editBtn.hidden = false;
    if (editorShown()) loadEditor();
    const first = lessonState.blocks.length ? { block: 0 } : lessonState.pieces.length ? { piece: 0 } : null;
    if (first) await activate(first);
    else { await practice.load({ kind: "none", message: t("This lesson has no music to practise.") }).catch(() => {}); }
    watch();
  }

  async function openPiece(course, path) {
    lessonState = { course, path: null, piecePath: path, meta: {}, blocks: [], pieces: [{ path, opts: {}, title: path.split("/").pop() }], active: null };
    dropBook();
    showLessonScreen(path.split("/").pop());
    mounts.lesson.replaceChildren(el("h1", null, path.split("/").pop()), el("p", "dim", t("A piece on its own, with no lesson text.")));
    await activate({ piece: 0 });
    watch();
  }

  function renderLessonText(body) {
    const env = { blocks: [] };
    const html = md.render(body, env);
    const doc = new DOMParser().parseFromString("<div>" + html + "</div>", "text/html");
    const root = doc.body.firstChild;
    lessonState.blocks = env.blocks;
    lessonState.pieces = [];
    // Links: pieces become practice cards, other lessons open here, other
    // sites go to the browser.
    for (const a of [...root.querySelectorAll("a[href]")]) {
      const href = a.getAttribute("href");
      if (P.lesson.isPiece(href)) {
        const i = lessonState.pieces.length;
        lessonState.pieces.push({ path: P.lesson.resolve(lessonState.path, href), opts: P.lesson.options(a.getAttribute("title") || ""), title: a.textContent });
        a.removeAttribute("title");
        const p = a.parentElement;
        if (p && p.tagName === "P" && p.textContent.trim() === a.textContent.trim()) {
          const card = doc.createElement("div");
          card.className = "piece-card"; card.dataset.piece = i;
          const head = doc.createElement("div"); head.className = "block-head";
          const name = doc.createElement("span"); name.className = "name"; name.textContent = a.textContent;
          const opts = doc.createElement("span"); opts.className = "opts";
          head.append(name, opts); card.appendChild(head);
          p.replaceWith(card);
        } else { a.dataset.piece = i; a.setAttribute("href", "#"); }
      } else if (/\.pdf$/i.test(href.split(/[?#]/)[0]) && !/^[a-z]+:/i.test(href)) {
        a.dataset.book = href; a.setAttribute("href", "#");
      } else if (/\.md$/i.test(href.split(/[?#]/)[0]) && !/^[a-z]+:/i.test(href)) {
        a.dataset.lesson = P.lesson.resolve(lessonState.path, href); a.setAttribute("href", "#");
      }
    }
    mounts.lesson.replaceChildren(...root.childNodes);
    mounts.lesson.scrollTop = 0;
    // Each practice block: its title, its options and a small preview.
    mounts.lesson.querySelectorAll(".practice-block").forEach((node) => {
      const b = lessonState.blocks[+node.dataset.block];
      const head = node.querySelector(".block-head");
      head.querySelector(".name").textContent = (/^T:\s*(.+)$/m.exec(b.text) || [])[1] || t("Exercise");
      head.querySelector(".opts").textContent = describe(b.opts);
      head.appendChild(button(t("Practice"), "btn", () => activate({ block: +node.dataset.block })));
      try { window.ABCJS.renderAbc(node.querySelector(".abc-preview"), b.text, { staffwidth: 560, scale: 0.8, paddingtop: 0, paddingbottom: 0, foregroundColor: getComputedStyle(document.documentElement).getPropertyValue("--text").trim() }); }
      catch (e) { node.querySelector(".abc-preview").textContent = t("This music block couldn't be read."); }
    });
    mounts.lesson.querySelectorAll(".piece-card").forEach((node) => {
      const pc = lessonState.pieces[+node.dataset.piece];
      node.querySelector(".opts").textContent = describe(pc.opts);
      node.querySelector(".block-head").prepend(icon("music"));
      node.querySelector(".block-head").appendChild(button(t("Practice"), "btn", () => activate({ piece: +node.dataset.piece })));
    });
    // Images beside the lesson, from its folder.
    mounts.lesson.querySelectorAll("img[src]").forEach(async (img) => {
      const src = img.getAttribute("src");
      if (/^(data|blob|https?):/i.test(src)) return;
      try {
        const r = await library.read(lessonState.course, P.lesson.resolve(lessonState.path, src), "bytes");
        img.src = URL.createObjectURL(new Blob([r.data]));
      } catch (e) { img.alt = img.alt || src; }
    });
    markActive();
  }

  function describe(o) {
    const parts = [];
    if (o.hands === "right") parts.push(t("right hand")); else if (o.hands === "left") parts.push(t("left hand")); else if (o.hands === "both") parts.push(t("both hands"));
    if (o.tempo) parts.push(t("{n} bpm", { n: o.tempo }));
    if (o.mode === "flow") parts.push(t("flow"));
    if (o.loop) parts.push(t("loop"));
    return parts.join(", ");
  }

  async function activate(which) {
    if (!lessonState) return;
    let target;
    try {
      if (which.block != null) {
        const b = lessonState.blocks[which.block];
        target = { kind: "abc", data: b.text, opts: b.opts, title: (/^T:\s*(.+)$/m.exec(b.text) || [])[1] || "", source: { block: which.block } };
      } else {
        const pc = lessonState.pieces[which.piece];
        const kind = P.lesson.kind(pc.path);
        const bytes = kind === "mxl" || kind === "midi";
        const r = pc.data ? { data: pc.data, modified: 0 } : await library.read(lessonState.course, pc.path, bytes ? "bytes" : "text");
        pc.modified = r.modified;
        let data = r.data;
        if (kind === "mxl") data = binaryString(r.data);
        const tracks = kind === "midi" ? (settings.get("midiHands") || {})[lessonState.course + "|" + pc.path] : null;
        target = { kind, data, opts: tracks ? { ...pc.opts, tracks } : pc.opts, title: pc.title, message: t("A MIDI file has no sheet music: the falling notes show the piece."), source: { piece: which.piece } };
      }
      lessonState.active = which;
      markActive();
      passes = [];
      await practice.load(target);
      const s = practice.state();
      heads.score.textContent = [target.title, describe(target.opts || {})].filter(Boolean).join(", ");
      if (target.kind === "midi") renderTracks(lessonState.course + "|" + lessonState.pieces[which.piece].path);
    } catch (e) {
      toast(t("Couldn't load that music: {why}", { why: e.message || String(e) }));
      K.errlog && K.errlog.note && K.errlog.note("load", String(e && e.stack || e));
    }
  }

  // A MIDI file's tracks, each played by a hand, split by pitch, or left out.
  function renderTracks(key) {
    const song = practice.song;
    if (!song || !song.tracks || !song.tracks.length) return;
    const box = el("div", "tracks");
    box.appendChild(el("h3", null, t("Tracks")));
    const choice = () => song.tracks.map((tr) => tr.hand);
    song.tracks.forEach((tr, i) => {
      const row = el("div", "track-row");
      row.appendChild(el("span", "track-name", tr.name || t("Track {n}", { n: i + 1 })));
      row.appendChild(el("span", "dim", t("{n} notes", { n: tr.notes })));
      const pick = seg([["right", t("Right")], ["left", t("Left")], ["split", t("Split")], ["off", t("Off")]], (v) => {
        const list = choice(); list[i] = v;
        if (list.every((h) => h === "off")) { toast(t("Keep at least one track on.")); setSeg(pick, tr.hand); return; }
        const all = { ...(settings.get("midiHands") || {}) }; all[key] = list; settings.set("midiHands", all);
        practice.act.trackHands(list);
        renderTracks(key);
      });
      setSeg(pick, tr.hand);
      row.appendChild(pick);
      box.appendChild(row);
    });
    box.appendChild(el("p", "dim", t("Split gives each note to the hand that can reach it best.")));
    const old = mounts.score.querySelector(".tracks");
    if (old) old.replaceWith(box); else mounts.score.appendChild(box);
  }

  function binaryString(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return s;
  }

  function markActive() {
    const a = lessonState && lessonState.active;
    mounts.lesson.querySelectorAll(".practice-block").forEach((n) => n.classList.toggle("active", !!a && a.block === +n.dataset.block));
    mounts.lesson.querySelectorAll(".piece-card").forEach((n) => n.classList.toggle("active", !!a && a.piece === +n.dataset.piece));
    const node = mounts.lesson.querySelector(".active");
    if (node) node.scrollIntoView({ block: "nearest" });
  }

  // A lesson or piece in one of your folders reloads when its file changes.
  function watch() {
    stopWatching();
    if (!lessonState || !library.writable(lessonState.course)) return;
    watchTimer = setInterval(async () => {
      const s = lessonState; if (!s) return;
      if (s.path && !(editorShown() && editor.dirty)) {
        const m = await library.modified(s.course, s.path);
        if (m && m !== s.modified) {
          const r = await library.read(s.course, s.path);
          const before = s.active && s.active.block != null ? s.blocks[s.active.block] && s.blocks[s.active.block].text : null;
          s.modified = r.modified; s.text = r.data;
          if (editorShown() && !editor.dirty && editor.text !== r.data) editor.open(r.data, s.course + "|" + s.path);
          const fm = P.lesson.frontMatter(r.data);
          s.meta = fm.meta;
          const keep = mounts.lesson.scrollTop;
          renderLessonText(fm.body);
          mounts.lesson.scrollTop = keep;
          if (s.active && s.active.block != null && s.blocks[s.active.block] && s.blocks[s.active.block].text !== before && !practice.engine.playing) activate(s.active);
        }
      }
      if (s.active && s.active.piece != null) {
        const pc = s.pieces[s.active.piece];
        const m = pc && await library.modified(s.course, pc.path);
        if (m && pc.modified && m !== pc.modified && !practice.engine.playing) activate(s.active);
      }
    }, 1500);
  }
  function stopWatching() { clearInterval(watchTimer); watchTimer = 0; }

  // Clicks on links in the lesson.
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest(".lesson-text a");
    if (!a) return;
    if (a.dataset.piece != null) { e.preventDefault(); activate({ piece: +a.dataset.piece }); return; }
    if (a.dataset.lesson) { e.preventDefault(); openLesson(lessonState.course, a.dataset.lesson); return; }
    if (a.dataset.book) { e.preventDefault(); openBook(a.dataset.book, true); return; }
    const href = a.getAttribute("href") || "";
    if (/^https?:/i.test(href)) { e.preventDefault(); K.platform.openOutside(href); }
  });

  // ---- transport ----
  const tr = {};
  function buildTransport(timelineCanvas) {
    const bar = $("toolbar");
    tr.back = iconButton("arrow-left", t("Back to the library") + " (" + P.hotkeys.label(hot.keys.library) + ")", () => runAction("library"));
    tr.play = button("", "icon-btn play-btn", () => practice.act.toggle(performance.now()));
    tr.restart = iconButton("skip-back", t("Back to the start"), () => practice.act.restart());
    const tl = $("timeline");
    tl.appendChild(timelineCanvas);
    tl.title = t("Click a bar to go there; drag across bars to loop them");
    tr.loop = iconButton("repeat", t("Loop"), () => practice.act.loop(!practice.engine.loop.on));
    tr.autoSpeed = iconButton("trending-up", t("Speed up 5% after each clean pass of the loop"), () => { settings.set("autoSpeed", !settings.get("autoSpeed")); renderTransport(practice.state()); });
    tr.metronome = iconButton("timer", t("Metronome"), () => practice.act.metronome(!practice.engine.metronome));
    tr.countIn = button(t("Count-in"), "btn", () => practice.act.countIn(!practice.engine.countIn));
    tr.position = el("div", "position");
    tr.position.title = t("The bar you're on");
    tr.speedDown = iconButton("minus", t("Slower"), () => practice.act.speed(Math.max(0.25, practice.engine.speed - 0.05)));
    tr.speedValue = document.createElement("input");
    tr.speedValue.type = "number"; tr.speedValue.min = "25"; tr.speedValue.max = "150"; tr.speedValue.step = "5"; tr.speedValue.className = "num-field";
    tr.speedValue.setAttribute("aria-label", t("Speed in percent"));
    tr.speedValue.addEventListener("change", () => { const v = Math.max(25, Math.min(150, +tr.speedValue.value || 100)); practice.act.speed(v / 100); });
    tr.speedUp = iconButton("plus", t("Faster"), () => practice.act.speed(Math.min(1.5, practice.engine.speed + 0.05)));
    tr.mode = select(MODES.map(([v, name]) => [v, t(name)]), "wait", (v) => practice.act.mode(v));
    tr.mode.title = t("Wait for each note, keep going, play the whole piece for stars, or watch the app play it");
    tr.mode.setAttribute("aria-label", t("Mode"));
    const hands = [["me", t("You")], ["auto", t("App")], ["off", t("Off")]];
    tr.right = select(hands, "me", (v) => practice.act.hand("right", v));
    tr.right.setAttribute("aria-label", t("Right hand"));
    tr.left = select(hands, "me", (v) => practice.act.hand("left", v));
    tr.left.setAttribute("aria-label", t("Left hand"));
    tr.keyDown = iconButton("minus", t("Down a semitone"), () => practice.act.transpose(practice.state().transpose - 1));
    tr.keyValue = el("span", "speed-value");
    tr.keyValue.title = t("Transpose: what you hear and play moves; the score stays in its written key");
    tr.keyUp = iconButton("plus", t("Up a semitone"), () => practice.act.transpose(practice.state().transpose + 1));
    tr.record = iconButton("circle", t("Record what you play"), () => toggleRecord());
    tr.record.classList.add("rec-btn");
    tr.recTime = el("span", "rec-time");
    tr.video = iconButton("video", t("Record a video of the falling notes"), () => toggleVideo());
    tr.video.classList.add("rec-btn");
    const sep = () => el("span", "sep");
    bar.append(tr.back, sep(), tr.restart, tr.play, tr.loop, tr.autoSpeed, tr.metronome, tr.countIn, sep(), tr.position,
      group(t("Speed"), tr.speedDown, tr.speedValue, tr.speedUp), group(t("Mode"), tr.mode),
      group(t("Right"), tr.right), group(t("Left"), tr.left), group(t("Key"), tr.keyDown, tr.keyValue, tr.keyUp),
      el("span", "spacer"), tr.record, tr.recTime, tr.video, sep(), editBtn, layoutBtn);
  }

  function renderTransport(s) {
    if (!tr.play) return;
    tr.play.replaceChildren(icon(s.playing ? "pause" : "play", 16));
    tr.play.title = (s.playing ? t("Pause") : t("Play")) + " (" + P.hotkeys.label(hot.keys.toggle) + ")";
    tr.play.setAttribute("aria-label", tr.play.title);
    tr.mode.value = s.mode;
    if (document.activeElement !== tr.speedValue) tr.speedValue.value = String(Math.round(s.speed * 100));
    tr.loop.setAttribute("aria-pressed", String(!!s.loop.on));
    tr.right.value = s.hands.right; tr.left.value = s.hands.left;
    tr.metronome.setAttribute("aria-pressed", String(!!s.metronome));
    tr.countIn.setAttribute("aria-pressed", String(!!s.countIn));
    tr.autoSpeed.setAttribute("aria-pressed", String(!!settings.get("autoSpeed")));
    tr.keyValue.textContent = s.transpose > 0 ? "+" + s.transpose : String(s.transpose || 0);
    for (const b of [tr.keyDown, tr.keyUp, tr.loop, tr.autoSpeed, tr.metronome, tr.countIn, tr.restart, tr.speedDown, tr.speedUp, tr.speedValue, tr.mode, tr.right, tr.left]) b.disabled = !s.song;
    tr.play.disabled = !s.song;
    if (!heads.score.textContent && s.target && s.target.title) heads.score.textContent = s.target.title;
    if (s.song) tr.position.replaceChildren(el("span", null, t("Bar")), el("strong", null, String(s.bar + 1)), el("span", null, t("of {n}", { n: s.song.measures })));
    else tr.position.replaceChildren(el("span", null, t("Bar")), el("strong", null, "–"));
    let status = "";
    if (s.counting) status = t("Counting in");
    else if (s.waiting && s.expected.length) status = t("Play {notes}", { notes: s.expected.map((m) => P.music.name(m)).join(" ") });
    else if (s.song && !s.playing && s.next >= 0 && s.mode === "wait" && s.t === 0) status = t("Play the first note to start");
    else if (s.mode === "watch" && s.song) status = t("Watching: the app plays every hand that isn't off");
    else if (s.recital && s.song) status = s.recital.multiplier > 1
      ? t("{points} points, {combo} in a row, ×{x}", { points: s.recital.points.toLocaleString(), combo: s.recital.combo, x: s.recital.multiplier })
      : t("{points} points", { points: s.recital.points.toLocaleString() });
    $("status").textContent = status;
    if (s.lastResult && s.lastResult !== shownResult) {
      shownResult = s.lastResult;
      const r = s.lastResult;
      if (r.kind === "pass" && r.speedUp) toast(t("Clean pass {n}: now {speed}%", { n: r.pass, speed: Math.round(r.speedUp * 100) }));
      else if (r.kind === "pass") toast(r.clean ? t("Clean pass {n}", { n: r.pass }) : t("Pass {n}: {acc}% right, {wrong} wrong", { n: r.pass, acc: r.accuracy, wrong: r.wrong }));
      else if (r.recital) recitalDone(r);
      else if (!(r.hits + r.late + r.misses)) toast(t("The end"));
      else toast(t("Done: {acc}% right, {wrong} wrong notes", { acc: r.accuracy, wrong: r.wrong }), 5000);
    }
  }
  let shownResult = null;

  // The end of a whole recital: stars, points, the longest run, and again.
  function recitalDone(r) {
    const x = r.recital;
    const d = el("dialog", "sheet recital-done");
    const head = el("div", "sheet-head"); head.appendChild(el("h2", null, x.isBest ? t("A new best") : t("Recital done")));
    const body = el("div", "sheet-body");
    const stars = el("div", "stars big", "★".repeat(x.stars) + "☆".repeat(5 - x.stars));
    stars.setAttribute("role", "img");
    stars.setAttribute("aria-label", t("{n} of 5 stars", { n: x.stars }));
    const dl = el("dl");
    const add = (k, v) => dl.append(el("dt", null, k), el("dd", null, v));
    add(t("Points"), x.points.toLocaleString());
    add(t("Right"), r.accuracy + "%");
    add(t("Longest run"), t("{n} in a row", { n: x.combo }));
    add(t("Right on time"), String(x.perfect));
    add(t("Wrong notes"), String(r.wrong));
    if (practice.engine.speed !== 1) add(t("Speed"), pct(practice.engine.speed));
    const row = el("div", "row");
    const done = () => { d.close(); d.remove(); };
    row.append(button(t("Play it again"), "btn primary", () => { done(); practice.act.restart(); practice.act.toggle(performance.now()); }), button(t("Close"), "btn", done));
    body.append(stars, dl, row);
    if (x.stars < 5) body.appendChild(el("p", "hint", t("Stars come from how much is right: 45% for one, then 65, 80, 90 and 97%.")));
    d.append(head, body);
    d.addEventListener("cancel", done);
    document.body.appendChild(d);
    d.showModal();
  }
  const MODES = [["wait", "Wait for me"], ["flow", "Flow"], ["recital", "Recital"], ["watch", "Watch and listen"]];

  function seg(options, onPick) {
    const box = el("div", "seg");
    box.setAttribute("role", "group");
    for (const [value, label] of options) {
      const b = button(label, null, () => onPick(value));
      b.dataset.value = value;
      b.setAttribute("aria-pressed", "false");
      box.appendChild(b);
    }
    return box;
  }
  function setSeg(box, value) { for (const b of box.children) b.setAttribute("aria-pressed", String(b.dataset.value === value)); }
  function group(label, ...kids) { const g = el("div", "group"); if (label) g.appendChild(el("span", "label", label)); g.append(...kids); return g; }
  function iconButton(name, label, onClick) { const b = button("", "icon-btn", onClick); b.appendChild(icon(name, 16)); b.title = label; b.setAttribute("aria-label", label); return b; }

  // Playing the drawn keyboard with the mouse or a finger.
  function mouseKeys(canvas) {
    let down = null;
    canvas.addEventListener("pointerdown", (e) => {
      const r = canvas.getBoundingClientRect();
      const m = practice.roll.keyFromPoint(e.clientX - r.left, e.clientY - r.top);
      if (m == null) return;
      canvas.setPointerCapture(e.pointerId);
      synth.unlock();
      down = m; routeNote(m, true, 90, performance.now(), "mouse");
    });
    const up = () => { if (down != null) { routeNote(down, false, 0, performance.now(), "mouse"); down = null; } };
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
  }

  // ---- shortcuts ----
  let captureKey = null;
  window.addEventListener("keydown", (e) => {
    if (captureKey) {
      const k = P.hotkeys.keyOf(e);
      if (!k) return;
      e.preventDefault(); e.stopImmediatePropagation();
      captureKey(k === "Escape" ? null : k);
      return;
    }
    if (e.metaKey || (menu && menu.open) || $("settings").open || themeOpen() || $("lesson-screen").hidden) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && e.target.type !== "range") return;
    const action = hot.actionForKey(P.hotkeys.keyOf(e));
    if (!action) return;
    e.preventDefault();
    runAction(action);
  }, true);

  function runAction(a) {
    if (!practice || $("lesson-screen").hidden) return;
    const e = practice.engine;
    switch (a) {
      case "toggle": practice.act.toggle(performance.now()); break;
      case "restart": practice.act.restart(); break;
      case "barBack": practice.act.bar(-1); break;
      case "barNext": practice.act.bar(1); break;
      case "faster": practice.act.speed(Math.min(1.5, e.speed + 0.05)); break;
      case "slower": practice.act.speed(Math.max(0.25, e.speed - 0.05)); break;
      case "loop": practice.act.loop(!e.loop.on); break;
      case "mode": practice.act.mode(e.mode === "wait" ? "flow" : "wait"); break;
      case "metronome": practice.act.metronome(!e.metronome); break;
      case "record": toggleRecord(); break;
      case "library": if (editingLayout) toggleLayoutEditor(false); else showLibrary(); break;
    }
  }

  // ---- settings ----
  // ---- settings: a page per topic, each setting a row with its control
  // on the right ----
  let settingsTab = "piano";
  function renderSettings() {
    const dlg = $("settings");
    const head = el("div", "sheet-head");
    const h = el("h2", null, t("Settings")); h.id = "settings-title";
    head.append(h, iconButton("x", t("Close"), () => dlg.close()));
    const pages = [
      ["piano", "piano", t("Piano"), pianoPage],
      ["practice", "target", t("Practice"), practicePage],
      ["sound", "volume", t("Sound"), soundPage],
      ["shortcuts", "keyboard", t("Shortcuts"), shortcutsSection],
      ["look", "palette", t("Look"), lookPage],
      ["progress", "chart", t("Your progress"), progressPage],
      ["about", "info", t("About"), aboutPage],
    ];
    if (!pages.some((p) => p[0] === settingsTab)) settingsTab = "piano";
    const nav = el("nav", "settings-nav");
    nav.setAttribute("aria-label", t("Settings pages"));
    const pane = el("div", "settings-pane");
    for (const [id, ic, label, make] of pages) {
      const b = button("", "settings-tab", () => { settingsTab = id; renderSettings(); });
      b.append(icon(ic), el("span", null, label));
      b.setAttribute("aria-current", String(id === settingsTab));
      nav.appendChild(b);
      if (id === settingsTab) { const page = make(); page.classList.add("settings-page"); pane.appendChild(page); }
    }
    const body = el("div", "settings-body");
    body.append(nav, pane);
    dlg.replaceChildren(head, body);
  }

  // A labelled row: what it is (and a line on why) on the left, the
  // control on the right.
  function setting(label, control, hint) {
    const row = el("div", "set-row");
    const text = el("div", "set-text");
    const id = "set-" + Math.random().toString(36).slice(2, 8);
    const name = el("label", "set-label", label); name.htmlFor = id;
    text.appendChild(name);
    if (hint) text.appendChild(el("p", "set-hint", hint));
    const focusable = control.matches && control.matches("input, select, button") ? control : control.querySelector && control.querySelector("input, select");
    if (focusable) focusable.id = id;
    const ctl = el("div", "set-control"); ctl.appendChild(control);
    row.append(text, ctl);
    return row;
  }
  function toggle(label, key, hint, onChange) {
    const c = document.createElement("input"); c.type = "checkbox"; c.className = "switch"; c.checked = !!settings.get(key);
    c.setAttribute("role", "switch");
    c.addEventListener("change", () => { settings.set(key, c.checked); if (onChange) onChange(c.checked); });
    return setting(label, c, hint);
  }
  function setGroup(title, ...rows) {
    const g = el("div", "set-group");
    if (title) g.appendChild(el("h4", null, title));
    const card = el("div", "set-card"); card.append(...rows.filter(Boolean));
    g.appendChild(card);
    return g;
  }
  function page(title, intro, ...groups) {
    const s = document.createElement("section");
    s.appendChild(el("h3", null, title));
    if (intro) s.appendChild(intro);
    s.append(...groups.filter(Boolean));
    return s;
  }
  function select(options, value, onChange) {
    const s = document.createElement("select");
    for (const [v, label] of options) s.appendChild(new Option(label, v));
    s.value = value;
    s.addEventListener("change", () => onChange(s.value));
    return s;
  }

  function pianoPage() {
    const d = midi.devices();
    const ok = d.status !== "unsupported" && d.status !== "denied" && d.inputs.length > 0;
    const status = d.status === "unsupported" ? t("This browser has no MIDI. The desktop app, Chrome and Edge do.")
      : d.status === "denied" ? t("MIDI access was blocked. Allow it for this app and reopen it.")
        : d.inputs.length ? d.inputs.map((i) => i.name).join(", ") : t("No piano found. Connect it by USB; it shows up here by itself.");
    const card = el("div", "device-card" + (ok ? " on" : ""));
    card.append(icon("piano", 22), el("div", "grow"));
    card.lastChild.append(el("strong", null, ok ? t("Connected") : t("No piano")), el("span", "dim", status));
    const out = select([["", t("The app's own sound")], ...d.outputs.map((o) => [o.id, o.name])], settings.get("output") || "", (v) => { settings.set("output", v); midi.setOutput(v); });
    const lights = select([["-1", t("Off")], ...Array.from({ length: 16 }, (_, c) => [String(c), t("Channel {n}", { n: c + 1 })])], String(settings.get("lightChannel")),
      (v) => { midi.light([], settings.get("lightChannel")); settings.set("lightChannel", +v); });
    const lat = range(0, 300, 5, settings.get("latency"), (v) => { settings.set("latency", v); practice && practice.engine.setLatency(v); }, (v) => t("{n} ms", { n: v }));
    const calNote = el("p", "set-hint", t("Tap any piano key with each of eight clicks. Use it if notes you play on time count as late."));
    const measure = button(t("Measure"), "btn", () => calibrate(calNote, lat));
    measure.prepend(icon("timer"));
    const latRow = setting(t("Timing delay"), lat, null);
    latRow.querySelector(".set-text").appendChild(calNote);
    latRow.querySelector(".set-control").appendChild(measure);
    const curve = select([["light", t("Light: soft presses count louder")], ["normal", t("Normal")], ["heavy", t("Heavy: you have to press harder")], ["fixed", t("Fixed: every press the same")]],
      settings.get("touch") || "normal", (v) => settings.set("touch", v));
    const floor = range(0, 40, 2, settings.get("touchFloor") || 0, (v) => settings.set("touchFloor", v), (v) => (v ? String(v) : t("off")));
    return page(t("Piano"), card,
      setGroup(t("Touch"),
        setting(t("Touch response"), curve, t("How hard a press counts. If loud and soft are judged wrong for how you play, change this first.")),
        setting(t("Ignore presses lighter than"), floor, t("For a keyboard that sends a note when you only brush a key.")),
        toggle(t("Count a key once"), "doubles", t("Drops a second press of the same key within 40 ms, for a keyboard Windows lists twice."))),
      setGroup(t("Sound"),
        setting(t("The app's notes play on"), out, t("Your piano, if it has MIDI in, or the app's own sound.")),
        toggle(t("Play my notes in the app too"), "echo", t("For a keyboard with no speakers of its own."))),
      setGroup(t("Playing"),
        latRow,
        toggle(t("Computer keyboard as a piano"), "typing", t("A is middle C; Z and X change octave.")),
        setting(t("Lit keys"), lights, t("Lights the next notes on a keyboard with lights in its keys, on its lighting channel."))),
      delayCheck());
  }

  function practicePage() {
    return page(t("Practice"), null,
      setGroup(t("Falling notes"),
        setting(t("How far ahead"), range(1, 8, 0.5, settings.get("lookahead"), (v) => { settings.set("lookahead", v); practice && practice.draw(); }, (v) => t("{n} s", { n: v }))),
        setting(t("Keyboard"), select([["song", t("Just the piece's notes")], ["full", t("All 88 keys")]], settings.get("range"), (v) => { settings.set("range", v); practice && practice.roll.setRange(v); practice && practice.draw(); })),
        setting(t("Note names"), select([["off", t("None")], ["letters", t("Letters (C D E)")], ["solfege", t("Solfège (Do Re Mi)")]], settings.get("noteNames"), (v) => { settings.set("noteNames", v); applyLabels(); })),
        toggle(t("Finger numbers"), "fingers", t("Where the music has them."), applyLabels),
        toggle(t("Chords above the falling notes"), "prompter", t("The last, current and next chord while a piece plays."), () => { chordSeq = null; prompt(); })),
      setGroup(t("MIDI files"),
        toggle(t("Skip empty bars at the start"), "skipEmptyBars", t("Opens a file where the music starts. The file isn't changed. From the next file you open."))),
      setGroup(t("Goals"),
        setting(t("Daily goal"), range(0, 60, 5, settings.get("goal"), (v) => { settings.set("goal", v); statsSoon(); }, (v) => (v ? t("{n} min", { n: v }) : t("none"))), t("Today's practice is timed to it.")),
        setting(t("Auto speed-up stops at"), range(50, 150, 5, settings.get("autoSpeedGoal"), (v) => settings.set("autoSpeedGoal", v), (v) => v + "%"), t("Each clean pass of a loop goes 5% faster, up to here."))));
  }

  function soundPage() {
    return page(t("Sound"), null,
      setGroup(null,
        setting(t("Piano"), select([["grand", t("Grand piano (recorded)")], ["simple", t("Simple (made by the app)")]], settings.get("sound"), (v) => { settings.set("sound", v); synth.setSound(v); }),
          t("The grand is a recorded Yamaha; the simple one loads nothing.")),
        setting(t("Volume"), range(0, 1, 0.05, settings.get("volume"), (v) => { settings.set("volume", v); synth.setVolume(v); }, (v) => Math.round(v * 100) + "%")),
        setting(t("Room"), range(0, 0.5, 0.02, settings.get("room"), (v) => { settings.set("room", v); synth.setRoom(v); }, (v) => Math.round(v * 200) + "%"), t("How much the sound rings around the room.")),
        setting(t("The app's hand"), range(0.2, 1, 0.05, settings.get("autoVolume") ?? 0.8, (v) => settings.set("autoVolume", v), (v) => Math.round(v * 100) + "%"), t("How loud the hand the app plays is, beside yours."))));
  }

  function lookPage() {
    const theme = select([["system", t("Like Windows")], ["light", t("Light")], ["dark", t("Dark")]], settings.get("theme"), (v) => { settings.set("theme", v); applyTheme(); });
    const fx = select([["off", t("Off")], ["subtle", t("Subtle")], ["full", t("Full")]], effectsLevel(), (v) => { settings.set("effects", v); applyEffects(); });
    const editColours = button(t("Edit colours"), "btn", () => { $("settings").close(); openThemeEditor(); });
    editColours.prepend(icon("palette"));
    const reset = button(t("Reset"), "btn", () => { settings.set("layout", null); if (!$("lesson-screen").hidden) renderLayout(); toast(t("Layout reset")); });
    return page(t("Look"), null,
      setGroup(null,
        setting(t("Theme"), theme),
        setting(t("Colours"), editColours, t("Change any colour, for light and dark, with a check that text stays readable.")),
        setting(t("Glow and sparks on the keys"), fx, t("Off when Windows asks for less motion.")),
        setting(t("Panel layout"), reset, t("To move panels, use the layout button at the top of a lesson."))));
  }

  function progressPage() {
    const exp = button(t("Save a copy"), "btn", () => downloadBytes(new TextEncoder().encode(JSON.stringify(progress.all(), null, 1)), "piano-progress.json", "application/json"));
    exp.prepend(icon("download"));
    const imp = button(t("Load a copy"), "btn", () => {
      const input = document.createElement("input"); input.type = "file"; input.accept = ".json,application/json";
      input.addEventListener("change", async () => {
        const f = input.files[0]; if (!f) return;
        let ok = false; try { ok = progress.replace(JSON.parse(await f.text())); } catch (e) { ok = false; }
        toast(ok ? t("Progress loaded") : t("That file isn't saved progress from this app."));
      });
      input.click();
    });
    imp.prepend(icon("upload"));
    const all = progress.all();
    const pieces = Object.keys(all.pieces).length, secs = Object.values(all.days).reduce((a, b) => a + b, 0);
    const tiles = el("div", "tiles");
    tiles.append(tile(minutes(secs), t("practised")), tile(String(pieces), t("pieces and drills")), tile(String(progress.streak(today())), t("days in a row")));
    return page(t("Your progress"), tiles,
      setGroup(null,
        setting(t("Save a copy"), exp, t("Kept on this computer only. A copy moves it to another one.")),
        setting(t("Load a copy"), imp, t("Replaces what's here with the copy."))));
  }

  function aboutPage() {
    const credits = [
      ["abcjs", t("draws ABC music")], ["OpenSheetMusicDisplay", t("draws MusicXML")], ["markdown-it", t("reads lessons")],
      ["pdf.js", t("shows PDF books")], ["Salamander Grand Piano", t("the piano sound, by Alexander Holm, CC-BY 3.0")], ["Lucide", t("icons")], ["Mutopia Project", t("free sheet music in Find music, each piece under its own licence")],
      ["PDMX", t("the PDMX collection in Find music, by Phillip Long and others at UC San Diego, CC BY 4.0")],
    ];
    const list = el("div", "set-card");
    for (const [name, what] of credits) { const r = el("div", "set-row"); r.append(el("strong", null, name), el("span", "dim", what)); list.appendChild(r); }
    return page(t("About"), el("p", "dim", t("Piano, version {v}. A practice app for your own lessons, on this computer.", { v: APP_VERSION })),
      updatesGroup(), dataGroup(), el("h4", null, t("Made with")), list);
  }

  // ---- the Windows app: updates in place, and where the data lives (src-tauri/src/portable.rs) ----
  const invoke = (cmd, args) => window.__TAURI__.core.invoke(cmd, args);
  let update = null, updateState = "", dataLoc = null;
  async function checkUpdate(byHand) {
    if (!K.platform.desktop) return;
    updateState = "checking"; if ($("settings").open) renderSettings();
    try {
      update = await invoke("update_check");
      updateState = update ? "ready" : "current";
      settings.set("updateChecked", Date.now());
    } catch (e) {
      updateState = "failed";
      if (byHand) toast(t("Couldn't reach GitHub to check for updates: {why}", { why: String(e) }));
    }
    renderUpdateNotice();
    if ($("settings").open) renderSettings();
  }
  async function installUpdate() {
    if (!update) return;
    updateState = "installing"; renderUpdateNotice(); if ($("settings").open) renderSettings();
    progress.flush();
    try { await invoke("update_install", { exe: update.exe, sig: update.sig }); }
    catch (e) {
      updateState = "ready"; renderUpdateNotice(); if ($("settings").open) renderSettings();
      const why = String(e);
      if (why === "readonly") toast(t("Piano can't write to its own folder, so it can't update itself here. Download the new version from GitHub."), 6000);
      else if (why === "signature") toast(t("The download wasn't signed by Piano's key, so it wasn't installed."), 6000);
      else if (why === "nokey") toast(t("This copy has no update key, so it can't check a download. Download the new version from GitHub."), 6000);
      else toast(t("The update didn't install: {why}", { why }), 6000);
    }
  }
  function renderUpdateNotice() {
    const b = $("update");
    b.hidden = !(update && (updateState === "ready" || updateState === "installing"));
    if (!b.hidden) b.textContent = updateState === "installing" ? t("Updating to {v}…", { v: update.version }) : t("Version {v} is ready: update and restart", { v: update.version });
    b.disabled = updateState === "installing";
  }
  function updatesGroup() {
    if (!K.platform.desktop) return null;
    const state = { checking: t("Checking…"), current: t("This is the newest version."), failed: t("Couldn't reach GitHub."), installing: t("Downloading and checking the signature…") }[updateState]
      || (update ? t("Version {v} is ready.", { v: update.version }) : t("Checked when the app starts, once a day."));
    const btns = el("div", "row");
    if (update) {
      btns.appendChild(button(t("Update and restart"), "btn primary", () => installUpdate()));
      btns.appendChild(button(t("What's new"), "btn", () => K.platform.openOutside(update.page)));
    } else btns.appendChild(button(t("Check now"), "btn", () => checkUpdate(true)));
    return setGroup(t("Updates"), setting(t("Updates"), btns, state + " " + t("A new version replaces Piano.exe in its folder, only when it carries Piano's signature.")));
  }
  function dataGroup() {
    if (!K.platform.desktop) return null;
    if (!dataLoc) { invoke("data_location").then((l) => { dataLoc = l; if ($("settings").open) renderSettings(); }).catch(() => {}); return null; }
    const names = { portable: t("With the app (portable)"), appdata: t("This computer's AppData"), custom: t("Another folder") };
    const pick = select(Object.entries(names), dataLoc.mode, async (v) => {
      let path = null;
      if (v === "custom") {
        try { path = await invoke("plugin:dialog|open", { options: { directory: true, title: t("Where should Piano keep your data?") } }); } catch (e) { path = null; }
        if (!path) { pick.value = dataLoc.mode; return; }
      }
      if (!(await confirmMove(path || names[v]))) { pick.value = dataLoc.mode; return; }
      progress.flush();
      try { await invoke("set_data_location", { mode: v, path }); }
      catch (e) {
        pick.value = dataLoc.mode;
        toast(String(e) === "readonly" ? t("Piano's folder is read-only, so the data can't live beside it.") : t("Piano can't write to that folder."), 6000);
      }
    });
    pick.disabled = !dataLoc.exe_writable;
    const hint = [t("Now in {path}.", { path: dataLoc.dir })];
    if (dataLoc.problem === "readonly") hint.push(t("Piano's folder is read-only, so the data is in AppData."));
    if (dataLoc.problem === "missing") hint.push(t("The folder you picked isn't there, so the data is in AppData for now."));
    if (!dataLoc.exe_writable) hint.push(t("Move Piano to a folder you can write to, to choose."));
    hint.push(t("Changing it copies your data over and restarts; the old copy stays."));
    return setGroup(t("Your data"), setting(t("Keep settings and progress"), pick, hint.join(" ")));
  }
  function confirmMove(where) {
    return new Promise((resolve) => {
      const d = el("dialog", "sheet");
      const head = el("div", "sheet-head"); head.appendChild(el("h2", null, t("Move your data?")));
      const body = el("div", "sheet-body");
      body.append(el("p", null, t("Piano restarts and copies your settings and progress to {where}. The old copy stays where it is.", { where })));
      const row = el("div", "row");
      const done = (v) => { d.close(); d.remove(); resolve(v); };
      row.append(button(t("Move and restart"), "btn primary", () => done(true)), button(t("Cancel"), "btn", () => done(false)));
      body.appendChild(row);
      d.append(head, body);
      d.addEventListener("cancel", () => done(false));
      document.body.appendChild(d);
      d.showModal();
    });
  }

  // Where the time goes between a key and the sound: the keyboard's
  // message reaching the app, the sound's buffer, then Windows and the
  // speakers. Sound first heard after the first key.
  function delayCheck() {
    const body = el("div", "delay-check");
    function fill() {
      const key = midi.inputDelay(), snd = synth.delay();
      const rows = [
        [t("Key to app"), key ? t("{n} ms", { n: key.average.toFixed(1) }) : "–", key ? t("worst {n} ms, last {c} keys", { n: key.worst.toFixed(1), c: key.count }) : t("Play a few keys on your piano")],
        [t("Sound buffer"), snd ? t("{n} ms", { n: snd.buffer }) : "–", snd ? t("The app's own") : t("Known once the app has made a sound")],
        [t("Windows and speakers"), snd ? t("{n} ms", { n: snd.output }) : "–", t("Bluetooth speakers add 100 ms or more")],
      ];
      const total = (key ? key.average : 0) + (snd ? snd.buffer + snd.output : 0);
      body.replaceChildren(...rows.map(([a, b, c]) => { const r = el("div", "delay-row"); r.append(el("span", null, a), el("strong", null, b), el("span", "dim", c)); return r; }));
      const sum = el("div", "delay-row total"); sum.append(el("span", null, t("Key to speaker, in the app's sound")), el("strong", null, key && snd ? t("about {n} ms", { n: Math.round(total) }) : "–"), el("span", "dim", t("Your piano's own sound has none of this")));
      body.appendChild(sum);
    }
    fill();
    const again = button(t("Check again"), "btn", () => { synth.unlock(); fill(); });
    again.prepend(icon("refresh"));
    const row = setting(t("Delay check"), again, t("Where the time goes between pressing a key and hearing the app."));
    row.classList.add("wide");
    row.querySelector(".set-text").appendChild(body);
    return setGroup(t("Delay"), row);
  }

  // Tap along with 8 clicks; the middle of your offsets is the delay.
  function calibrate(note, slider) {
    if (calibrating) return;
    synth.unlock();
    calibrating = true;
    const GAP = 600, LEAD = 2, COUNT = 8;
    const clicks = [], taps = [];
    note.textContent = t("Listen to two clicks, then tap with the next eight.");
    for (let i = 0; i < LEAD + COUNT; i++) {
      setTimeout(() => { synth.click(i < LEAD); if (i >= LEAD) clicks.push(performance.now()); }, 300 + i * GAP);
    }
    captureNote = () => { taps.push(performance.now()); };
    setTimeout(() => {
      calibrating = false; captureNote = null;
      const offs = [];
      for (const c of clicks) {
        const near = taps.map((x) => x - c).filter((d) => d > -150 && d < 300);
        if (near.length) offs.push(near.reduce((a, b) => (Math.abs(a) < Math.abs(b) ? a : b)));
      }
      if (offs.length < 5) { note.textContent = t("Not enough taps heard ({n} of 8). Try again, tapping with each click.", { n: offs.length }); return; }
      offs.sort((a, b) => a - b);
      const ms = Math.max(0, Math.min(300, Math.round(offs[offs.length >> 1] / 5) * 5));
      settings.set("latency", ms);
      if (practice) practice.engine.setLatency(ms);
      const input = slider.querySelector("input"); if (input) { input.value = String(ms); input.dispatchEvent(new Event("input")); }
      note.textContent = t("Measured {n} ms. Notes are now judged that much earlier.", { n: ms });
    }, 300 + (LEAD + COUNT) * GAP + 400);
  }

  function section(title) { const s = document.createElement("section"); s.appendChild(el("h3", null, title)); return s; }
  function field(label, control) { const f = el("label", "field"); f.append(el("span", null, label), control); return f; }
  function check(label, key) {
    const l = el("label", "check");
    const c = document.createElement("input"); c.type = "checkbox"; c.checked = !!settings.get(key);
    c.addEventListener("change", () => settings.set(key, c.checked));
    l.append(c, el("span", null, label));
    return l;
  }
  function range(min, max, step, value, onInput, fmt) {
    const box = el("div", "row");
    const r = document.createElement("input");
    r.type = "range"; r.min = min; r.max = max; r.step = step; r.value = value;
    const v = el("span", "speed-value", fmt(value));
    r.addEventListener("input", () => { v.textContent = fmt(+r.value); onInput(+r.value); });
    box.append(r, v);
    return box;
  }

  // ---- progress: time per day, runs, best tempo, weak bars ----
  const progress = P.progress.create({
    load: () => JSON.parse(localStorage.getItem("piano.progress") || "null"),
    save: (d) => localStorage.setItem("piano.progress", JSON.stringify(d)),
  });
  const today = () => P.progress.dayKey(new Date());
  let passes = [];

  // What the progress is filed under: a piece by its file (the same piece
  // from two lessons is one piece), an exercise by its lesson and place.
  function pieceKey() {
    const s = lessonState, tg = practice && practice.target;
    if (tg && tg.source && tg.source.drill) return "drill|" + tg.source.drill;
    if (!s || !tg || !tg.source || !s.course) return null;
    if (tg.source.piece != null) { const pc = s.pieces[tg.source.piece]; return pc && !pc.data ? s.course + "|" + pc.path : null; }
    return s.course + "|" + s.path + "#" + tg.source.block;
  }
  function pieceTitle() {
    const tg = practice && practice.target;
    if (!tg) return "";
    if (tg.source && tg.source.drill) return tg.source.label;
    if (tg.source && tg.source.block != null) return (tg.title || t("Exercise {n}", { n: tg.source.block + 1 })) + ", " + ($("title").textContent || "");
    return tg.title || "";
  }

  function onEvent(e) {
    if (e.type === "state") { if (e.playing) takeStart(); else takeEnd(); }
    if (e.type === "hit" && take) take.hits.push(e);
    if (e.type === "loop") { takeEnd(); if (practice.engine.playing) takeStart(); }
    if (e.type === "loop" && e.clean && plan && plan.key === pieceKey()) setTimeout(() => { if (!plan) return; toast(t("Clean. Next: {step}", { step: plan.at + 1 < plan.steps.length ? planLabel(plan.steps[plan.at + 1]) : t("done") })); planStep(1); }, 0);
    if (e.type !== "loop" && e.type !== "end") return;
    const song = practice.song; if (!song) return;
    // Listening to the app play both hands isn't a run of yours.
    if (!(e.stats.hits + e.stats.late + e.stats.misses)) return;
    const run = { speed: practice.engine.speed, mode: practice.engine.mode, stats: e.stats, clean: !!e.clean,
      kind: e.type === "loop" ? "pass" : "run", bars: P.progress.barsOf(song, practice.engine.results), recital: e.recital || null };
    passes.unshift({ ...run, n: e.pass || null });
    if (passes.length > 12) passes.length = 12;
    const key = pieceKey();
    if (key) { progress.addRun(key, pieceTitle(), run, today()); progress.flush(); }
    statsSoon();
    if (e.type === "end" && lessonState && lessonState.drill && drillSettings().next) setTimeout(() => { if (lessonState && lessonState.drill && !practice.engine.playing) newDrill(); }, 1800);
  }

  // A second of practice counts while the music moves or you've played in
  // the last 15 seconds, with the window in front.
  let ticks = 0;
  setInterval(() => {
    if (!practice || $("lesson-screen").hidden || document.visibilityState !== "visible") return;
    if (!(practice.engine.playing || performance.now() - lastNoteAt < 15000)) return;
    progress.addTime(pieceKey(), pieceTitle(), 1, today());
    if (++ticks % 15 === 0) { progress.flush(); statsSoon(); }
    if (ticks % 30 === 0) renderToday();
  }, 1000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") progress.flush(); });
  window.addEventListener("pagehide", () => progress.flush());

  let statsTimer = 0;
  function statsSoon() { if (!statsTimer) statsTimer = setTimeout(() => { statsTimer = 0; renderStats(); }, 400); }
  setInterval(() => { if (practice && practice.engine.playing) statsSoon(); }, 1000);

  const pct = (x) => Math.round(x * 100) + "%";
  const minutes = (sec) => sec < 60 ? t("{n} s", { n: Math.round(sec) }) : sec < 3600 ? t("{n} min", { n: Math.round(sec / 60) }) : t("{h} h {m} min", { h: Math.floor(sec / 3600), m: Math.round((sec % 3600) / 60) });
  function tile(value, label, cls) { const d = el("div", "tile" + (cls ? " " + cls : "")); d.append(el("strong", null, value), el("span", null, label)); return d; }

  function renderStats() {
    if (!practice || !mounts.stats || $("lesson-screen").hidden) return;
    const root = mounts.stats;
    const keep = root.scrollTop;
    const st = practice.state();
    const parts = [];
    if (st.song) {
      const s = st.stats;
      const live = el("section");
      live.appendChild(el("h4", null, t("This run")));
      const tiles = el("div", "tiles");
      tiles.append(tile(s.accuracy + "%", t("right")), tile(String(s.hits), t("on time"), "good"), tile(String(s.late), t("late"), "late"),
        tile(String(s.misses), t("missed"), "bad"), tile(String(s.wrong), t("wrong"), "bad"), tile(s.timing + " ms", t("off the beat")));
      live.appendChild(tiles);
      parts.push(live);
      const tk = takeSection();
      if (tk) parts.push(tk);
      const planned = pieceKey() && !(lessonState && lessonState.drill);
      if (planned && plan && plan.key === pieceKey()) parts.unshift(planSection());
      if (passes.length) {
        const sec = el("section");
        sec.appendChild(el("h4", null, t("Runs and passes")));
        const ul = el("ul", "passes");
        for (const p of passes.slice(0, 8)) {
          const li = document.createElement("li");
          li.append(el("span", null, p.kind === "pass" ? t("Pass {n}", { n: p.n }) : t("Whole piece")),
            el("span", null, p.stats.accuracy + "%" + (p.clean ? ", " + t("clean") : "")), el("span", "dim", pct(p.speed) + ", " + t(p.mode === "recital" ? "recital" : p.mode === "flow" ? "flow" : "wait")));
          ul.appendChild(li);
        }
        sec.appendChild(ul);
        parts.push(sec);
      }
      const key = pieceKey();
      const pc = key && progress.piece(key);
      const piece = el("section");
      piece.appendChild(el("h4", null, t("This piece, all time")));
      if (pc) {
        const tiles2 = el("div", "tiles");
        tiles2.append(tile(pc.best ? pct(pc.best.speed) : "—", t("best tempo")), tile(String(pc.runs), t("runs")), tile(String(pc.clean), t("clean")), tile(minutes(pc.seconds), t("practised")));
        piece.appendChild(tiles2);
        const weak = progress.weakBars(key, 3);
        practice.score.trouble(weak.map((b) => b.measure));
        if (weak.length) {
          const w = el("div", "weak");
          w.appendChild(el("span", "dim", t("The bars that trip you up")));
          for (const b of weak) {
            const row = el("div", "row");
            row.append(el("span", null, t("Bar {n}", { n: b.measure + 1 }) + ", " + t("{n}% trouble", { n: Math.round(b.score * 100) })), button(t("Loop it"), "btn", () => practice.act.loopMeasure(b.measure)));
            w.appendChild(row);
          }
          piece.appendChild(w);
        }
      } else piece.appendChild(el("p", "dim", key ? t("Nothing yet. Finish a run or a loop pass and it shows here.") : t("Pieces you opened as single files aren't tracked.")));
      if (pc && !pc.best) piece.appendChild(el("p", "dim", t("Best tempo counts flow and recital runs with {n}% or more right.", { n: P.progress.GOOD })));
      parts.push(piece);
      if (planned && !(plan && plan.key === pieceKey())) parts.push(planSection());
    }
    parts.push(daysSection());
    root.replaceChildren(...parts);
    root.scrollTop = keep;
  }

  function daysSection() {
    const sec = el("section");
    const d = today();
    sec.appendChild(el("h4", null, t("Practice days")));
    const list = progress.days(14, d);
    const max = Math.max(600, ...list.map((x) => x.seconds));
    const bars = el("div", "days");
    for (const x of list) {
      const b = el("div", "day" + (x.seconds ? "" : " none") + (x.day === d ? " today" : ""));
      b.style.height = Math.max(4, Math.round((x.seconds / max) * 100)) + "%";
      b.title = x.day + ": " + minutes(x.seconds);
      bars.appendChild(b);
    }
    sec.appendChild(bars);
    const goal = settings.get("goal") || 0;
    const streak = progress.streak(d, Math.max(60, goal * 60));
    const done = progress.today(d);
    const line = el("p", "dim streak");
    if (streak > 1) line.appendChild(icon("flame"));
    line.append(t("Today {time}", { time: minutes(done) }) + (goal ? " " + t("of {n} min", { n: goal }) + (done >= goal * 60 ? ", " + t("goal met") : "") : "") + (streak > 1 ? ", " + t("{n} days in a row", { n: streak }) : ""));
    sec.appendChild(line);
    if (goal) {
      const meter = document.createElement("progress");
      meter.className = "goal"; meter.max = goal * 60; meter.value = Math.min(goal * 60, done);
      meter.setAttribute("aria-label", t("Today's goal"));
      sec.appendChild(meter);
    }
    return sec;
  }
  function daysCard() { const c = el("div", "days-card"); c.appendChild(daysSection()); return c; }

  // ---- the book ----
  async function openBook(ref, reveal) {
    const b = P.lesson.bookRef(ref);
    if (!b || !lessonState || !lessonState.course) return;
    const path = P.lesson.resolve(lessonState.path || lessonState.piecePath || "", b.file);
    const id = lessonState.course + "|" + path;
    try {
      const shown = P.layout.panels(currentLayout());
      if (!shown.includes("book")) {
        // A book opened by hand takes the lesson's side; one a lesson opens sits at the right edge.
        setLayout(reveal ? P.layout.place(currentLayout(), "book", shown.includes("lesson") ? "lesson" : shown[0], "right") : { dir: "row", sizes: [0.72, 0.28], children: [currentLayout(), "book"] });
        autoBook = !reveal;
      }
      const page = b.page || (settings.get("bookPages") || {})[id] || 1;
      if (pdf.key === id) { pdf.go(page); return; }
      const r = await library.read(lessonState.course, path, "bytes");
      await pdf.open(r.data, page, id, b.file.split("/").pop());
    } catch (e) {
      toast(t("Couldn't open the book: {why}", { why: e.message || String(e) }));
    }
  }

  // Music without a book closes the last one, and takes its panel away if
  // a lesson put it there.
  let autoBook = false;
  function dropBook() {
    if (pdf.key) pdf.close();
    if (autoBook && P.layout.panels(currentLayout()).includes("book")) setLayout(P.layout.remove(currentLayout(), "book"));
    autoBook = false;
  }

  // ---- free play and recording ----
  async function openFree() {
    lessonState = { course: null, path: null, meta: {}, blocks: [], pieces: [], active: null, free: true };
    dropBook();
    showLessonScreen(t("Free play"));
    mounts.lesson.replaceChildren(el("h1", null, t("Free play")),
      el("p", null, t("Play anything. What you play rises from the keys.")),
      el("p", "dim", t("Press record (or Shift+R) to keep it as a MIDI file.")));
    passes = [];
    await practice.load({ kind: "free", message: t("No music in free play: just you and the keys.") });
    renderStats();
  }

  let recTimer = 0;
  // The last recording's layers, for recording another over them; and the
  // playback of the earlier layers while a new one records.
  let layers = [], layering = false, stopLayers = null;
  async function toggleRecord(over = false) {
    if (!recorder.recording) {
      synth.unlock();
      layering = over && layers.length > 0;
      recorder.start(performance.now(), { keepStart: layering });
      if (layering) stopLayers = P.takes.play({ take: { notes: layers.flat(), speed: 1 }, withMusic: false,
        sound: (m, on, vel) => (on ? synth.noteOn(m, vel) : synth.noteOff(m)) });
      tr.record.setAttribute("aria-pressed", "true");
      tr.record.title = t("Stop recording"); tr.record.setAttribute("aria-label", tr.record.title);
      const tick = () => { const s = Math.floor(recorder.elapsed(performance.now()) / 1000); tr.recTime.textContent = Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
      tick(); recTimer = setInterval(tick, 500);
      return;
    }
    const notes = recorder.stop(performance.now());
    if (stopLayers) { stopLayers(); stopLayers = null; }
    clearInterval(recTimer);
    tr.recTime.textContent = "";
    tr.record.setAttribute("aria-pressed", "false");
    tr.record.title = t("Record what you play"); tr.record.setAttribute("aria-label", tr.record.title);
    if (!notes.length) { toast(t("Nothing was played, so nothing was saved.")); return; }
    const d = new Date();
    layers = layering ? [...layers, notes] : [notes];
    const name = "take " + today() + " " + String(d.getHours()).padStart(2, "0") + "." + String(d.getMinutes()).padStart(2, "0") + (layers.length > 1 ? " " + layers.length + " layers" : "") + ".mid";
    const bytes = P.midifile.write(layers.length > 1 ? layers : notes);
    try {
      if (lessonState && lessonState.course && library.writable(lessonState.course)) {
        await library.write(lessonState.course, "recordings/" + name, bytes);
        toast(t("Saved as recordings/{name} in the lesson's folder", { name }), 5000);
      } else await downloadBytes(bytes, name, "audio/midi");
    } catch (e) {
      if (e && e.name === "AbortError") return;
      toast(t("Couldn't save the recording: {why}", { why: e.message || String(e) }));
    }
  }

  // Saves bytes where you choose (the system's save dialog where there is
  // one, else a download).
  async function downloadBytes(bytes, name, type) {
    if (window.showSaveFilePicker) {
      const ext = name.slice(name.lastIndexOf("."));
      const h = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: ext.slice(1).toUpperCase(), accept: { [type]: [ext] } }] });
      const w = await h.createWritable(); await w.write(bytes); await w.close();
      toast(t("Saved {name}", { name: h.name }));
      return;
    }
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    const a = document.createElement("a"); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // ---- the lesson editor ----
  function editorShown() { return !!editor && P.layout.panels(currentLayout()).includes("editor") && !$("lesson-screen").hidden; }
  function toggleEditor(on) {
    const want = on == null ? !editorShown() : on;
    const tree = currentLayout();
    if (want) {
      if (!lessonState || !lessonState.path) { toast(t("Open a lesson to edit it.")); return; }
      if (!P.layout.panels(tree).includes("editor")) setLayout({ dir: "row", sizes: [0.3, 0.7], children: ["editor", tree] });
      loadEditor();
      editor.focus();
    } else if (P.layout.panels(tree).includes("editor")) {
      if (editor.dirty) toast(t("Your changes are kept as a draft until you save them."), 4000);
      setLayout(P.layout.remove(tree, "editor"));
    }
    editBtn.setAttribute("aria-pressed", String(want));
  }
  function loadEditor() {
    if (!lessonState || !lessonState.path) return;
    const restored = editor.open(lessonState.text || "", lessonState.course + "|" + lessonState.path);
    if (restored) { toast(t("Unsaved changes from before, restored."), 4000); previewLesson(editor.text); }
    editBtn.setAttribute("aria-pressed", "true");
  }
  // The lesson panel shows the text as you type it.
  function previewLesson(text) {
    if (!lessonState) return;
    const s = lessonState;
    const before = s.active && s.active.block != null && s.blocks[s.active.block] ? s.blocks[s.active.block].text : null;
    const fm = P.lesson.frontMatter(text);
    s.meta = fm.meta;
    const keep = mounts.lesson.scrollTop;
    renderLessonText(fm.body);
    mounts.lesson.scrollTop = keep;
    if (s.active && s.active.block != null && s.blocks[s.active.block] && s.blocks[s.active.block].text !== before && !practice.engine.playing) activate(s.active);
  }
  async function saveLesson(text) {
    const s = lessonState;
    if (!s || !s.path) return;
    if (s.course && library.writable(s.course)) {
      await library.write(s.course, s.path, text);
      s.text = text;
      s.modified = await library.modified(s.course, s.path);
      toast(t("Saved"));
    } else {
      await downloadBytes(new TextEncoder().encode(text), s.path.split("/").pop(), "text/markdown");
      s.text = text;
    }
  }

  // ---- effects, video, lit keys ----
  function effectsLevel() {
    const v = settings.get("effects");
    if (v) return v;
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "off" : "subtle";
  }
  function applyEffects() { fx.setLevel(effectsLevel()); practice.setEffects(effectsLevel() === "off" ? null : fx); }

  let video = null;
  function toggleVideo() {
    if (video) { video.stop(); return; }
    const canvas = mounts.roll.querySelector("canvas");
    if (!canvas.captureStream || !window.MediaRecorder) { toast(t("Video recording isn't available here.")); return; }
    synth.unlock();
    const tracks = [...canvas.captureStream(60).getVideoTracks()];
    const audio = synth.stream();
    if (audio) tracks.push(...audio.getAudioTracks());
    const type = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((x) => MediaRecorder.isTypeSupported(x)) || "";
    const rec = new MediaRecorder(new MediaStream(tracks), type ? { mimeType: type, videoBitsPerSecond: 6e6 } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = async () => {
      video = null;
      tr.video.setAttribute("aria-pressed", "false");
      for (const tk of tracks) if (tk.kind === "video") tk.stop();
      if (!chunks.length) return;
      toast(t("Saving the video…"), 1500);
      const bytes = new Uint8Array(await new Blob(chunks, { type: "video/webm" }).arrayBuffer());
      const d = new Date();
      try { await downloadBytes(bytes, "piano " + today() + " " + String(d.getHours()).padStart(2, "0") + "." + String(d.getMinutes()).padStart(2, "0") + ".webm", "video/webm"); }
      catch (e) { if (!e || e.name !== "AbortError") toast(t("Couldn't save the video: {why}", { why: e.message || String(e) })); }
    };
    rec.start(1000);
    video = rec;
    tr.video.setAttribute("aria-pressed", "true");
    toast(midi.hasOutput ? t("Recording the falling notes. Notes sent to your piano aren't in the sound.") : t("Recording the falling notes and the app's sound. Press again to stop."), 4000);
  }

  // ---- practice plan: sections, hands, then speed ----
  let plan = null;
  function planLabel(s) {
    const where = s.whole ? t("Whole piece") : s.from === s.to ? t("Bar {n}", { n: s.from + 1 }) : t("Bars {a}–{b}", { a: s.from + 1, b: s.to + 1 });
    const who = t(s.hands === "both" ? "both hands" : s.hands === "left" ? "left hand" : "right hand");
    return where + ", " + who + ", " + Math.round(s.speed * 100) + "%";
  }
  function startPlan(at = 0) {
    const key = pieceKey(), song = practice.song;
    if (!key || !song) return;
    const steps = P.plan.make(song);
    if (!steps.length) return;
    plan = { key, steps, at: Math.min(at, steps.length - 1) };
    applyPlanStep();
  }
  function applyPlanStep() {
    const s = plan.steps[plan.at];
    const all = { ...(settings.get("plans") || {}) }; all[plan.key] = plan.at; settings.set("plans", all);
    practice.act.hand("right", s.hands === "left" ? "auto" : "me");
    practice.act.hand("left", s.hands === "right" ? "auto" : "me");
    practice.act.speed(s.speed);
    practice.act.loopMeasures(s.from, s.to);
    statsSoon();
  }
  function planStep(delta) {
    if (!plan) return;
    const next = plan.at + delta;
    if (next >= plan.steps.length) { endPlan(true); return; }
    plan.at = Math.max(0, next);
    applyPlanStep();
  }
  function endPlan(done) {
    if (done && plan) { const all = { ...(settings.get("plans") || {}) }; delete all[plan.key]; settings.set("plans", all); toast(t("Plan done: the whole piece, clean, at full speed.")); }
    plan = null;
    if (practice.song) practice.act.loop(false);
    statsSoon();
  }
  function planSection() {
    const sec = el("section", "plan");
    sec.appendChild(el("h4", null, t("Practice plan")));
    const key = pieceKey();
    if (plan && plan.key === key) {
      const s = plan.steps[plan.at];
      const bar = el("div", "plan-bar"); const fill = el("span"); fill.style.width = Math.round((100 * plan.at) / plan.steps.length) + "%"; bar.appendChild(fill);
      sec.append(el("p", "plan-now", planLabel(s)), bar, el("p", "dim", t("Step {n} of {all}. A clean loop pass moves you on.", { n: plan.at + 1, all: plan.steps.length })));
      const row = el("div", "row");
      row.append(button(t("Back"), "btn", () => planStep(-1)), button(t("Skip"), "btn", () => planStep(1)), button(t("Stop"), "btn", () => endPlan(false)));
      sec.appendChild(row);
    } else {
      const saved = key && (settings.get("plans") || {})[key];
      sec.appendChild(el("p", "dim", t("Learn it in sections: each hand, then both, from 60% up to full speed, then the whole piece.")));
      const row = el("div", "row");
      if (saved) row.appendChild(button(t("Continue at step {n}", { n: saved + 1 }), "btn primary", () => startPlan(saved)));
      row.appendChild(button(saved ? t("Start over") : t("Start the plan"), saved ? "btn" : "btn primary", () => startPlan(0)));
      sec.appendChild(row);
    }
    return sec;
  }

  // ---- takes: what you played, to hear again and to see ----
  let take = null, lastTake = null, stopReplay = null;
  function takeStart() { take = { rec: P.takes.recorder(), hits: [], from: practice.engine.time, speed: practice.engine.speed, mode: practice.engine.mode }; }
  function takeEnd() {
    if (!take) return;
    const notes = take.rec.done(practice.engine.time);
    if (notes.length) lastTake = { notes, hits: take.hits, from: take.from, speed: take.speed, mode: take.mode, song: practice.song,
      dynamics: P.takes.dynamics(take.hits, practice.song) };
    take = null;
    statsSoon();
  }
  function takeNote(m, on, vel) {
    if (!take || !practice.engine.playing) return;
    if (on) take.rec.on(m, practice.engine.time, vel); else take.rec.off(m, practice.engine.time);
  }
  function replay(withMusic) {
    if (stopReplay) { stopReplay(); return; }
    if (!lastTake || lastTake.song !== practice.song) return;
    if (practice.engine.playing) practice.act.toggle(performance.now());
    synth.unlock();
    stopReplay = P.takes.play({
      take: lastTake, song: practice.song, from: lastTake.from, withMusic,
      sound: (m, on, vel, mine) => { if (mine) { if (on) synth.noteOn(m, vel); else synth.noteOff(m); } else if (!midi.send(m, on, vel)) { if (on) synth.noteOn(m, vel); else synth.noteOff(m); } },
      onTime: (ms) => practice.act.seek(ms),
      onEnd: () => { stopReplay = null; statsSoon(); },
    });
    statsSoon();
  }
  // Early and late per note, as dots around a centre line.
  function timingGraph(tk) {
    const hits = tk.hits.filter((h) => h.mode === "flow" || h.mode === "recital");
    const wrap = el("div", "timing");
    if (hits.length < 3) { wrap.appendChild(el("p", "dim", t("The timing graph needs a run in flow or recital mode."))); return wrap; }
    const c = document.createElement("canvas");
    c.setAttribute("aria-label", t("Timing of each note: above the line is late, below is early"));
    wrap.appendChild(c);
    requestAnimationFrame(() => {
      const w = Math.max(200, wrap.clientWidth), h = 96, dpr = Math.min(2, window.devicePixelRatio || 1);
      c.width = w * dpr; c.height = h * dpr; c.style.width = w + "px"; c.style.height = h + "px";
      const g = c.getContext("2d"); g.scale(dpr, dpr);
      const css = getComputedStyle(document.documentElement), v = (n) => css.getPropertyValue(n).trim();
      const lim = 250, first = hits[0].ms, last = Math.max(first + 1, hits[hits.length - 1].ms);
      g.fillStyle = v("--line-soft"); g.fillRect(0, h / 2, w, 1);
      g.fillStyle = v("--text-dim"); g.font = "11px system-ui, sans-serif"; g.fillText(t("late"), 4, 12); g.fillText(t("early"), 4, h - 4);
      for (const hi of hits) {
        const x = 34 + ((hi.ms - first) / (last - first)) * (w - 42);
        const off = Math.max(-lim, Math.min(lim, hi.offset));
        const y = h / 2 - (off / lim) * (h / 2 - 8);
        g.fillStyle = Math.abs(hi.offset) <= 60 ? v("--good") : Math.abs(hi.offset) <= 150 ? v("--late") : v("--bad");
        g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill();
      }
    });
    const ahead = hits.filter((x) => x.offset < -60).length, behind = hits.filter((x) => x.offset > 60).length;
    const lean = ahead > behind * 1.5 && ahead > 2 ? t("You tend to rush.") : behind > ahead * 1.5 && behind > 2 ? t("You tend to drag.") : t("No lean either way.");
    wrap.appendChild(el("p", "dim", lean));
    return wrap;
  }
  function takeSection() {
    const tk = lastTake;
    if (!tk || tk.song !== practice.song) return null;
    const sec = el("section");
    sec.appendChild(el("h4", null, t("Your last take")));
    const row = el("div", "row");
    const a = button(stopReplay ? t("Stop") : t("Hear it with the music"), "btn", () => replay(true)); a.prepend(icon(stopReplay ? "square" : "play"));
    row.appendChild(a);
    if (!stopReplay) row.appendChild(button(t("Just me"), "btn", () => replay(false)));
    sec.appendChild(row);
    sec.appendChild(timingGraph(tk));
    const d = tk.dynamics;
    if (d) {
      const bars = (list) => list.slice(0, 4).map((m) => m + 1).join(", ");
      const parts = [t("Loud and soft: {n}% right.", { n: d.accuracy })];
      if (d.flat) parts.push(t("It's all at one level; let the p and f marks show."));
      else {
        if (d.loud.length) parts.push(t("Too loud in bars {list}.", { list: bars(d.loud) }));
        if (d.soft.length) parts.push(t("Too soft in bars {list}.", { list: bars(d.soft) }));
      }
      sec.appendChild(el("p", null, parts.join(" ")));
    }
    return sec;
  }

  // ---- chord names, in free play ----
  const freeHeld = new Set();
  function chordNote(m, on) {
    if (!practice || practice.song) { freeHeld.clear(); return; }
    if (on) freeHeld.add(m); else freeHeld.delete(m);
    const c = P.chords.name([...freeHeld]);
    const box = $("chord");
    if (!box) return;
    if (c) { box.replaceChildren(el("strong", null, c.name), el("span", "dim", c.long + (c.inversion !== "root position" ? ", " + t(c.inversion) : ""))); box.hidden = false; }
    else if (!freeHeld.size) box.hidden = true;
  }

  // ---- chords while a piece plays: last, now, next ----
  let chordSeq = null, chordSong = null, chordShown = -2;
  function prompt() {
    const box = $("prompter");
    if (!box || !practice) return;
    const song = practice.song;
    if (!song || !settings.get("prompter")) { box.hidden = true; chordShown = -2; return; }
    if (chordSong !== song || !chordSeq) { chordSong = song; chordSeq = P.chords.sequence(song); chordShown = -2; }
    if (chordSeq.length < 2) { box.hidden = true; return; }
    const i = P.chords.indexAt(chordSeq, practice.engine.time);
    if (i === chordShown) return;
    chordShown = i;
    const name = (k) => (chordSeq[k] ? chordSeq[k].name : "");
    box.replaceChildren(el("span", "dim", name(i - 1)), el("strong", null, name(i) || "–"), el("span", "dim", name(i + 1)));
    box.hidden = false;
  }

  // ---- pieces to review ----
  function reviewCard() {
    const due = progress.dueForReview(today()).filter((r) => openable(r.key));
    if (!due.length) return null;
    const c = el("section", "course");
    const head = el("div", "course-head");
    head.appendChild(el("h3", null, t("Time to review")));
    c.append(head, el("p", "course-note", t("Pieces you've learned come back after 1, 3, 7, 14, 30 and 60 days. A good run sends one further out.")));
    const list = el("ul", "items");
    for (const r of due.slice(0, 6)) {
      const li = document.createElement("li");
      const b = button("", null, () => openKey(r.key));
      b.append(icon("repeat"), el("span", null, r.title), el("span", "meta", r.due < today() ? t("overdue") : t("today")));
      li.appendChild(b); list.appendChild(li);
    }
    c.appendChild(list);
    return c;
  }
  function openable(key) { const [course] = key.split("|"); return courses.some((c) => c.id === course); }
  async function openKey(key) {
    const i = key.indexOf("|"), course = key.slice(0, i), rest = key.slice(i + 1);
    const m = /^(.*)#(\d+)$/.exec(rest);
    if (m) { await openLesson(course, m[1]); if (+m[2] > 0) await activate({ block: +m[2] }); }
    else await openPiece(course, rest);
  }

  // ---- today's routine: a warm-up scale, a drill, then your piece ----
  const FIFTHS = ["C", "G", "D", "A", "E", "B", "F#", "Db", "Ab", "Eb", "Bb", "F"];
  let routine = null, routineTimer = 0, drillOverride = null;
  function drillSettings() { return drillOverride || settings.get("drill"); }
  function routinePlan() {
    const goal = settings.get("goal") || 15;
    const now = new Date();
    const day = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000);
    const key = FIFTHS[((day % 12) + 12) % 12];
    const last = settings.get("last");
    const piece = last && courses.some((c) => c.id === last.course) ? last : null;
    const split = piece ? [0.2, 0.3, 0.5] : [0.4, 0.6];
    const steps = [
      { name: t("Warm-up: {key} scale", { key: keyLabel(key) }), drill: { ...settings.get("drill"), type: "scale", key, hand: "both", octaves: 1, tempo: 80, next: false } },
      { name: t("Sight-reading in {key}", { key: keyLabel(key) }), drill: { ...settings.get("drill"), type: "reading", key, next: true } },
    ];
    if (piece) steps.push({ name: piece.title || piece.path, piece });
    steps.forEach((s, i) => { s.minutes = Math.max(1, Math.round(goal * split[i])); });
    return { key, steps };
  }
  function routineCard() {
    const plan = routinePlan();
    const c = el("section", "course");
    const head = el("div", "course-head");
    head.append(el("h3", null, t("Today's practice")), button(t("Start"), "btn primary", () => startRoutine()));
    c.append(head, el("p", "course-note", plan.steps.map((s) => s.name + " (" + t("{n} min", { n: s.minutes }) + ")").join(", ")));
    return c;
  }
  function startRoutine() { routine = { ...routinePlan(), at: -1 }; nextRoutineStep(); }
  async function nextRoutineStep() {
    if (!routine) return;
    routine.at++;
    const s = routine.steps[routine.at];
    if (!s) { endRoutine(true); return; }
    routine.since = Date.now(); routine.told = false;
    drillOverride = s.drill ? { ...s.drill } : null;
    if (s.drill) await openDrills();
    else await openLesson(s.piece.course, s.piece.path);
    renderRoutine();
    clearInterval(routineTimer);
    routineTimer = setInterval(renderRoutine, 1000);
  }
  function endRoutine(done) {
    routine = null; drillOverride = null;
    clearInterval(routineTimer); routineTimer = 0;
    renderRoutine();
    if (done) toast(t("That's today's practice done."));
  }
  function renderRoutine() {
    const bar = $("routine");
    if (!routine || $("lesson-screen").hidden) { bar.hidden = true; return; }
    const s = routine.steps[routine.at];
    const left = s.minutes * 60 - Math.floor((Date.now() - routine.since) / 1000);
    const last = routine.at === routine.steps.length - 1;
    if (left <= 0 && !routine.told) { routine.told = true; toast(last ? t("Time's up. Finish when you're ready.") : t("Time for the next step.")); }
    const clock = left > 0 ? t("{m}:{s} left", { m: Math.floor(left / 60), s: String(left % 60).padStart(2, "0") }) : t("Time's up");
    const text = el("span", "grow");
    text.append(el("strong", null, t("Today, {n} of {all}", { n: routine.at + 1, all: routine.steps.length }) + ": "), document.createTextNode(s.name));
    const next = button(last ? t("Finish") : t("Next step"), "btn" + (left <= 0 ? " primary" : ""), () => (last ? endRoutine(true) : nextRoutineStep()));
    bar.replaceChildren(icon("target"), text, el("span", "dim", clock), next, iconButton("x", t("Stop today's practice"), () => endRoutine(false)));
    bar.hidden = false;
  }

  // ---- drills: sight-reading, scales, chords, rhythm, ear ----
  const DRILL_TYPES = [["reading", "Sight-reading"], ["scale", "Scales"], ["chords", "Chords"], ["rhythm", "Rhythm"], ["ear", "By ear"]];
  let ear = null;
  function drillCard() {
    const c = el("section", "course");
    const head = el("div", "course-head");
    head.append(el("h3", null, t("Drills")), button(t("Start"), "btn primary", () => openDrills()));
    c.append(head, el("p", "course-note", t("Sight-reading, scales and chords in every key, rhythm and playing by ear. New music every time.")));
    return c;
  }
  async function openDrills() {
    lessonState = { course: null, path: null, meta: {}, blocks: [], pieces: [], active: null, drill: true };
    dropBook();
    showLessonScreen(t("Drills"));
    renderDrillForm();
    await newDrill();
  }
  function drillType() { return drillSettings().type || "reading"; }
  const keyLabel = (k) => (k === "any" ? t("Any key") : /m$/.test(k) ? k.slice(0, -1).replace("b", "♭") + " " + t("minor") : k.replace("b", "♭") + " " + t("major"));
  function renderDrillForm() {
    const d = { ...drillSettings() };
    const type = d.type || "reading";
    // In today's routine the changes last for this step only.
    const setD = (k, v) => { d[k] = v; if (drillOverride) drillOverride = { ...d }; else settings.set("drill", { ...d }); };
    const form = el("div", "drill-form");
    const pickSeg = (k, options, redraw) => { const box = seg(options, (v) => { setD(k, v); setSeg(box, v); if (redraw) renderDrillForm(); newDrill(); }); setSeg(box, String(d[k] != null ? d[k] : options[0][0])); return box; };
    const keySel = document.createElement("select");
    keySel.setAttribute("aria-label", t("Key"));
    const keys = type === "reading" ? P.abcwrite.KEYS : type === "rhythm" ? [] : ["any", ...P.abcwrite.KEYS, ...P.abcwrite.MINORS];
    for (const k of keys) keySel.appendChild(new Option(keyLabel(k), k));
    keySel.value = keys.includes(d.key) ? d.key : keys[0] || "C";
    keySel.addEventListener("change", () => { setD("key", keySel.value); newDrill(); });
    const next = el("label", "check");
    const nextBox = document.createElement("input"); nextBox.type = "checkbox"; nextBox.checked = !!d.next;
    nextBox.addEventListener("change", () => setD("next", nextBox.checked));
    next.append(nextBox, el("span", null, t("A new one when you finish")));
    const hands = field(t("Hands"), pickSeg("hand", [["right", t("Right")], ["left", t("Left")], ["both", t("Both")]]));
    const tempo = field(t("Tempo"), range(40, 160, 5, d.tempo, (v) => setD("tempo", v), (v) => t("{n} bpm", { n: v })));
    const intro = {
      reading: t("Read it once, then play it without stopping to fix notes. Wait mode lets you take your time; flow mode keeps the beat."),
      scale: t("Up and back down, with the usual fingering where the key has one. Minor scales are harmonic minor."),
      chords: t("I, IV, V and I again, the right hand moving as little as it can over the roots in the left."),
      rhythm: t("Just the rhythm: any key on the piano plays the note. The metronome keeps the beat, and timing counts."),
      ear: t("The app plays the key's chord, then a short tune starting on the key's note. Play it back."),
    }[type];
    form.append(el("h1", null, t("Drills")), field(t("Drill"), pickSeg("type", DRILL_TYPES.map(([v, l]) => [v, t(l)]), true)), el("p", "dim", intro));
    if (type === "reading") form.append(hands, field(t("Notes"), pickSeg("range", [["five", t("Five")], ["octave", t("An octave")], ["two", t("Two octaves")]])), field(t("Key"), keySel),
      field(t("Rhythm"), pickSeg("rhythm", [["quarters", t("Steady")], ["mixed", t("Mixed")]])), field(t("Bars"), pickSeg("bars", [["4", "4"], ["8", "8"]])), tempo, next);
    else if (type === "scale") form.append(hands, field(t("Octaves"), pickSeg("octaves", [["1", "1"], ["2", "2"]])), field(t("Key"), keySel), tempo, next);
    else if (type === "chords") form.append(hands, field(t("Key"), keySel), tempo, next);
    else if (type === "rhythm") form.append(field(t("Rhythm"), pickSeg("rhythm", [["quarters", t("Steady")], ["mixed", t("Mixed")]])), field(t("Bars"), pickSeg("bars", [["4", "4"], ["8", "8"]])), tempo, next);
    else if (type === "ear") {
      form.append(field(t("Key"), keySel), field(t("Notes"), pickSeg("count", [["3", "3"], ["4", "4"], ["5", "5"], ["6", "6"]])), field(t("Range"), pickSeg("earRange", [["five", t("Five notes")], ["octave", t("An octave")]])));
      const box = el("div", "ear-box"); box.id = "ear-box";
      form.appendChild(box);
    }
    const go = button(t(type === "ear" ? "New tune" : "New drill"), "btn primary", () => newDrill());
    go.prepend(icon("refresh"));
    form.appendChild(go);
    mounts.lesson.replaceChildren(form);
    if (type === "ear") renderEar();
  }
  function pickKey(k, list) { return k === "any" || !list.includes(k) ? list[Math.floor(Math.random() * list.length)] : k; }
  async function newDrill() {
    const d = drillSettings();
    const type = d.type || "reading";
    const seed = (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
    const W = P.abcwrite;
    ear = null;
    if (type === "ear") return newEar();
    const handName = t(d.hand === "both" ? "both hands" : d.hand === "left" ? "left hand" : "right hand");
    let text, label, opts = { hands: d.hand === "both" ? "both" : d.hand, tempo: d.tempo }, id;
    if (type === "scale" || type === "chords") {
      const key = pickKey(d.key, [...W.KEYS, ...W.MINORS]);
      text = type === "scale" ? W.scaleExercise({ key, hand: d.hand, octaves: +d.octaves || 1, tempo: d.tempo }) : W.chordExercise({ key, hand: d.hand, tempo: d.tempo });
      label = t(type === "scale" ? "Scale" : "Chords") + ": " + keyLabel(key) + ", " + handName;
      id = [type, key, d.hand, type === "scale" ? +d.octaves || 1 : ""].join("|");
    } else if (type === "rhythm") {
      text = W.rhythmExercise({ rhythm: d.rhythm, bars: +d.bars || 4, tempo: d.tempo, seed });
      label = t("Rhythm") + ": " + t(d.rhythm === "mixed" ? "mixed" : "steady");
      opts = { hands: "right", tempo: d.tempo, mode: "flow", metronome: true };
      id = ["rhythm", d.rhythm].join("|");
    } else {
      const key = W.KEYS.includes(d.key) ? d.key : "C";
      text = W.drill({ ...d, key, bars: +d.bars || 4, seed });
      label = t("Sight-reading") + ": " + key.replace("b", "♭") + ", " + t(d.range === "five" ? "five notes" : d.range === "octave" ? "an octave" : "two octaves") + ", " + handName;
      id = [key, d.range, d.hand, d.rhythm].join("|");
    }
    passes = [];
    try {
      await practice.load({ kind: "abc", data: text, title: label, opts, source: { drill: id, label } });
      renderStats();
    } catch (e) { toast(t("Couldn't make a drill: {why}", { why: e.message || String(e) })); }
  }

  // By ear: the app plays, you play it back, then the music shows.
  async function newEar() {
    const d = drillSettings();
    const key = pickKey(d.key, [...P.abcwrite.KEYS, ...P.abcwrite.MINORS]);
    const phrase = P.abcwrite.earPhrase({ key, count: +d.count || 4, range: d.earRange || "five", seed: (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0 });
    ear = { ...phrase, key, played: [], phase: "listen", tries: 0 };
    await practice.load({ kind: "free", message: t("Listen, then play it back. The music shows once you've played it.") });
    renderEar();
    playEar();
  }
  function sound(m, on, vel = 80) { if (!midi.send(m, on, vel)) { if (on) synth.noteOn(m, vel); else synth.noteOff(m); } }
  function playEar() {
    if (!ear) return;
    synth.unlock();
    const mine = ear;
    mine.phase = "listen"; mine.played = []; renderEar();
    const q = mine.tonic;
    const third = /m$/.test(mine.key) ? 3 : 4;
    const triad = [q - 12, q, q + third, q + 7];
    const at = (ms, fn) => setTimeout(() => { if (ear === mine) fn(); }, ms);
    for (const m of triad) { at(0, () => sound(m, true, 60)); at(900, () => sound(m, false)); }
    mine.midis.forEach((m, i) => { at(1400 + i * 650, () => sound(m, true)); at(1400 + i * 650 + 560, () => sound(m, false)); });
    at(1400 + mine.midis.length * 650, () => { mine.phase = "answer"; renderEar(); });
  }
  function earNote(m) {
    if (!ear || ear.phase !== "answer" || !(lessonState && lessonState.drill)) return;
    ear.played.push(m);
    if (ear.played.length >= ear.midis.length) {
      ear.tries++;
      ear.phase = ear.played.every((x, i) => x === ear.midis[i]) ? "right" : "wrong";
      if (ear.phase === "right") revealEar();
    }
    renderEar();
  }
  async function revealEar() {
    if (!ear) return;
    const keep = ear;
    if (ear.phase !== "right") ear.phase = "shown";
    await practice.load({ kind: "abc", data: keep.abc, title: t("By ear"), opts: { hands: "right" } });
    ear = keep;
    renderEar();
  }
  function renderEar() {
    const box = document.getElementById("ear-box");
    if (!box || !ear) { if (box) box.replaceChildren(); return; }
    const name = (m) => P.music.name(m);
    const parts = [];
    const msg = {
      listen: t("Listen…"),
      answer: t("Your turn: {n} notes, starting on {first}.", { n: ear.midis.length, first: name(ear.midis[0]) }),
      right: ear.tries === 1 ? t("Right first time.") : t("Right, in {n} tries.", { n: ear.tries }),
      wrong: t("Not quite. You played {notes}.", { notes: ear.played.map(name).join(" ") }),
      shown: t("Here it is: {notes}.", { notes: ear.midis.map(name).join(" ") }),
    }[ear.phase];
    parts.push(el("p", "ear-msg" + (ear.phase === "right" ? " good" : ear.phase === "wrong" ? " bad" : ""), msg));
    if (ear.phase === "answer" && ear.played.length) parts.push(el("p", "dim", ear.played.map(name).join(" ")));
    const row = el("div", "row");
    const again = button(t("Hear it again"), "btn", () => playEar());
    again.prepend(icon("play"));
    row.appendChild(again);
    if (ear.phase === "wrong" || ear.phase === "answer") row.appendChild(button(t("Show me"), "btn", () => revealEar()));
    parts.push(row);
    box.replaceChildren(...parts);
  }

  // ---- shortcuts, in Settings ----
  function shortcutsSection() {
    const sec = section(t("Shortcuts"));
    sec.classList.add("shortcuts");
    sec.appendChild(el("p", "dim", t("Click a key to change it, then press the new one (Esc clears it). A piano key you never play, like the lowest A, can be a shortcut too.")));
    const grid = el("div", "keys-table");
    grid.append(el("span", "dim", t("Action")), el("span", "dim", t("Key")), el("span", "dim", t("Piano key")));
    for (const [action, label] of P.hotkeys.ACTIONS) {
      const keyBtn = button(P.hotkeys.label(hot.keys[action]), "btn", () => {
        keyBtn.textContent = t("Press a key…"); keyBtn.classList.add("listening");
        captureKey = (k) => { captureKey = null; settings.set("keys", hot.bind(action, k || "")); renderSettings(); };
      });
      const n = hot.noteFor(action);
      const noteBtn = button(n == null ? "—" : P.music.name(n), "btn", () => {
        noteBtn.textContent = t("Play a key…"); noteBtn.classList.add("listening");
        captureNote = (m) => { captureNote = null; settings.set("pianoKeys", hot.bindNote(action, hot.noteFor(action) === m ? null : m)); renderSettings(); };
      });
      noteBtn.title = t("Play the same key again to clear it");
      grid.append(el("span", null, t(label)), keyBtn, noteBtn);
    }
    sec.appendChild(grid);
    sec.appendChild(button(t("Back to the usual shortcuts"), "btn", () => { hot.reset(); settings.set("keys", {}); settings.set("pianoKeys", {}); renderSettings(); }));
    return sec;
  }
  $("settings").addEventListener("close", () => { captureKey = null; captureNote = null; });

  // ---- the colour editor: a panel beside the app, so the change shows live ----
  let themeDlg = null;
  function themeOpen() { return !!(themeDlg && themeDlg.open); }
  function openThemeEditor() {
    if (!themeDlg) {
      themeDlg = document.createElement("dialog");
      themeDlg.className = "sheet side";
      themeDlg.setAttribute("aria-label", t("Colours"));
      document.body.appendChild(themeDlg);
      themeDlg.addEventListener("close", () => { if (lessonState && lessonState.active && practice && !practice.engine.playing) activate(lessonState.active); });
    }
    renderThemeEditor();
    themeDlg.show();
  }
  function renderThemeEditor() {
    const root = document.documentElement;
    const mode = root.dataset.theme;
    const colors = JSON.parse(JSON.stringify(settings.get("colors") || { light: {}, dark: {} }));
    colors[mode] = colors[mode] || {};
    const save = () => { settings.set("colors", colors); applyTheme(); warnings(); };
    const head = el("div", "sheet-head");
    head.append(el("h2", null, t(mode === "dark" ? "Dark colours" : "Light colours")), iconButton("x", t("Close"), () => themeDlg.close()));
    const body = el("div", "sheet-body");
    body.appendChild(el("p", "dim", t("Changes show as you make them. The other theme keeps its own colours: switch it in Settings → Look.")));
    const warn = el("div", "warn");
    const warnings = () => {
      const bad = P.theme.problems((k) => P.theme.read(k, root));
      warn.replaceChildren(...bad.map((b) => el("div", null, t("{fg} on {bg} is hard to read ({r}:1, needs 4.5)", { fg: tokenName(b.fg), bg: tokenName(b.bg), r: b.ratio }))));
    };
    body.appendChild(warn);
    for (const [group, list] of P.theme.TOKENS) {
      const sec = section(t(group));
      const grid = el("div", "swatches");
      for (const [token, label] of list) {
        const input = document.createElement("input");
        input.type = "color"; input.value = P.theme.read(token, root);
        input.setAttribute("aria-label", t(label));
        input.addEventListener("input", () => { colors[mode][token] = input.value; save(); });
        grid.append(el("span", null, t(label)), input);
      }
      sec.appendChild(grid);
      body.appendChild(sec);
    }
    const share = section(t("Share"));
    const area = document.createElement("textarea");
    area.className = "json"; area.spellcheck = false;
    area.value = JSON.stringify(colors, null, 1);
    area.setAttribute("aria-label", t("Colours as JSON"));
    const row = el("div", "row");
    row.append(
      button(t("Use pasted colours"), "btn", () => {
        const parsed = P.theme.parse(area.value);
        if (!parsed) { toast(t("Those aren't colours this app knows.")); return; }
        settings.set("colors", parsed); applyTheme(); renderThemeEditor();
      }),
      button(t("Reset these colours"), "btn", () => { colors[mode] = {}; settings.set("colors", colors); applyTheme(); renderThemeEditor(); }),
    );
    share.append(el("p", "dim", t("Copy this to keep or share your colours; paste one in to use it.")), area, row);
    body.appendChild(share);
    themeDlg.replaceChildren(head, body);
    warnings();
  }
  function tokenName(k) { for (const [, list] of P.theme.TOKENS) for (const [tok, label] of list) if (tok === k) return t(label); return k; }

  // ---- the menu bar ----
  let menu = null;
  function openSettings(tab) { if (tab) settingsTab = tab; if (menu) menu.close(); renderSettings(); $("settings").showModal(); }
  function buildMenus() {
    const k = (a) => { const key = hot.keys[a]; return key ? P.hotkeys.label(key) : ""; };
    const onLesson = () => !$("lesson-screen").hidden;
    const has = () => onLesson() && !!(practice && practice.song);
    const act = (a) => () => runAction(a);
    const shown = () => P.layout.panels(currentLayout());
    const addFolder = async () => {
      try {
        if (library.canPick()) { const id = await library.addFolder(); if (id) { if (onLesson()) await showLibrary(); else await renderLibrary(); } }
        else pickFiles(true);
      } catch (e) { if (e && e.name !== "AbortError") toast(t("Couldn't add that folder: {why}", { why: e.message })); }
    };
    const last = () => { const l = settings.get("last"); return l && courses.some((c) => c.id === l.course) ? l : null; };
    const menus = [
      { label: t("File"), items: () => [
        { label: t("Add a folder…"), run: addFolder },
        { label: t("Open a file…"), run: () => pickFiles(false) },
        "-",
        { label: t("Continue: {name}", { name: last() ? last().title || last().path : "–" }), disabled: !last(), run: () => openLesson(last().course, last().path) },
        { label: t("Library"), key: onLesson() ? k("library") : "", disabled: !onLesson(), run: () => showLibrary() },
        "-",
        { label: t("Settings…"), key: "Ctrl+,", run: () => openSettings() },
      ] },
      { label: t("View"), items: () => [
        ...PANELS.filter((id) => id !== "editor").map((id) => ({ label: t(PANEL_NAMES[id]), checked: shown().includes(id), disabled: !onLesson(),
          run: () => { const tree = currentLayout(); if (shown().includes(id)) { if (shown().length > 1) setLayout(P.layout.remove(tree, id)); } else setLayout(P.layout.show(tree, id, PANELS)); } })),
        "-",
        ...Object.entries(PRESETS).map(([key, v]) => ({ label: t(v.name), disabled: !onLesson(), run: () => setLayout(PRESETS[key].tree) })),
        { label: t("Move and hide panels…"), checked: editingLayout, disabled: !onLesson(), run: () => toggleLayoutEditor() },
        "-",
        { label: t("Dark"), checked: document.documentElement.dataset.theme === "dark", run: () => { settings.set("theme", "dark"); applyTheme(); } },
        { label: t("Light"), checked: document.documentElement.dataset.theme === "light", run: () => { settings.set("theme", "light"); applyTheme(); } },
        { label: t("Edit colours…"), run: () => openThemeEditor() },
      ] },
      { label: t("Practice"), items: () => [
        { label: practice && practice.engine.playing ? t("Pause") : t("Play"), key: k("toggle"), disabled: !has(), run: act("toggle") },
        { label: t("Back to the start"), key: k("restart"), disabled: !has(), run: act("restart") },
        { label: t("Bar back"), key: k("barBack"), disabled: !has(), run: act("barBack") },
        { label: t("Next bar"), key: k("barNext"), disabled: !has(), run: act("barNext") },
        "-",
        { label: t("Faster"), key: k("faster"), disabled: !has(), run: act("faster") },
        { label: t("Slower"), key: k("slower"), disabled: !has(), run: act("slower") },
        { label: t("Loop"), key: k("loop"), checked: !!(practice && practice.engine.loop.on), disabled: !has(), run: act("loop") },
        ...MODES.map(([m, name]) => ({ label: t(name), key: m === "wait" ? k("mode") : "", checked: !!(practice && practice.engine.mode === m), disabled: !has(), run: () => practice.act.mode(m) })),
        "-",
        { label: t("Metronome"), key: k("metronome"), checked: !!(practice && practice.engine.metronome), disabled: !has(), run: act("metronome") },
        { label: t("Count-in"), checked: !!(practice && practice.engine.countIn), disabled: !has(), run: () => practice.act.countIn(!practice.engine.countIn) },
        "-",
        { label: t("Record what you play"), key: k("record"), checked: recorder.recording && !layering, disabled: !onLesson() || (recorder.recording && layering), run: act("record") },
        { label: layers.length ? t("Record a layer over the last take") : t("Record a layer (after a take)"), checked: recorder.recording && layering, disabled: !onLesson() || !layers.length || (recorder.recording && !layering), run: () => toggleRecord(true) },
        { label: t("Record a video of the falling notes"), checked: !!video, disabled: !onLesson(), run: () => toggleVideo() },
        { label: t("Edit this lesson"), checked: editorShown(), disabled: !(onLesson() && lessonState && lessonState.path), run: () => toggleEditor() },
        "-",
        { label: t("Today's practice"), checked: !!routine, run: () => (routine ? endRoutine(false) : startRoutine()) },
        { label: t("Free play"), run: () => openFree() },
      ] },
      { label: t("Drills"), items: () => DRILL_TYPES.map(([type, name]) => ({ label: t(name), run: () => { settings.set("drill", { ...settings.get("drill"), type }); openDrills(); } })) },
      { label: t("Help"), items: () => [
        { label: t("Shortcuts"), run: () => openSettings("shortcuts") },
        { label: t("Check the delay"), run: () => openSettings("piano") },
        K.platform.desktop ? { label: t("Check for updates"), run: () => { openSettings("about"); checkUpdate(true); } } : null,
        "-",
        { label: t("About"), run: () => openSettings("about") },
      ] },
    ];
    menu = P.menus.create($("menubar"), menus, { before: $("menubar").querySelector(".spacer") });
    window.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.key === "," && !$("settings").open) { e.preventDefault(); openSettings(); }
    });
  }

  // Today's minutes in the status bar.
  function renderToday() {
    const done = progress.today(today()), goal = settings.get("goal") || 0;
    $("today").textContent = goal ? t("{done} of {goal} min today", { done: Math.round(done / 60), goal }) : t("{done} min today", { done: Math.round(done / 60) });
  }

  // ---- small DOM helpers ----
  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function button(text, cls, onClick) { const b = el("button", cls, text); b.type = "button"; if (onClick) b.addEventListener("click", onClick); return b; }

  // ---- start ----
  async function start() {
    applyTheme();
    layoutBtn.appendChild(icon("layout"));
    layoutBtn.title = t("Move and hide panels"); layoutBtn.setAttribute("aria-label", layoutBtn.title);
    layoutBtn.setAttribute("aria-pressed", "false");
    layoutBtn.addEventListener("click", () => toggleLayoutEditor());
    editBtn.appendChild(icon("pencil"));
    editBtn.title = t("Edit this lesson"); editBtn.setAttribute("aria-label", editBtn.title);
    editBtn.setAttribute("aria-pressed", "false");
    editBtn.addEventListener("click", () => toggleEditor());
    $("settings-btn").appendChild(icon("sliders"));
    $("settings-btn").title = t("Settings"); $("settings-btn").setAttribute("aria-label", t("Settings"));
    $("settings-btn").addEventListener("click", () => openSettings());
    $("device").addEventListener("click", () => openSettings("piano"));
    buildMenus();
    renderDevice();
    buildPanels();
    await i18n.ready;
    i18n.apply();
    await midi.start();
    if (settings.get("output")) midi.setOutput(settings.get("output"));
    renderDevice();
    renderToday();
    await showLibrary();
    $("update").addEventListener("click", () => installUpdate());
    if (K.platform.desktop && Date.now() - (settings.get("updateChecked") || 0) > 20 * 3600 * 1000) setTimeout(() => checkUpdate(false), 4000);
  }

  // The web copy works offline through sw.js; the desktop app has its
  // files with it and no service worker.
  if ("serviceWorker" in navigator && location.protocol === "https:" && !K.platform.bundled) {
    navigator.serviceWorker.register("sw.js").catch((e) => K.errlog.note("sw", String(e)));
  }

  const motion = K.motion.create();
  window.PianoApp = { version: APP_VERSION, i18n, settings, get practice() { return practice; }, library, openLesson, openPiece, openFree, showLibrary, motion, toast,
    progress, hotkeys: hot, recorder, get editor() { return editor; }, toggleEditor, openDrills, newDrill, toggleVideo, routeNote, runAction, toggleLayoutEditor, openThemeEditor, openBook, get pdf() { return pdf; },
    midi, synth, startRoutine, get routine() { return routine; }, get ear() { return ear; },
    startPlan, get plan() { return plan; }, get lastTake() { return lastTake; }, replay };
  start().catch((e) => { toast(String(e && e.message || e)); K.errlog.note("start", String(e && e.stack || e)); });
})();
