// Free music from the Mutopia Project: its search URL, its result pages
// read into pieces, and the lesson a download is saved with. Pure; the
// desktop app fetches the pages and files (catalog.rs), since the page
// itself can't reach other sites.
//
// A result page is one outer table holding a "result-table" per piece,
// four rows each: title, composer, opus | instrument, date, style,
// arranger | source, licence, info, added | then the download links.
(function () {
  const SITE = "https://www.mutopiaproject.org/";

  function searchUrl({ q = "", composer = "", style = "", start = 0, solo = true } = {}) {
    const p = new URLSearchParams({ startat: String(start || 0), searchingfor: q.trim(), Composer: composer, Instrument: "Piano", Style: style, solo: solo ? "1" : "" });
    return SITE + "cgibin/make-table.cgi?" + p.toString();
  }

  const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  function decode(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ""; }
      return ENT[e.toLowerCase()] ?? m;
    });
  }
  const text = (html) => decode(html.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
  const hrefs = (html) => [...html.matchAll(/href\s*=\s*"([^"]*)"/gi)].map((m) => decode(m[1]));

  // Only links into Mutopia's own file area.
  function fileLink(list, re) {
    const h = list.find((x) => re.test(x));
    return h && h.startsWith(SITE + "ftp/") ? h : "";
  }

  const LICENCES = { publicdomain: "Public Domain" };
  function parse(html) {
    const pieces = [];
    const blocks = html.split(/<table[^>]*class="[^"]*result-table[^"]*"[^>]*>/i).slice(1);
    for (const raw of blocks) {
      const block = raw.split(/<\/table>/i)[0];
      const rows = block.split(/<tr[^>]*>/i).slice(1).map((r) => [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]));
      if (rows.length < 3) continue;
      const links = hrefs(block);
      const mid = fileLink(links, /\.midi?$/i);
      if (!mid) continue;
      const cell = (r, c) => (rows[r] && rows[r][c] != null ? text(rows[r][c]) : "");
      const lic = (rows[2][1] || "").match(/legal\.html#([\w-]+)/i);
      const id = (links.find((x) => /piece-info\.cgi\?id=\d+/.test(x)) || "").match(/id=(\d+)/);
      pieces.push({
        id: id ? +id[1] : null,
        title: cell(0, 0),
        composer: cell(0, 1).replace(/^by\s+/i, ""),
        opus: cell(0, 2),
        instruments: cell(1, 0).replace(/^for\s+/i, ""),
        date: cell(1, 1),
        style: cell(1, 2),
        arranger: cell(1, 3),
        source: cell(2, 0),
        licence: cell(2, 1) || (lic && LICENCES[lic[1]]) || "",
        licenceUrl: lic ? SITE + "legal.html#" + lic[1] : "",
        added: cell(2, 3),
        mid,
        pdf: fileLink(links, /-a4\.pdf$/i) || fileLink(links, /\.pdf$/i),
        page: id ? SITE + "cgibin/piece-info.cgi?id=" + id[1] : "",
      });
    }
    const next = html.match(/href="(make-table\.cgi\?startat=(\d+)[^"]*)"[^>]*>\s*Next/i);
    return { pieces, next: next ? +next[2] : null };
  }

  // The composers in the advanced search's list: [[value, label]].
  function composers(html) {
    const sel = html.match(/<select[^>]*name="Composer"[^>]*>([\s\S]*?)<\/select>/i);
    if (!sel) return [];
    return [...sel[1].matchAll(/<option\s+value=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/option>/gi)].map((m) => [decode(m[1]), text(m[2])]);
  }

  // Where a download goes in your folder: Mutopia/<name>/, named after
  // Mutopia's own file.
  function names(piece) {
    const base = piece.mid.split("/").pop().replace(/\.midi?$/i, "").replace(/[^\w.-]+/g, "-");
    const dir = "Mutopia/" + base + "/";
    return { dir, mid: dir + base + ".mid", pdf: piece.pdf ? dir + base + ".pdf" : "", lesson: dir + base + ".md", base };
  }

  // The lesson saved beside the files: the PDF opens as its book, the MIDI
  // is the piece to practise, and where it came from and its licence.
  function lesson(piece) {
    const n = names(piece);
    const yaml = (s) => JSON.stringify(s);
    const md = (s) => s.replace(/([\\`*_[\]<>#|])/g, "\\$1");
    const lines = ["---", "title: " + yaml(piece.title || n.base)];
    if (n.pdf) lines.push("book: " + n.base + ".pdf");
    lines.push("---", "", "# " + md(piece.title || n.base), "");
    const by = [piece.composer && "By " + md(piece.composer), piece.opus && md(piece.opus), piece.arranger && md(piece.arranger)].filter(Boolean).join(", ");
    if (by) lines.push(by + ".", "");
    lines.push("[" + md(piece.title || n.base) + "](" + n.base + '.mid "practice")', "");
    if (n.pdf) lines.push("The sheet music is the book beside this lesson.", "");
    const from = ["From the [Mutopia Project](" + (piece.page || SITE) + ")"];
    if (piece.source) from.push("source: " + md(piece.source));
    lines.push(from.join(", ") + ". " + (piece.licence ? "Licence: " + (piece.licenceUrl ? "[" + md(piece.licence) + "](" + piece.licenceUrl + ")" : md(piece.licence)) + "." : ""), "");
    return lines.join("\n");
  }

  // A starting list of easy, well-known pieces: a search each. who is
  // matched against the composers' names in Mutopia's own list.
  const SUGGESTED = [
    { label: "Bach: minuets", q: "minuet", who: "J. S. Bach" },
    { label: "Bach: little preludes", q: "prelude", who: "J. S. Bach" },
    { label: "Schumann: Album for the Young", q: "album", who: "R. Schumann" },
    { label: "Burgmüller: easy studies", q: "", who: "Burgm" },
    { label: "Clementi: sonatinas", q: "sonatina", who: "M. Clementi" },
    { label: "Satie: Gymnopédies", q: "gymnop", who: "E. Satie" },
    { label: "Chopin: preludes", q: "prelude", who: "F. Chopin" },
    { label: "Chopin: waltzes", q: "waltz", who: "F. Chopin" },
    { label: "Beethoven: bagatelles", q: "bagatelle", who: "L. van Beethoven" },
    { label: "Mozart: minuets", q: "minuet", who: "W. A. Mozart" },
    { label: "Grieg: Lyric Pieces", q: "lyric", who: "E. Grieg" },
    { label: "Joplin: rags", q: "", who: "S. Joplin" },
  ];
  // The composer's value in Mutopia's list for a name, or "".
  function composerFor(list, who) {
    if (!who) return "";
    const w = who.toLowerCase();
    const hit = list.find(([, label]) => label.toLowerCase().startsWith(w)) || list.find(([, label]) => label.toLowerCase().includes(w));
    return hit ? hit[0] : "";
  }

  window.Piano = window.Piano || {};
  window.Piano.catalog = { SITE, searchUrl, parse, composers, composerFor, names, lesson, decode, SUGGESTED };
})();
