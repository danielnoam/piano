// The PDMX collection, once the desktop app has got it (pdmx.rs): searching
// its index here, and the lesson a piece is saved with.
(function () {
  const RECORD = "https://zenodo.org/records/15571083";
  const LEVELS = ["Easy", "Moderate", "Harder", "Hardest"];

  const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  // Pieces matching every word of q in their title, composer or genres, at
  // the level asked for (or any), best rated first.
  function search(pieces, { q = "", level = "" } = {}) {
    const words = fold(q).split(/\s+/).filter(Boolean);
    const out = pieces.filter((p) => {
      if (level !== "" && p.level !== +level) return false;
      if (!words.length) return true;
      const hay = fold(p.title + " " + p.composer + " " + p.genres);
      return words.every((w) => hay.includes(w));
    });
    return out.sort((a, b) => b.rating - a.rating || a.title.localeCompare(b.title));
  }

  // Where it goes in your folder: PDMX/<title>-<id>/.
  function names(piece) {
    const slug = fold(piece.title).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "piece";
    const id = piece.file.replace(/\.mxl$/i, "").replace(/[^\w-]+/g, "").slice(0, 10);
    const base = slug + "-" + id;
    const dir = "PDMX/" + base + "/";
    return { dir, base, mxl: dir + base + ".mxl", lesson: dir + base + ".md" };
  }

  const LICENCES = { publicdomain: "Public Domain", "cc-zero": "CC0" };
  function lesson(piece) {
    const n = names(piece);
    const md = (s) => String(s).replace(/([\\`*_[\]<>#|])/g, "\\$1");
    const title = piece.title || n.base;
    const lines = ["---", "title: " + JSON.stringify(title), "---", "", "# " + md(title), ""];
    if (piece.composer) lines.push("By " + md(piece.composer) + ".", "");
    lines.push("[" + md(title) + "](" + n.base + '.mxl "practice")', "");
    const lic = LICENCES[piece.licence] || piece.licence;
    lines.push("From the [PDMX collection](" + RECORD + ") (CC BY 4.0) of scores shared on MuseScore" + (lic ? ", where its uploader marked it " + md(lic) : "") + ".", "");
    return lines.join("\n");
  }

  window.Piano = window.Piano || {};
  window.Piano.pdmx = { RECORD, LEVELS, search, names, lesson };
})();
