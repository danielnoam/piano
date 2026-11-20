// The PDMX collection's index and lessons: `node test/pdmx.test.js`.
const assert = require("assert");
global.window = {};
require("../src/lesson.js");
require("../src/pdmx.js");
const { pdmx, lesson } = window.Piano;

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok - " + name); }
  catch (e) { process.exitCode = 1; console.log("  FAIL - " + name + "\n    " + (e.stack || e.message)); }
}

const pieces = [
  { title: "Gymnopédie No. 1", composer: "Erik Satie", rating: 4.7, level: 1, genres: "classical", licence: "publicdomain", file: "QmAbc123xyz.mxl" },
  { title: "Merry-Go-Round of Life", composer: "Joe Hisaishi", rating: 4.9, level: 2, genres: "soundtrack", licence: "cc-zero", file: "QmDef456.mxl" },
  { title: "Minuet in G", composer: "J. S. Bach", rating: 4.5, level: 0, genres: "classical", licence: "publicdomain", file: "QmGhi789.mxl" },
];

test("search matches every word, ignores accents, best rated first", () => {
  assert.deepStrictEqual(pdmx.search(pieces).map((p) => p.composer), ["Joe Hisaishi", "Erik Satie", "J. S. Bach"]);
  assert.deepStrictEqual(pdmx.search(pieces, { q: "gymnopedie satie" }).map((p) => p.title), ["Gymnopédie No. 1"]);
  assert.deepStrictEqual(pdmx.search(pieces, { q: "classical" }).length, 2);
  assert.deepStrictEqual(pdmx.search(pieces, { level: "0" }).map((p) => p.title), ["Minuet in G"]);
  assert.strictEqual(pdmx.search(pieces, { q: "chopin" }).length, 0);
});

test("a piece is saved under PDMX/ with a lesson the app can read", () => {
  const n = pdmx.names(pieces[0]);
  assert.strictEqual(n.dir, "PDMX/gymnopedie-no-1-QmAbc123xy/");
  assert.strictEqual(n.mxl, n.dir + "gymnopedie-no-1-QmAbc123xy.mxl");
  const text = pdmx.lesson(pieces[1]);
  assert.ok(text.includes("(CC BY 4.0)") && text.includes("marked it CC0"));
  assert.strictEqual(lesson.frontMatter(text).meta.title, "Merry-Go-Round of Life");
  assert.ok(text.includes(pdmx.names(pieces[1]).base + '.mxl "practice"'), "links the score to practise");
  assert.strictEqual(lesson.kind(pdmx.names(pieces[1]).mxl), "mxl");
});

console.log(passed + " passed");
