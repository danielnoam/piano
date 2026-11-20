// The app's icons: Lucide (ISC license, lucide.dev), one map, drawn as
// SVG elements so nothing needs innerHTML. icon("play") returns an <svg>.
(function () {
  const P = {
    piano: [["path", { d: "M18.5 8c-1.4 0-2.6-.8-3.2-2A6.87 6.87 0 0 0 2 9v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-8.5C22 9.6 20.4 8 18.5 8" }], ["path", { d: "M2 14h20" }], ["path", { d: "M6 14v4" }], ["path", { d: "M10 14v4" }], ["path", { d: "M14 14v4" }], ["path", { d: "M18 14v4" }]],
    volume: [["path", { d: "M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" }], ["path", { d: "M16 9a5 5 0 0 1 0 6" }], ["path", { d: "M19.364 18.364a9 9 0 0 0 0-12.728" }]],
    info: [["circle", { cx: 12, cy: 12, r: 10 }], ["path", { d: "M12 16v-4" }], ["path", { d: "M12 8h.01" }]],
    play: [["polygon", { points: "6 3 20 12 6 21 6 3" }]],
    pause: [["rect", { x: 14, y: 4, width: 4, height: 16, rx: 1 }], ["rect", { x: 6, y: 4, width: 4, height: 16, rx: 1 }]],
    "skip-back": [["polygon", { points: "19 20 9 12 19 4 19 20" }], ["line", { x1: 5, x2: 5, y1: 19, y2: 5 }]],
    repeat: [["path", { d: "m17 2 4 4-4 4" }], ["path", { d: "M3 11v-1a4 4 0 0 1 4-4h14" }], ["path", { d: "m7 22-4-4 4-4" }], ["path", { d: "M21 13v1a4 4 0 0 1-4 4H3" }]],
    sliders: [["line", { x1: 21, x2: 14, y1: 4, y2: 4 }], ["line", { x1: 10, x2: 3, y1: 4, y2: 4 }], ["line", { x1: 21, x2: 12, y1: 12, y2: 12 }], ["line", { x1: 8, x2: 3, y1: 12, y2: 12 }], ["line", { x1: 21, x2: 16, y1: 20, y2: 20 }], ["line", { x1: 12, x2: 3, y1: 20, y2: 20 }], ["line", { x1: 14, x2: 14, y1: 2, y2: 6 }], ["line", { x1: 8, x2: 8, y1: 10, y2: 14 }], ["line", { x1: 16, x2: 16, y1: 18, y2: 22 }]],
    "arrow-left": [["path", { d: "m12 19-7-7 7-7" }], ["path", { d: "M19 12H5" }]],
    "folder-plus": [["path", { d: "M12 10v6" }], ["path", { d: "M9 13h6" }], ["path", { d: "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" }]],
    file: [["path", { d: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" }], ["path", { d: "M14 2v4a2 2 0 0 0 2 2h4" }]],
    timer: [["line", { x1: 10, x2: 14, y1: 2, y2: 2 }], ["line", { x1: 12, x2: 15, y1: 14, y2: 11 }], ["circle", { cx: 12, cy: 14, r: 8 }]],
    minus: [["path", { d: "M5 12h14" }]],
    plus: [["path", { d: "M5 12h14" }], ["path", { d: "M12 5v14" }]],
    x: [["path", { d: "M18 6 6 18" }], ["path", { d: "m6 6 12 12" }]],
    refresh: [["path", { d: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" }], ["path", { d: "M21 3v5h-5" }], ["path", { d: "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" }], ["path", { d: "M8 16H3v5" }]],
    book: [["path", { d: "M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" }], ["path", { d: "M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" }]],
    music: [["path", { d: "M9 18V5l12-2v13" }], ["circle", { cx: 6, cy: 18, r: 3 }], ["circle", { cx: 18, cy: 16, r: 3 }]],
    keyboard: [["rect", { x: 2, y: 4, width: 20, height: 16, rx: 2 }], ["path", { d: "M6 8h4" }], ["path", { d: "M14 8h4" }], ["path", { d: "M8 12h8" }], ["path", { d: "M7 16h10" }]],
    "chevron-left": [["path", { d: "m15 18-6-6 6-6" }]],
    "chevron-right": [["path", { d: "m9 18 6-6-6-6" }]],
    "layout": [["rect", { x: 3, y: 3, width: 18, height: 18, rx: 2 }], ["path", { d: "M3 9h18" }], ["path", { d: "M9 21V9" }]],
    palette: [["circle", { cx: 13.5, cy: 6.5, r: 0.5 }], ["circle", { cx: 17.5, cy: 10.5, r: 0.5 }], ["circle", { cx: 8.5, cy: 7.5, r: 0.5 }], ["circle", { cx: 6.5, cy: 12.5, r: 0.5 }], ["path", { d: "M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 11.998 2z" }]],
    circle: [["circle", { cx: 12, cy: 12, r: 6 }]],
    square: [["rect", { x: 6, y: 6, width: 12, height: 12, rx: 1 }]],
    search: [["circle", { cx: 11, cy: 11, r: 8 }], ["path", { d: "m21 21-4.3-4.3" }]],
    download: [["path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }], ["path", { d: "m7 10 5 5 5-5" }], ["path", { d: "M12 15V3" }]],
    pencil: [["path", { d: "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" }], ["path", { d: "m15 5 4 4" }]],
    chart: [["path", { d: "M3 3v16a2 2 0 0 0 2 2h16" }], ["path", { d: "M18 17V9" }], ["path", { d: "M13 17V5" }], ["path", { d: "M8 17v-3" }]],
    flame: [["path", { d: "M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" }]],
    target: [["circle", { cx: 12, cy: 12, r: 10 }], ["circle", { cx: 12, cy: 12, r: 6 }], ["circle", { cx: 12, cy: 12, r: 2 }]],
    video: [["path", { d: "m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" }], ["rect", { x: 2, y: 6, width: 14, height: 12, rx: 2 }]],
    "zoom-in": [["circle", { cx: 11, cy: 11, r: 8 }], ["line", { x1: 21, x2: 16.65, y1: 21, y2: 16.65 }], ["line", { x1: 11, x2: 11, y1: 8, y2: 14 }], ["line", { x1: 8, x2: 14, y1: 11, y2: 11 }]],
    "zoom-out": [["circle", { cx: 11, cy: 11, r: 8 }], ["line", { x1: 21, x2: 16.65, y1: 21, y2: 16.65 }], ["line", { x1: 8, x2: 14, y1: 11, y2: 11 }]],
    maximize: [["path", { d: "M8 3H5a2 2 0 0 0-2 2v3" }], ["path", { d: "M21 8V5a2 2 0 0 0-2-2h-3" }], ["path", { d: "M3 16v3a2 2 0 0 0 2 2h3" }], ["path", { d: "M16 21h3a2 2 0 0 0 2-2v-3" }]],
    "trending-up": [["polyline", { points: "22 7 13.5 15.5 8.5 10.5 2 17" }], ["polyline", { points: "16 7 22 7 22 13" }]],
    upload: [["path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }], ["polyline", { points: "17 8 12 3 7 8" }], ["line", { x1: 12, x2: 12, y1: 3, y2: 15 }]],
    save: [["path", { d: "M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" }], ["path", { d: "M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7" }], ["path", { d: "M7 3v4a1 1 0 0 0 1 1h7" }]],
  };
  const NS = "http://www.w3.org/2000/svg";
  function icon(name, size = 18) {
    const svg = document.createElementNS(NS, "svg");
    for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", width: size, height: size, fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) svg.setAttribute(k, v);
    svg.classList.add("icon");
    for (const [tag, attrs] of P[name] || []) {
      const el = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      svg.appendChild(el);
    }
    return svg;
  }
  window.Piano = window.Piano || {};
  window.Piano.icon = icon;
})();
