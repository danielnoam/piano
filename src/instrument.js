// Your piano's own panel, from the app: its tone, volume, touch, split and
// dual, transpose, tuning and metronome.
//
// Two ways in, tried in this order:
// - Roland's app protocol: SysEx read (RQ1) and write (DT1) to model
//   00 00 00 28, at the addresses Roland's own app uses. Roland doesn't
//   publish it; the map comes from people who watched the app talk
//   (github.com/bluebrother/fp30remote, GPL-3, and the roland-piano Python
//   library, MIT, by Erik van Raalte): facts only, the code here is ours.
//   Tested by them on the FP-10 and FP-30.
// - Standard MIDI, for any keyboard: Bank Select and Program Change for
//   the tone, and channel volume and reverb, on channel 1.
//
// Everything the piano sends that isn't a note goes into a log, so a model
// nobody has mapped can be learned: press its buttons, copy the log.
// The protocol is pure; create() takes send and a timer so the tests drive it.
(function () {
  const ROLAND = 0x41;
  const HEAD = [0xf0, ROLAND, 0x10, 0x00, 0x00, 0x00, 0x28];
  const RQ1 = 0x11, DT1 = 0x12;
  const IDENTITY_REQUEST = [0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7];

  const checksum = (bytes) => (128 - (bytes.reduce((a, b) => a + b, 0) % 128)) & 0x7f;
  const addrBytes = (a) => [(a >>> 24) & 0x7f, (a >>> 16) & 0x7f, (a >>> 8) & 0x7f, a & 0x7f];
  const sizeBytes = (n) => [(n >>> 21) & 0x7f, (n >>> 14) & 0x7f, (n >>> 7) & 0x7f, n & 0x7f];
  const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join(" ");
  const addrHex = (a) => a.toString(16).padStart(8, "0").toUpperCase();

  function dt1(address, data) {
    const body = [...addrBytes(address), ...data];
    return [...HEAD, DT1, ...body, checksum(body), 0xf7];
  }
  function rq1(address, size) {
    const body = [...addrBytes(address), ...sizeBytes(size)];
    return [...HEAD, RQ1, ...body, checksum(body), 0xf7];
  }

  // A Roland message to or from model 00 00 00 28, or null. A bad checksum
  // is null too: the piano got it garbled, or it isn't this protocol.
  function parse(bytes) {
    const b = [...bytes];
    if (b.length < 14 || b[b.length - 1] !== 0xf7) return null;
    for (let i = 0; i < HEAD.length; i++) if (i !== 2 && b[i] !== HEAD[i]) return null;
    const cmd = b[7];
    if (cmd !== RQ1 && cmd !== DT1) return null;
    const body = b.slice(8, -2);
    if (checksum(body) !== b[b.length - 2]) return null;
    const address = ((body[0] << 24) | (body[1] << 16) | (body[2] << 8) | body[3]) >>> 0;
    return { cmd, address, data: body.slice(4) };
  }

  // The universal identity reply: who made it, and which model.
  function identity(bytes) {
    const b = [...bytes];
    if (b.length < 15 || b[0] !== 0xf0 || b[1] !== 0x7e || b[3] !== 0x06 || b[4] !== 0x02) return null;
    return { maker: b[5], model: hex(b.slice(6, 10)), version: hex(b.slice(10, 14)) };
  }

  // Each value is read at `at` (`size` bytes, seven bits each) and written
  // at `write` when the piano keeps a separate write-only address. Signed
  // values carry an offset. `ro`: the piano only reports it.
  const PARAMS = {
    transpose: { at: 0x01000101, write: 0x01000307, offset: 64, min: -6, max: 5 },
    metronome: { at: 0x0100010f, ro: true },
    tempo: { at: 0x01000108, size: 2, write: 0x01000309, min: 20, max: 250 },
    speakers: { at: 0x01000110, ro: true },
    mode: { at: 0x01000200, min: 0, max: 3 },
    splitPoint: { at: 0x01000201, min: 35, max: 95 },
    splitShift: { at: 0x01000202, offset: 64, min: -2, max: 2 },
    splitBalance: { at: 0x01000203, offset: 64, min: -9, max: 9 },
    dualShift: { at: 0x01000204, offset: 64, min: -2, max: 2 },
    dualBalance: { at: 0x01000205, offset: 64, min: -9, max: 9 },
    twinMode: { at: 0x01000206, min: 0, max: 1 },
    tone: { at: 0x01000207, size: 3, kind: "tone" },
    toneLeft: { at: 0x0100020a, size: 3, kind: "tone" },
    toneDual: { at: 0x0100020d, size: 3, kind: "tone" },
    volume: { at: 0x01000213, min: 0, max: 100 },
    tuning: { at: 0x01000218, size: 2, kind: "tuning", min: 415.3, max: 466.2 },
    ambience: { at: 0x0100021a, min: 0, max: 10 },
    brilliance: { at: 0x0100021c, offset: 64, min: -10, max: 10 },
    touch: { at: 0x0100021d, min: 0, max: 5 },
    beat: { at: 0x0100021f, min: 0, max: 5 },
    metronomeVolume: { at: 0x01000221, min: 0, max: 10 },
  };
  const BY_ADDRESS = new Map(Object.entries(PARAMS).map(([k, p]) => [p.at, k]));
  // Writing these turns the remote on: 01000306 makes the piano take our
  // writes, 01000300 makes it report changes made on its own panel.
  const REMOTE = 0x01000306, REPORT = 0x01000300, METRONOME_TOGGLE = 0x01000509;
  // What's read on connecting: the status block and the settings block.
  const READS = [[0x01000100, 0x20], [0x01000200, 0x30]];

  const sevens = (data) => data.reduce((v, b) => (v << 7) | (b & 0x7f), 0);
  const split = (v, n) => Array.from({ length: n }, (_, i) => (v >> (7 * (n - 1 - i))) & 0x7f);

  // A tone is { bank, index }: bank 0 piano, 1 e-piano, 2 other.
  function decode(key, data) {
    const p = PARAMS[key];
    if (p.kind === "tone") return { bank: data[0], index: (data[1] << 7) | data[2] };
    const raw = sevens(data);
    if (p.kind === "tuning") return Math.round(raw + 4400 - 256) / 10;
    return raw - (p.offset || 0);
  }
  function encode(key, value) {
    const p = PARAMS[key];
    if (p.kind === "tone") return [value.bank & 0x7f, (value.index >> 7) & 0x7f, value.index & 0x7f];
    if (p.kind === "tuning") return split(Math.round(value * 10) - 4400 + 256, 2);
    return split(Math.round(value) + (p.offset || 0), p.size || 1);
  }

  // A block the piano sent, as the values in it.
  function values(address, data) {
    const out = {};
    for (let i = 0; i < data.length;) {
      const key = BY_ADDRESS.get(address + i);
      if (!key) { i++; continue; }
      const size = PARAMS[key].size || 1;
      if (i + size > data.length) break;
      out[key] = decode(key, data.slice(i, i + size));
      i += size;
    }
    return out;
  }

  // Models whose tone names are known, by their identity reply. Others
  // show tones by bank and number until their list is added.
  const FP30_TONES = [
    ["Grand Piano 1", "Grand Piano 2", "Grand Piano 3", "Ragtime Piano", "Harpsichord 1", "Harpsichord 2"],
    ["E. Piano 1", "E. Piano 2", "E. Piano 3", "Clav.", "Vibraphone", "Celesta", "Synth Bell"],
    ["Strings 1", "Strings 2", "Harp", "Jazz Organ 1", "Jazz Organ 2", "Church Organ 1", "Church Organ 2", "Accordion",
      "Choir 1", "Jazz Scat", "Choir 2", "Choir 3", "Synth Pad", "Nylon-str. Gt", "Steel-str. Gt", "Decay Strings",
      "Decay Choir", "Decay Choir Pad", "Acoustic Bass", "A.Bass + Cymbal", "Fingered Bass", "Thum Voice"],
  ];
  const MODELS = {
    "42 00 00 20": { name: "Roland FP-30", tones: FP30_TONES, ambience: 4, brilliance: 1 },
  };
  const BANKS = ["Piano", "E. Piano", "Other"];
  function model(id) { return id && MODELS[id] ? MODELS[id] : null; }
  function toneName(m, tone) {
    if (!tone) return "";
    const list = m && m.tones && m.tones[tone.bank];
    return list && list[tone.index] ? list[tone.index] : (BANKS[tone.bank] || "Bank " + (tone.bank + 1)) + " " + (tone.index + 1);
  }

  // Standard MIDI: the same few controls on any keyboard, on channel 1.
  function standard({ channel = 0, msb, lsb, program, volume, reverb }) {
    const c = channel & 15, out = [];
    if (msb != null) out.push([0xb0 | c, 0, msb & 0x7f]);
    if (lsb != null) out.push([0xb0 | c, 32, lsb & 0x7f]);
    if (program != null) out.push([0xc0 | c, program & 0x7f]);
    if (volume != null) out.push([0xb0 | c, 7, volume & 0x7f]);
    if (reverb != null) out.push([0xb0 | c, 91, reverb & 0x7f]);
    return out;
  }

  // What a message is, in a few words, for the learn log.
  function describe(bytes) {
    const b = [...bytes];
    const id = identity(b);
    if (id) return "Identity: maker " + hex([id.maker]) + ", model " + id.model;
    const m = parse(b);
    if (m) {
      const key = BY_ADDRESS.get(m.address);
      const what = m.cmd === RQ1 ? "Read " : "Value ";
      if (key && m.data.length === (PARAMS[key].size || 1) && m.cmd === DT1) return what + key + " = " + JSON.stringify(decode(key, m.data));
      return what + addrHex(m.address) + (m.cmd === DT1 ? " = " + hex(m.data) : "") + (key ? "" : " (not mapped)");
    }
    const s = b[0] & 0xf0, ch = (b[0] & 15) + 1;
    if (s === 0xb0) return "Control " + b[1] + " = " + b[2] + ", channel " + ch;
    if (s === 0xc0) return "Program " + (b[1] + 1) + ", channel " + ch;
    if (b[0] === 0xf0) return "SysEx, maker " + hex([b[1]]);
    return "";
  }

  // One piano's panel. send(bytes) goes to the piano's MIDI out;
  // later(fn, ms) returns a cancel. state: off | looking | roland | standard.
  function create({ send, later, onChange = () => {}, now = () => Date.now(), keep = 300 }) {
    let state = "off", id = null, cancel = null;
    const vals = {};
    const log = [];

    function note(dir, bytes) {
      log.push({ at: now(), dir, bytes: [...bytes], text: describe(bytes) });
      if (log.length > keep) log.splice(0, log.length - keep);
    }
    function out(bytes) { note("out", bytes); send(bytes); }
    function changed() { onChange({ state, id, model: model(id && id.model), values: { ...vals } }); }

    // Ask who it is and read its settings; if a Roland answers the read,
    // turn the remote on. Nothing within 1.5 s: standard MIDI only.
    function connect() {
      stop();
      state = "looking"; id = null;
      for (const k of Object.keys(vals)) delete vals[k];
      changed();
      out(IDENTITY_REQUEST);
      out(rq1(...READS[1]));
      cancel = later(() => { cancel = null; if (state === "looking") { state = "standard"; changed(); } }, 1500);
    }
    function startRoland() {
      if (cancel) { cancel(); cancel = null; }
      state = "roland";
      out(dt1(REMOTE, [1]));
      out(dt1(REPORT, [0, 1]));
      for (const r of READS) out(rq1(...r));
    }
    // Turn the remote off, so the piano stops reporting to nobody.
    function stop() {
      if (cancel) { cancel(); cancel = null; }
      if (state === "roland") { out(dt1(REPORT, [0, 0])); out(dt1(REMOTE, [0])); }
      state = "off";
    }

    function receive(bytes) {
      const b = [...bytes];
      if (b.length < 3 && (b[0] & 0xf0) !== 0xc0) return;
      const s = b[0] & 0xf0;
      if (s === 0x80 || s === 0x90 || s === 0xa0 || s === 0xd0 || s === 0xe0 || b[0] >= 0xf8) return;
      note("in", b);
      const who = identity(b);
      if (who) { id = who; changed(); return; }
      const m = parse(b);
      if (!m || m.cmd !== DT1) { changed(); return; }
      if (state === "looking") startRoland();
      Object.assign(vals, values(m.address, m.data));
      changed();
    }

    // Change a value on the piano. Kept here at once, so the panel doesn't
    // jump back while the piano's own report is on its way.
    function set(key, value) {
      const p = PARAMS[key];
      if (state !== "roland" || !p || p.ro) return false;
      if (p.kind !== "tone") value = Math.max(p.min, Math.min(p.max, value));
      out(dt1(p.write || p.at, encode(key, value)));
      vals[key] = value;
      changed();
      return true;
    }
    function toggleMetronome() {
      if (state !== "roland") return false;
      out(dt1(METRONOME_TOGGLE, [0]));
      return true;
    }
    function sendStandard(opts) {
      for (const m of standard(opts)) out(m);
    }

    return {
      connect, stop, receive, set, toggleMetronome, sendStandard,
      get state() { return state; }, get id() { return id; }, get values() { return { ...vals }; },
      get model() { return model(id && id.model); },
      log: () => log.slice(),
      logText: () => log.map((l) => (l.dir === "in" ? "<- " : "-> ") + (l.text ? l.text + "   " : "") + hex(l.bytes)).join("\n"),
      clearLog: () => { log.length = 0; },
    };
  }

  window.Piano = window.Piano || {};
  window.Piano.instrument = { create, dt1, rq1, parse, identity, decode, encode, values, describe, standard, toneName, model, PARAMS, BANKS, IDENTITY_REQUEST, hex };
})();
