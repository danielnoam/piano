// Reading Mutopia's result pages: `node test/catalog.test.js`. The fixture
// is a real result page's markup (2026-11-20), malformed rows included.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
global.window = {};
require("../src/catalog.js");
require("../src/lesson.js");
const { catalog, lesson } = window.Piano;

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok - " + name); }
  catch (e) { process.exitCode = 1; console.log("  FAIL - " + name + "\n    " + (e.stack || e.message)); }
}
const page = fs.readFileSync(path.join(__dirname, "fixtures/mutopia-results.html"), "utf8");

test("a result page reads into pieces with their files and licence", () => {
  const { pieces, next } = catalog.parse(page);
  assert.strictEqual(pieces.length, 2);
  const a = pieces[0];
  assert.strictEqual(a.title, "Minuet in B-flat major");
  assert.strictEqual(a.composer, "J. S. Bach (1685–1750)");
  assert.strictEqual(a.opus, "BWV Anh. 118");
  assert.strictEqual(a.style, "Baroque");
  assert.strictEqual(a.licence, "Public Domain");
  assert.strictEqual(a.id, 1014);
  assert.strictEqual(a.mid, "https://www.mutopiaproject.org/ftp/BachJS/BWVAnh118/BWV-118/BWV-118.mid");
  assert.strictEqual(a.pdf, "https://www.mutopiaproject.org/ftp/BachJS/BWVAnh118/BWV-118/BWV-118-a4.pdf");
  assert.strictEqual(a.page, "https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1014");
  const b = pieces[1];
  assert.strictEqual(b.title, "Allegro & Rondo");
  assert.strictEqual(b.arranger, "arr. Laurence Sardain");
  assert.strictEqual(b.licence, "Creative Commons Attribution-ShareAlike 4.0");
  assert.strictEqual(b.licenceUrl, "https://www.mutopiaproject.org/legal.html#ccasa");
  assert.strictEqual(next, 10);
});

test("no Next link means the last page", () => {
  assert.strictEqual(catalog.parse(page.replace(/<a href="make-table[^]*?Next 10<\/a>/, "")).next, null);
});

test("links outside Mutopia's file area are ignored", () => {
  const bad = page.replace(/https:\/\/www\.mutopiaproject\.org\/ftp\/AdamA\/giselle\/giselle\.mid/, "https://evil.example/giselle.mid");
  assert.strictEqual(catalog.parse(bad).pieces.length, 1);
});

test("the search asks for solo piano", () => {
  const u = new URL(catalog.searchUrl({ q: " minuet ", composer: "BachJS", start: 20 }));
  assert.strictEqual(u.origin + u.pathname, "https://www.mutopiaproject.org/cgibin/make-table.cgi");
  assert.strictEqual(u.searchParams.get("searchingfor"), "minuet");
  assert.strictEqual(u.searchParams.get("Instrument"), "Piano");
  assert.strictEqual(u.searchParams.get("Composer"), "BachJS");
  assert.strictEqual(u.searchParams.get("solo"), "1");
  assert.strictEqual(u.searchParams.get("startat"), "20");
});

test("composers come from the advanced search's list", () => {
  const html = `<select name="Composer" id="x"><option value="">all composers</option> <option value='AbtF'>F. Abt (1819–1885)</option> <option value='BachJS'>J. S. Bach (1685–1750)</option></select>`;
  const list = catalog.composers(html);
  assert.deepStrictEqual(list, [["AbtF", "F. Abt (1819–1885)"], ["BachJS", "J. S. Bach (1685–1750)"]]);
  assert.strictEqual(catalog.composerFor(list, "J. S. Bach"), "BachJS");
  assert.strictEqual(catalog.composerFor(list, "Nobody"), "");
});

test("a download's lesson opens the PDF as its book and practises the MIDI", () => {
  const p = catalog.parse(page).pieces[1];
  const n = catalog.names(p);
  assert.deepStrictEqual([n.mid, n.pdf, n.lesson], ["Mutopia/giselle/giselle.mid", "Mutopia/giselle/giselle.pdf", "Mutopia/giselle/giselle.md"]);
  const text = catalog.lesson(p);
  const { meta } = lesson.frontMatter(text);
  assert.strictEqual(meta.title, "Allegro & Rondo");
  assert.strictEqual(meta.book, "giselle.pdf");
  assert.ok(text.includes('(giselle.mid "practice")'));
  assert.ok(text.includes("Creative Commons Attribution-ShareAlike 4.0"));
});

console.log(passed + " passed");
