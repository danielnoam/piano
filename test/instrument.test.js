// The piano's own panel over MIDI: `node test/instrument.test.js`. The
// messages here are ones captured between Roland's app and an FP-30
// (github.com/bluebrother/fp30remote), so the bytes are what a real piano
// takes.
const assert = require("assert");
global.window = {};
require("../src/instrument.js");
const I = window.Piano.instrument;

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok - " + name); }
  catch (e) { process.exitCode = 1; console.log("  FAIL - " + name + "\n    " + (e.stack || e.message)); }
}
const bytes = (s) => s.trim().split(/\s+/).map((x) => parseInt(x, 16));

// A piano that answers like the FP-30, and a clock the test moves.
function rig({ roland = true } = {}) {
  const sent = [], timers = [], changes = [];
  const c = I.create({
    send: (b) => sent.push(I.hex(b)),
    later: (fn, ms) => { const t = { fn, ms, on: true }; timers.push(t); return () => { t.on = false; }; },
    onChange: (s) => changes.push(s),
  });
  const fire = () => { for (const t of timers.splice(0)) if (t.on) t.fn(); };
  const reply = (s) => c.receive(bytes(s));
  return { c, sent, fire, reply, changes, roland };
}

test("writes match what Roland's app sends: volume, remote on, reports on", () => {
  assert.deepStrictEqual(I.dt1(0x01000213, [0x41]), bytes("F0 41 10 00 00 00 28 12 01 00 02 13 41 29 F7"));
  assert.deepStrictEqual(I.dt1(0x01000306, [0x01]), bytes("F0 41 10 00 00 00 28 12 01 00 03 06 01 75 F7"));
  assert.deepStrictEqual(I.dt1(0x01000300, [0x00, 0x01]), bytes("F0 41 10 00 00 00 28 12 01 00 03 00 00 01 7B F7"));
});

test("a read matches the app's: address, then a four-byte size", () => {
  assert.deepStrictEqual(I.rq1(0x01000700, 8), bytes("F0 41 10 00 00 00 28 11 01 00 07 00 00 00 00 08 70 F7"));
});

test("a message from the piano is read, and a bad checksum is refused", () => {
  const m = I.parse(bytes("F0 41 10 00 00 00 28 12 01 00 02 13 3F 2B F7"));
  assert.deepStrictEqual(m, { cmd: 0x12, address: 0x01000213, data: [0x3f] });
  assert.strictEqual(I.parse(bytes("F0 41 10 00 00 00 28 12 01 00 02 13 3F 2C F7")), null);
  assert.strictEqual(I.parse(bytes("F0 43 10 00 00 00 28 12 01 00 02 13 3F 2B F7")), null);
});

test("the identity reply names the maker and the model", () => {
  const id = I.identity(bytes("F0 7E 10 06 02 41 42 00 00 20 00 01 00 00 F7"));
  assert.deepStrictEqual(id, { maker: 0x41, model: "42 00 00 20", version: "00 01 00 00" });
  assert.strictEqual(I.model(id.model).name, "Roland FP-30");
  assert.strictEqual(I.model("12 34 56 78"), null);
});

test("signed values, tempo, tuning and tones go both ways", () => {
  assert.deepStrictEqual(I.encode("transpose", -3), [61]);
  assert.strictEqual(I.decode("transpose", [61]), -3);
  assert.deepStrictEqual(I.encode("tempo", 120), [0, 120]);
  assert.deepStrictEqual(I.encode("tempo", 200), [1, 72]);
  assert.strictEqual(I.decode("tempo", [1, 72]), 200);
  assert.deepStrictEqual(I.encode("tuning", 440), [2, 0]);
  assert.strictEqual(I.decode("tuning", [2, 0]), 440);
  assert.strictEqual(I.decode("tuning", [1, 0x7e]), 439.8);
  assert.deepStrictEqual(I.encode("tone", { bank: 2, index: 130 }), [2, 1, 2]);
  assert.deepStrictEqual(I.decode("tone", [2, 1, 2]), { bank: 2, index: 130 });
});

test("a block from the piano becomes every value in it, skipping the unknown bytes", () => {
  const data = new Array(0x24).fill(0);
  data[0x00] = 2; data[0x07] = 0; data[0x08] = 0; data[0x09] = 3;
  data[0x13] = 70; data[0x18] = 2; data[0x19] = 0; data[0x1d] = 3;
  const v = I.values(0x01000200, data);
  assert.strictEqual(v.mode, 2);
  assert.deepStrictEqual(v.tone, { bank: 0, index: 3 });
  assert.strictEqual(v.volume, 70);
  assert.strictEqual(v.tuning, 440);
  assert.strictEqual(v.touch, 3);
  assert.strictEqual(v.splitBalance, -64);
});

test("tone names come from the model's list, or bank and number when it isn't known", () => {
  const fp30 = I.model("42 00 00 20");
  assert.strictEqual(I.toneName(fp30, { bank: 1, index: 3 }), "Clav.");
  assert.strictEqual(I.toneName(null, { bank: 1, index: 3 }), "E. Piano 4");
});

test("connecting: asks who it is and reads; a Roland answer turns the remote on and reads everything", () => {
  const r = rig();
  r.c.connect();
  assert.strictEqual(r.c.state, "looking");
  assert.deepStrictEqual(r.sent.slice(0, 2), ["F0 7E 7F 06 01 F7", I.hex(I.rq1(0x01000200, 0x30))]);
  r.reply("F0 7E 10 06 02 41 42 00 00 20 00 01 00 00 F7");
  r.reply(I.hex(I.dt1(0x01000213, [80])));
  assert.strictEqual(r.c.state, "roland");
  assert.ok(r.sent.includes("F0 41 10 00 00 00 28 12 01 00 03 06 01 75 F7"));
  assert.ok(r.sent.includes("F0 41 10 00 00 00 28 12 01 00 03 00 00 01 7B F7"));
  assert.strictEqual(r.c.values.volume, 80);
  assert.strictEqual(r.c.model.name, "Roland FP-30");
  r.fire();
  assert.strictEqual(r.c.state, "roland", "the timeout after a Roland answer changes nothing");
});

test("no answer: standard MIDI only, and nothing Roland is written", () => {
  const r = rig();
  r.c.connect();
  r.fire();
  assert.strictEqual(r.c.state, "standard");
  assert.strictEqual(r.c.set("volume", 50), false);
  assert.ok(!r.sent.some((s) => s.startsWith("F0 41") && s.includes(" 12 ")));
});

test("a change is written to the write address, clamped, and kept at once", () => {
  const r = rig();
  r.c.connect();
  r.reply(I.hex(I.dt1(0x01000213, [80])));
  r.sent.length = 0;
  r.c.set("transpose", 9);
  assert.deepStrictEqual(r.sent, [I.hex(I.dt1(0x01000307, [64 + 5]))]);
  assert.strictEqual(r.c.values.transpose, 5);
  r.c.set("tone", { bank: 1, index: 2 });
  assert.strictEqual(r.sent[1], I.hex(I.dt1(0x01000207, [1, 0, 2])));
  assert.strictEqual(r.c.set("metronome", 1), false, "read-only values aren't written");
});

test("a change made on the piano's own panel shows up", () => {
  const r = rig();
  r.c.connect();
  r.reply(I.hex(I.dt1(0x01000213, [80])));
  r.reply("F0 41 10 00 00 00 28 12 01 00 02 1D 05 5B F7");
  assert.strictEqual(r.c.values.touch, 5);
});

test("stopping turns the remote and the reports off again", () => {
  const r = rig();
  r.c.connect();
  r.reply(I.hex(I.dt1(0x01000213, [80])));
  r.sent.length = 0;
  r.c.stop();
  assert.deepStrictEqual(r.sent, [I.hex(I.dt1(0x01000300, [0, 0])), I.hex(I.dt1(0x01000306, [0]))]);
  assert.strictEqual(r.c.state, "off");
});

test("the learn log keeps what isn't a note, names what it knows, and marks what it doesn't", () => {
  const r = rig();
  r.c.connect();
  r.c.receive([0x90, 60, 100]);
  r.c.receive([0xfe]);
  r.reply("F0 41 10 00 00 00 28 12 01 00 02 13 3F 2B F7");
  r.reply(I.hex(I.dt1(0x01000402, [1])));
  r.c.receive([0xb0, 64, 127]);
  const ins = r.c.log().filter((l) => l.dir === "in").map((l) => l.text);
  assert.deepStrictEqual(ins, ["Value volume = 63", "Value 01000402 = 01 (not mapped)", "Control 64 = 127, channel 1"]);
  assert.ok(r.c.logText().includes("<- Value volume = 63   F0 41 10"));
});

test("standard MIDI: bank, program, volume and reverb on channel 1", () => {
  assert.deepStrictEqual(I.standard({ msb: 0, lsb: 68, program: 0, volume: 100, reverb: 40 }),
    [[0xb0, 0, 0], [0xb0, 32, 68], [0xc0, 0], [0xb0, 7, 100], [0xb0, 91, 40]]);
  assert.deepStrictEqual(I.standard({ program: 5, channel: 3 }), [[0xc3, 5]]);
});

console.log(passed + " passed");
