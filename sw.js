// The service worker for Piano's web copy: installable and usable
// offline. Stale-while-revalidate for the app's own files: a launch paints
// from cache while a fresh copy is fetched for the next one, and the
// ?v=x.y.z on every tag in index.html makes a release's files new URLs.
// Other sites' requests are never touched.
//
// CACHE goes up with every release (tools/release.js). A file added to or
// removed from the app goes in or out of ASSETS (test/app.test.js checks).
const CACHE = "piano-v2";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon.svg",
  "./src/app.js",
  "./src/engine.js",
  "./src/recital.js",
  "./src/icons.js",
  "./src/layout.js",
  "./src/lesson.js",
  "./src/library.js",
  "./src/catalog.js",
  "./src/pdmx.js",
  "./src/touch.js",
  "./src/midi.js",
  "./src/hands.js",
  "./src/menus.js",
  "./src/midifile.js",
  "./src/music.js",
  "./src/pdfview.js",
  "./src/practice.js",
  "./src/progress.js",
  "./src/hotkeys.js",
  "./src/recorder.js",
  "./src/theme.js",
  "./src/abcwrite.js",
  "./src/plan.js",
  "./src/chords.js",
  "./src/takes.js",
  "./src/effects.js",
  "./src/editor.js",
  "./src/roll.js",
  "./src/score.js",
  "./src/styles.css",
  "./src/synth.js",
  "./src/timeline.js",
  "./src/keel/errlog.js",
  "./src/keel/i18n.js",
  "./src/keel/motion.js",
  "./src/keel/platform.js",
  "./src/keel/releases.js",
  "./src/keel/sw-preview.js",
  "./src/vendor/abcjs.min.js",
  "./src/vendor/markdown-it.min.js",
  "./src/vendor/osmd.min.js",
  "./src/vendor/pdfjs/pdf.min.mjs",
  "./src/vendor/pdfjs/pdf.worker.min.mjs",
  "./src/sounds/piano/A0.mp3",
  "./src/sounds/piano/A1.mp3",
  "./src/sounds/piano/A2.mp3",
  "./src/sounds/piano/A3.mp3",
  "./src/sounds/piano/A4.mp3",
  "./src/sounds/piano/A5.mp3",
  "./src/sounds/piano/A6.mp3",
  "./src/sounds/piano/A7.mp3",
  "./src/sounds/piano/C1.mp3",
  "./src/sounds/piano/C2.mp3",
  "./src/sounds/piano/C3.mp3",
  "./src/sounds/piano/C4.mp3",
  "./src/sounds/piano/C5.mp3",
  "./src/sounds/piano/C6.mp3",
  "./src/sounds/piano/C7.mp3",
  "./src/sounds/piano/C8.mp3",
  "./src/sounds/piano/Ds1.mp3",
  "./src/sounds/piano/Ds2.mp3",
  "./src/sounds/piano/Ds3.mp3",
  "./src/sounds/piano/Ds4.mp3",
  "./src/sounds/piano/Ds5.mp3",
  "./src/sounds/piano/Ds6.mp3",
  "./src/sounds/piano/Ds7.mp3",
  "./src/sounds/piano/Fs1.mp3",
  "./src/sounds/piano/Fs2.mp3",
  "./src/sounds/piano/Fs3.mp3",
  "./src/sounds/piano/Fs4.mp3",
  "./src/sounds/piano/Fs5.mp3",
  "./src/sounds/piano/Fs6.mp3",
  "./src/sounds/piano/Fs7.mp3",
  "./lessons/index.json",
  "./lessons/getting-started/01-how-lessons-work.md",
  "./lessons/getting-started/02-c-position.md",
  "./lessons/getting-started/03-c-major-scale.md",
  "./lessons/getting-started/04-ode-to-joy.md",
  "./lessons/getting-started/05-minuet-in-g.md",
  "./lessons/getting-started/pieces/minuet-in-g.musicxml",
  "./lessons/getting-started/pieces/ode-to-joy.mid",
  "./lessons/getting-started/book/keyboard-book.pdf",
  "./lessons/first-year/01-the-keyboard.md",
  "./lessons/first-year/02-steps-in-the-treble.md",
  "./lessons/first-year/03-skips.md",
  "./lessons/first-year/04-the-bass-clef.md",
  "./lessons/first-year/05-middle-c-position.md",
  "./lessons/first-year/06-g-position.md",
  "./lessons/first-year/07-sharps-flats-naturals.md",
  "./lessons/first-year/08-note-lengths.md",
  "./lessons/first-year/09-rests.md",
  "./lessons/first-year/10-eighth-notes.md",
  "./lessons/first-year/11-dotted-notes.md",
  "./lessons/first-year/12-ties.md",
  "./lessons/first-year/13-g-major-scale.md",
  "./lessons/first-year/14-d-and-a-major.md",
  "./lessons/first-year/15-f-major.md",
  "./lessons/first-year/16-minor-scales.md",
  "./lessons/first-year/17-contrary-motion.md",
  "./lessons/first-year/18-every-key.md",
  "./lessons/first-year/19-triads.md",
  "./lessons/first-year/20-broken-chords.md",
  "./lessons/first-year/21-inversions.md",
  "./lessons/first-year/22-i-iv-v-i.md",
  "./lessons/first-year/23-melody-and-chords.md",
  "./lessons/first-year/24-minor-chords.md",
  "./lessons/first-year/25-jingle-bells.md",
  "./lessons/first-year/26-loud-and-soft.md",
  "./lessons/songs/01-twinkle.md",
  "./lessons/songs/02-frere-jacques.md",
  "./lessons/songs/03-amazing-grace.md",
  "./lessons/songs/04-auld-lang-syne.md",
  "./lessons/songs/05-greensleeves.md",
  "./lessons/songs/06-fur-elise.md",
  "./lessons/songs/07-canon-in-d.md",
  "./lessons/songs/08-prelude-in-c.md",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && !k.startsWith(PREVIEW)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// A test build in the browser: keel's sw-preview.js serves the picked
// commit's files while one is open, with a Back to the release bar.
importScripts("src/keel/sw-preview.js");
// The name keel's releases.js opens a test build into: its `name`, lower case.
const PREVIEW = "Piano".toLowerCase() + "-preview";
const preview = self.KeelPreview.create(PREVIEW);

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(preview.respond(e, fromRelease));
});

function fromRelease(e) {
  return caches.open(CACHE).then((cache) =>
    cache.match(e.request).then((cached) => {
      const fetching = fetch(e.request)
        .then((res) => { if (res && res.ok) cache.put(e.request, res.clone()); return res; })
        .catch(() => null);
      return cached || fetching.then((res) =>
        res || caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("./index.html")));
    })
  );
}
