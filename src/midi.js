// Your piano over MIDI (Web MIDI), and the computer's keyboard as a piano
// when there isn't one. Every input reaches the same onNote; the output
// (the piano, for the hand the app plays) is picked in Settings.
(function () {
  // A to ' is the white keys from C4, the row above the black keys;
  // Z and X move the octave.
  const KEYS = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15, ";": 16, "'": 17 };

  function create({ onNote, onDevices, onPedal, touch }) {
    let access = null, output = null, outputId = null;
    let status = "off"; // off | asking | on | denied | unsupported
    let sysex = false;
    const listeners = new Set();
    const sounding = new Set();
    const T = window.Piano.touch;
    const keys = T.filter(touch || (() => ({})));
    const lag = T.delays();

    // One entry per keyboard, however many ports Windows lists it as.
    function devices() {
      if (!access) return { inputs: [], outputs: [], status };
      const live = (m) => [...m.values()].filter((p) => p.state !== "disconnected");
      const inputs = [], seen = new Set();
      for (const p of live(access.inputs)) {
        const name = T.deviceName(p.name);
        if (!seen.has(name)) { seen.add(name); inputs.push({ id: p.id, name, ports: 1 }); } else inputs.find((i) => i.name === name).ports++;
      }
      const outputs = live(access.outputs).map((p) => ({ id: p.id, name: T.deviceName(p.name) }));
      return { inputs, outputs, status, outputId };
    }

    function wire() {
      for (const input of access.inputs.values()) input.onmidimessage = onMessage;
      output = outputId ? access.outputs.get(outputId) || null : null;
      if (onDevices) onDevices(devices());
    }

    // The time the message arrived, not when we got to it: the judging
    // is then as exact as the keyboard.
    function onMessage(e) {
      const [s, d1, d2] = e.data;
      const hi = s & 0xf0;
      const handled = performance.now();
      const at = e.timeStamp > 0 && handled - e.timeStamp >= 0 && handled - e.timeStamp < 1000 ? e.timeStamp : handled;
      const on = hi === 0x90 && d2 > 0, off = hi === 0x80 || (hi === 0x90 && d2 === 0);
      if (on || off) {
        if (on) lag.add(handled - at);
        const vel = keys.input(d1, on, d2, at);
        if (vel != null) onNote(d1, on, vel, at, "midi");
      }
      else if (hi === 0xb0 && d1 === 64 && onPedal) onPedal(d2 >= 64);
      if (!on && !off && listeners.size) for (const fn of listeners) fn(e.data, e.target ? T.deviceName(e.target.name) : "");
    }

    // Everything that isn't a note, for the piano's panel (instrument.js).
    function listen(fn) { listeners.add(fn); return () => listeners.delete(fn); }

    // SysEx is asked for only when the piano's panel is opened, not at the
    // start: least access. A browser that says no keeps plain MIDI.
    async function allowSysex() {
      if (sysex) return true;
      if (!navigator.requestMIDIAccess) return false;
      try {
        const a = await navigator.requestMIDIAccess({ sysex: true });
        if (access) for (const input of access.inputs.values()) input.onmidimessage = null;
        access = a; sysex = true; status = "on";
        access.onstatechange = () => wire();
        wire();
        return true;
      } catch (e) { return false; }
    }

    // Raw bytes to one port, whichever the notes go to.
    function sendTo(id, bytes) {
      const port = access && id ? access.outputs.get(id) : null;
      if (!port) return false;
      try { port.send(bytes); return true; } catch (e) { return false; }
    }

    async function start() {
      if (!navigator.requestMIDIAccess) { status = "unsupported"; if (onDevices) onDevices(devices()); return devices(); }
      status = "asking";
      try {
        access = await navigator.requestMIDIAccess({ sysex: false });
        status = "on";
        access.onstatechange = () => wire();
        wire();
      } catch (e) {
        status = "denied";
        if (onDevices) onDevices(devices());
      }
      return devices();
    }

    function setOutput(id) {
      allOff();
      outputId = id || null;
      output = access && outputId ? access.outputs.get(outputId) || null : null;
    }

    // Notes the app plays go out on channel 2, so the piano can tell them
    // from your own (and some pianos give them their own voice).
    function send(midi, on, vel = 80) {
      if (!output) return false;
      try {
        output.send(on ? [0x91, midi, Math.max(1, Math.min(127, vel))] : [0x81, midi, 0]);
        if (on) sounding.add(midi); else sounding.delete(midi);
        return true;
      } catch (e) { return false; }
    }

    // All notes off, and each one we sent, for pianos that ignore CC 123.
    function allOff() {
      if (!output) { sounding.clear(); return; }
      try {
        for (const m of sounding) output.send([0x81, m, 0]);
        output.send([0xb1, 123, 0]);
      } catch (e) { /* the device went away */ }
      sounding.clear();
    }

    // Keyboards with lit keys light a key for a note sent to them on their
    // lighting channel (which channel depends on the keyboard). Lights
    // exactly `midis`, turning the others off.
    const lit = new Set();
    let litChannel = -1;
    function light(midis, channel) {
      const ch = channel == null || channel < 0 ? -1 : channel & 15;
      try {
        if (output && litChannel >= 0 && (ch !== litChannel || !midis.length)) { for (const m of lit) output.send([0x80 | litChannel, m, 0]); lit.clear(); }
        litChannel = ch;
        if (!output || ch < 0) { lit.clear(); return; }
        const want = new Set(midis);
        for (const m of [...lit]) if (!want.has(m)) { output.send([0x80 | ch, m, 0]); lit.delete(m); }
        for (const m of want) if (!lit.has(m)) { output.send([0x90 | ch, m, 1]); lit.add(m); }
      } catch (e) { lit.clear(); }
    }

    // Raw press → handled: { average, worst, count } in ms, or null before
    // any key.
    function inputDelay() { return lag.count ? { average: lag.average(), worst: lag.worst(), count: lag.count } : null; }

    return { start, devices, setOutput, send, allOff, light, inputDelay, listen, allowSysex, sendTo, get sysex() { return sysex; }, resetKeys: () => keys.reset(), get hasOutput() { return !!output; }, get status() { return status; } };
  }

  // The typing keyboard as a piano. Returns a function that turns it off.
  function typing({ onNote, octave = 4, enabled }) {
    const down = new Set();
    let base = 12 * (octave + 1);
    const key = (e) => (e.key || "").toLowerCase();
    const skip = (e) => e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable || !enabled();
    function onDown(e) {
      if (skip(e)) return;
      const k = key(e);
      if (k === "z" || k === "x") { base = Math.max(24, Math.min(96, base + (k === "z" ? -12 : 12))); e.preventDefault(); return; }
      if (!(k in KEYS)) return;
      e.preventDefault();
      if (e.repeat || down.has(k)) return;
      down.add(k);
      onNote(base + KEYS[k], true, 90, performance.now(), "typing");
    }
    function onUp(e) {
      const k = key(e);
      if (!down.has(k)) return;
      down.delete(k);
      onNote(base + KEYS[k], false, 0, performance.now(), "typing");
    }
    const blur = () => { for (const k of down) onNote(base + KEYS[k], false, 0, performance.now(), "typing"); down.clear(); };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", blur);
    return {
      stop() { blur(); window.removeEventListener("keydown", onDown); window.removeEventListener("keyup", onUp); window.removeEventListener("blur", blur); },
      isPianoKey: (k) => k in KEYS || k === "z" || k === "x",
    };
  }

  window.Piano = window.Piano || {};
  window.Piano.midi = { create, typing, KEYS };
})();
